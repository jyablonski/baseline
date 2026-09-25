"""CLI entry point: python -m src.main."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import date

import click
from notify import SyncAlert, format_stage_failure_text, post_webhook_text
from pipeline import (
    load_config,
    mark_scrape_success,
    record_dbt_only_run,
    run_pipeline_scrape,
    set_enabled,
    update_run_dbt_exit,
    update_run_ml_exit,
)

from config import RedditConfigError
from db import get_session
from scrapers import current_season, parse_seasons
from scrapers.contracts import scrape_contracts
from scrapers.games import scrape_games, scrape_todays_games
from scrapers.injuries import scrape_injuries
from scrapers.odds import scrape_odds
from scrapers.play_by_play import NoFinalGamesError, repair_encoded_text, scrape_play_by_play
from scrapers.player_game_logs import scrape_logs_for_games, scrape_player_game_logs
from scrapers.players import scrape_players
from scrapers.reddit import DEFAULT_COMMENTS_PER_POST, scrape_reddit
from scrapers.standings import scrape_standings
from scrapers.teams import scrape_teams
from scrapers.transactions import scrape_transactions


def _parse_optional_date(value: str | None) -> date | None:
    if value is None:
        return None
    return date.fromisoformat(value)


def stamp_cli_success() -> None:
    """Record last_success_at after a successful scrape-all / scrape-daily."""
    with get_session() as session:
        mark_scrape_success(session)


def _configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


@click.group()
def cli() -> None:
    """Scrape Basketball-Reference data into the source Postgres schema."""
    _configure_logging()


@cli.command("scrape-all")
@click.option(
    "--seasons",
    default=None,
    help="Comma-separated seasons (e.g. 2010-11,2024-25). Default: current season only.",
)
@click.option("--active-only", is_flag=True, help="Only scrape game logs for active players.")
@click.option(
    "--with-reddit",
    is_flag=True,
    help="Also scrape r/nba posts and top comments via PRAW (requires REDDIT_*). Off by default.",
)
def scrape_all(seasons: str | None, active_only: bool, with_reddit: bool) -> None:
    season_list = parse_seasons(seasons)
    click.echo(
        f"Scraping teams, players, then {len(season_list)} season(s): {', '.join(season_list)}"
    )
    alert = SyncAlert("scrape-all")
    n_teams = alert.try_run("teams", scrape_teams)
    if n_teams is not None:
        click.echo(f"Teams: {n_teams}")
    n_players = alert.try_run("players", scrape_players)
    if n_players is not None:
        click.echo(f"Players: {n_players}")
    contracts = alert.try_run("contracts", scrape_contracts)
    if contracts is not None:
        n_contracts, n_payroll = contracts
        click.echo(f"Player contracts: {n_contracts}; team payroll rows: {n_payroll}")
    for season in season_list:
        transactions = alert.try_run(
            "transactions",
            lambda s=season: scrape_transactions(s),
            season=season,
            rows=lambda result: result[0],
        )
        if transactions is not None:
            n_transactions, n_participants = transactions
            click.echo(f"Transactions {season}: {n_transactions}; participants: {n_participants}")
        n_games = alert.try_run("games", lambda s=season: scrape_games(s), season=season)
        if n_games is not None:
            click.echo(f"Games {season}: {n_games}")
        n_logs = alert.try_run(
            "player_game_logs",
            lambda s=season: scrape_player_game_logs(s, active_only=active_only),
            season=season,
        )
        if n_logs is not None:
            click.echo(f"Player game logs {season}: {n_logs}")
        n_standings = alert.try_run(
            "standings",
            lambda s=season: scrape_standings(s),
            season=season,
        )
        if n_standings is not None:
            click.echo(f"Standings {season}: {n_standings}")
    if with_reddit:
        n_reddit = alert.try_run("reddit", scrape_reddit)
        if n_reddit is not None:
            click.echo(f"Reddit posts: {n_reddit} (plus comments for those posts)")
    alert.notify()
    if alert.failures:
        raise SystemExit(1)
    stamp_cli_success()


@cli.command("scrape-players")
def scrape_players_cmd() -> None:
    count = scrape_players()
    click.echo(f"Upserted {count} players")


@cli.command("scrape-teams")
def scrape_teams_cmd() -> None:
    count = scrape_teams()
    click.echo(f"Upserted {count} teams")


@cli.command("scrape-games")
@click.option("--season", required=True, help='Season string, e.g. "2024-25".')
def scrape_games_cmd(season: str) -> None:
    count = scrape_games(season)
    click.echo(f"Upserted {count} games for {season}")


@cli.command("scrape-game-logs")
@click.option("--season", required=True, help='Season string, e.g. "2024-25".')
@click.option("--active-only", is_flag=True, help="Only scrape logs for active players.")
def scrape_game_logs_cmd(season: str, active_only: bool) -> None:
    count = scrape_player_game_logs(season, active_only=active_only)
    click.echo(f"Upserted {count} player game logs for {season}")


@cli.command("scrape-standings")
@click.option("--season", required=True, help='Season string, e.g. "2024-25".')
def scrape_standings_cmd(season: str) -> None:
    count = scrape_standings(season)
    click.echo(f"Upserted {count} standings rows for {season}")


@cli.command("scrape-reddit")
@click.option(
    "--subreddit",
    default="nba",
    show_default=True,
    help="Subreddit name without r/ (default nba; team subs later).",
)
@click.option("--limit", default=100, show_default=True, type=int, help="Max posts per listing.")
@click.option(
    "--time-filter",
    type=click.Choice(["day", "week", "month"], case_sensitive=False),
    default="day",
    show_default=True,
    help="Window for subreddit.top (hot is also fetched).",
)
@click.option(
    "--comments-per-post",
    default=DEFAULT_COMMENTS_PER_POST,
    show_default=True,
    type=int,
    help="Top comments by score per ingested post (0 skips comments).",
)
def scrape_reddit_cmd(subreddit: str, limit: int, time_filter: str, comments_per_post: int) -> None:
    """Upsert Reddit submissions and top comments via PRAW into source reddit tables."""
    try:
        count = scrape_reddit(
            subreddit=subreddit,
            limit=limit,
            time_filter=time_filter.lower(),
            comments_per_post=comments_per_post,
        )
    except RedditConfigError as exc:
        raise click.ClickException(str(exc)) from exc
    except ValueError as exc:
        raise click.BadParameter(str(exc)) from exc
    name = subreddit.strip()
    if name.lower().startswith("r/"):
        name = name[2:].strip()
    click.echo(f"Upserted {count} reddit posts from r/{name or 'nba'}")


@cli.command("scrape-transactions")
@click.option("--season", default=None, help='Season string, e.g. "2025-26". Default: current.')
def scrape_transactions_cmd(season: str | None) -> None:
    """Upsert one season's Basketball-Reference transactions log."""
    n_transactions, n_participants = scrape_transactions(season)
    click.echo(f"Transactions: {n_transactions}; participants: {n_participants}")


@cli.command("scrape-injuries")
def scrape_injuries_cmd() -> None:
    """Upsert the current Basketball-Reference injury report (snapshot, not a ledger)."""
    count = scrape_injuries()
    click.echo(f"Upserted {count} current injury rows")


@cli.command("scrape-odds")
def scrape_odds_cmd() -> None:
    """Upsert upcoming moneylines/spreads from The Odds API. No-op if ODDS_API_KEY is unset."""
    count = scrape_odds()
    if count == 0:
        click.echo("Odds scrape skipped or empty (set ODDS_API_KEY to fetch).")
        return
    click.echo(f"Upserted {count} current odds rows")


@cli.command("scrape-play-by-play")
@click.option(
    "--season",
    default=None,
    help='Season string, e.g. "2025-26". Default: current season (October cutoff).',
)
@click.option(
    "--game-id",
    "game_ids",
    multiple=True,
    help="Scrape these Final game_ids only (repeatable). Skips the season-wide Finals backfill.",
)
@click.option(
    "--refresh",
    is_flag=True,
    default=False,
    help="Re-fetch games that already have events instead of skipping them.",
)
def scrape_play_by_play_cmd(season: str | None, game_ids: tuple[str, ...], refresh: bool) -> None:
    """Upsert Basketball-Reference play-by-play events. Omit --game-id to load a season."""
    ids = list(game_ids) or None
    try:
        count = scrape_play_by_play(season, game_ids=ids, refresh=refresh)
    except NoFinalGamesError as exc:
        raise click.ClickException(str(exc)) from exc
    if ids:
        click.echo(f"Upserted {count} play-by-play events for {len(ids)} game(s)")
        return
    target = season or current_season()
    click.echo(f"Upserted {count} play-by-play events for {target}")


@cli.command("repair-encoding")
def repair_encoding_cmd() -> None:
    """Repair mojibake in player names and play-by-play descriptions already stored."""
    players_fixed, actions_fixed = repair_encoded_text()
    click.echo(f"Repaired {players_fixed} player name(s) and {actions_fixed} description(s)")


@cli.command("scrape-contracts")
@click.option(
    "--teams",
    default=None,
    help=(
        "Comma-separated team abbreviations (NBA or Basketball-Reference). "
        "Default: all 30 current teams."
    ),
)
def scrape_contracts_cmd(teams: str | None) -> None:
    """Pull remaining player salaries from Basketball-Reference team payroll pages."""
    try:
        n_contracts, n_payroll = scrape_contracts(teams)
    except ValueError as exc:
        raise click.BadParameter(str(exc)) from exc
    click.echo(f"Upserted {n_contracts} player-season contracts and {n_payroll} team payroll rows")


@cli.command("scrape-daily")
def scrape_daily_cmd() -> None:
    alert = SyncAlert("scrape-daily")
    games = alert.try_run("todays_games", scrape_todays_games)
    if games:
        click.echo(f"Found {len(games)} completed game(s) today.")
        count = alert.try_run("player_game_logs", lambda: scrape_logs_for_games(games))
        if count is not None:
            click.echo(f"Upserted {count} player game logs for today's games.")
        game_ids = [str(game["game_id"]) for game in games if game.get("game_id")]
        n_pbp = alert.try_run("play_by_play", lambda: scrape_play_by_play(game_ids=game_ids))
        if n_pbp is not None:
            click.echo(f"Play-by-play: {n_pbp}")
    elif games is not None:
        click.echo("No completed games today.")
    n_standings = alert.try_run(
        "standings",
        lambda: scrape_standings(current_season()),
        season=current_season(),
    )
    if n_standings is not None:
        click.echo(f"Standings: {n_standings}")
    n_injuries = alert.try_run("injuries", scrape_injuries)
    if n_injuries is not None:
        click.echo(f"Injuries: {n_injuries}")
    n_odds = alert.try_run("odds", scrape_odds)
    if n_odds is not None:
        click.echo(f"Odds: {n_odds}")
    contracts = alert.try_run("contracts", scrape_contracts)
    if contracts is not None:
        n_contracts, n_payroll = contracts
        click.echo(f"Player contracts: {n_contracts}; team payroll rows: {n_payroll}")
    alert.notify()
    if alert.failures:
        raise SystemExit(1)
    stamp_cli_success()


@cli.group("pipeline")
def pipeline_group() -> None:
    """Enable/disable and run the scrape→dbt daily refresh gate."""


@pipeline_group.command("status")
def pipeline_status_cmd() -> None:
    with get_session() as session:
        config = load_config(session)
    click.echo(f"enabled={config.enabled}")
    click.echo(f"season_active={config.season_active}")
    click.echo(f"season_start={config.season_start}")
    click.echo(f"season_end={config.season_end}")
    click.echo(f"scrape_mode={config.scrape_mode}")
    click.echo(f"target_season={config.target_season}")
    click.echo(f"last_success_at={config.last_success_at}")
    click.echo(f"last_scrape_date={config.last_scrape_date}")
    click.echo(f"reason={config.reason}")
    click.echo(f"updated_at={config.updated_at}")


@pipeline_group.command("enable")
@click.option("--reason", default="Enabled by operator.", show_default=True)
@click.option(
    "--season-active/--no-season-active",
    default=True,
    show_default=True,
    help="Mark the NBA season as active so scheduled runs scrape basketball daily.",
)
@click.option("--season-start", default=None, help="Inclusive YYYY-MM-DD.")
@click.option("--season-end", default=None, help="Inclusive YYYY-MM-DD.")
@click.option(
    "--scrape-mode",
    type=click.Choice(["daily", "season", "none"], case_sensitive=False),
    default=None,
)
@click.option("--target-season", default=None, help='e.g. "2025-26" for scrape_mode=season.')
def pipeline_enable_cmd(
    reason: str,
    season_active: bool,
    season_start: str | None,
    season_end: str | None,
    scrape_mode: str | None,
    target_season: str | None,
) -> None:
    with get_session() as session:
        config = set_enabled(
            session,
            enabled=True,
            reason=reason,
            season_active=season_active,
            season_start=_parse_optional_date(season_start),
            season_end=_parse_optional_date(season_end),
            scrape_mode=scrape_mode.lower() if scrape_mode else None,
            target_season=target_season,
        )
    click.echo(
        f"Pipeline enabled (season_active={config.season_active}, mode={config.scrape_mode})."
    )


@pipeline_group.command("disable")
@click.option(
    "--reason",
    default="Disabled by operator (safe default / off-season).",
    show_default=True,
)
def pipeline_disable_cmd(reason: str) -> None:
    with get_session() as session:
        set_enabled(
            session,
            enabled=False,
            season_active=False,
            reason=reason,
        )
    click.echo("Pipeline disabled.")


@pipeline_group.command("run-once")
@click.option(
    "--force",
    is_flag=True,
    help=(
        "Bypass enabled and the NBA season window (manual test of basketball daily). "
        "Also runs Reddit. scrape_mode=none still skips NBA. Missing REDDIT_* skips reddit HTTP."
    ),
)
def pipeline_run_once_cmd(force: bool) -> None:
    """Scrape according to source.scrape_pipeline (does not run dbt)."""
    result = run_pipeline_scrape(force=force, triggered_by="force" if force else "manual")
    click.echo(f"run_id={result['run_id']}")
    click.echo(f"status={result['status']}")
    click.echo(f"action={result['action']}")
    click.echo(f"detail={result['detail']}")
    if int(result["scrape_exit"]) != 0:
        raise SystemExit(int(result["scrape_exit"]))


_NOTIFY_OPTION = click.option(
    "--notify/--no-notify",
    default=False,
    help="Post one Slack alert (SLACK_WEBHOOK_URL) when the exit code is non-zero.",
)


def _record_stage(
    stage: str,
    run_id: int,
    exit_code: int,
    detail: str | None,
    *,
    notify: bool,
    record: Callable[..., None],
) -> None:
    # Alert before recording: if the database is what broke the stage, the
    # bookkeeping write fails too, and the alert is the part that must land.
    if notify and exit_code != 0:
        post_webhook_text(format_stage_failure_text(stage, exit_code, run_id=run_id, detail=detail))
    record(run_id, exit_code, detail=detail)


_FAILED_NODE_OPTION = click.option(
    "--failed-node",
    "failed_nodes",
    multiple=True,
    help="A node that failed, as '<resource_type> <name>'. Repeatable; ignored when exit is 0.",
)


def _failed_nodes(dbt_exit: int, failed_nodes: tuple[str, ...]) -> list[str] | None:
    # Null on success, so the admin view can't show a stale list from a
    # build that has since passed. An empty list on failure means dbt died
    # before reporting a node (parse or connection error).
    return list(failed_nodes) if dbt_exit != 0 else None


@pipeline_group.command("mark-dbt")
@click.option("--run-id", required=True, type=int)
@click.option("--dbt-exit", required=True, type=int)
@click.option("--detail", default=None)
@_FAILED_NODE_OPTION
@_NOTIFY_OPTION
def pipeline_mark_dbt_cmd(
    run_id: int, dbt_exit: int, detail: str | None, failed_nodes: tuple[str, ...], notify: bool
) -> None:
    """Record dbt exit code onto an existing source.pipeline_runs row."""
    nodes = _failed_nodes(dbt_exit, failed_nodes)
    _record_stage(
        "dbt build",
        run_id,
        dbt_exit,
        detail,
        notify=notify,
        record=lambda run_id, exit_code, detail=None: update_run_dbt_exit(
            run_id, exit_code, detail=detail, failed_nodes=nodes
        ),
    )
    click.echo(f"Updated run_id={run_id} dbt_exit={dbt_exit}")


@pipeline_group.command("mark-ml")
@click.option("--run-id", required=True, type=int)
@click.option("--ml-exit", required=True, type=int)
@click.option("--detail", default=None)
@_NOTIFY_OPTION
def pipeline_mark_ml_cmd(run_id: int, ml_exit: int, detail: str | None, notify: bool) -> None:
    """Record the ml stage (score + gold copy) exit code onto a source.pipeline_runs row."""
    _record_stage("ml", run_id, ml_exit, detail, notify=notify, record=update_run_ml_exit)
    click.echo(f"Updated run_id={run_id} ml_exit={ml_exit}")


@pipeline_group.command("record-dbt")
@click.option("--dbt-exit", required=True, type=int)
@click.option("--detail", default=None)
@_FAILED_NODE_OPTION
def pipeline_record_dbt_cmd(
    dbt_exit: int, detail: str | None, failed_nodes: tuple[str, ...]
) -> None:
    """Log a standalone dbt run (no scrape) to source.pipeline_runs."""
    run_id = record_dbt_only_run(
        dbt_exit, detail=detail, failed_nodes=_failed_nodes(dbt_exit, failed_nodes)
    )
    click.echo(f"Recorded run_id={run_id} dbt_exit={dbt_exit}")


def main() -> None:
    cli()


if __name__ == "__main__":
    main()
