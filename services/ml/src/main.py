"""CLI for training, evaluating, and scoring pregame models."""

from __future__ import annotations

import logging

import click

from scoring import (
    backfill_and_persist,
    evaluate,
    evaluate_logit,
    score_and_persist,
    train_model,
)


def _configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


@click.group()
def cli() -> None:
    """Pregame win probabilities (Regular Season only)."""
    _configure_logging()


@cli.command("eval")
def eval_cmd() -> None:
    """Walk-forward Elo on gold Regular Season Finals; print logloss / Brier / accuracy."""
    result = evaluate()
    click.echo(f"model={result['model_name']} version={result['model_version']}")
    click.echo(f"holdout_season={result['holdout_season']}")
    click.echo(f"n={int(result['n'])}")
    click.echo(f"logloss={result['logloss']}")
    click.echo(f"brier={result['brier']}")
    click.echo(f"accuracy={result['accuracy']}")
    click.echo(f"home_always_accuracy={result['home_always_accuracy']}")


@cli.command("score")
def score_cmd() -> None:
    """Fit Elo and persist Elo plus trained logit WP for upcoming games."""
    result = score_and_persist()
    click.echo(f"model={result['model_name']} version={result['model_version']}")
    click.echo(f"history_games={result['history_games']}")
    click.echo(f"upcoming_games={result['upcoming_games']}")
    click.echo(f"written={result['written']}")
    click.echo(f"as_of={result['as_of']}")


@cli.command("backfill")
@click.option("--season", default=None, help="Only write this season (e.g. 2025-26); default all.")
@click.option(
    "--with-logit",
    is_flag=True,
    help="Also replay logit (refits every 50 games; minutes per season). Elo only by default.",
)
def backfill_cmd(season: str | None, with_logit: bool) -> None:
    """Persist walk-forward pregame WP for past Finals so the scorecard can grade it."""
    result = backfill_and_persist(season=season, with_logit=with_logit)
    click.echo(f"model_versions={','.join(result['model_versions'])}")
    click.echo(f"season={result['season']}")
    click.echo(f"history_games={result['history_games']}")
    click.echo(f"written={result['written']}")


@cli.command("eval-logit")
def eval_logit_cmd() -> None:
    """Run expanding-window logit v1 evaluation on silver game features."""
    result = evaluate_logit()
    click.echo(f"model=logit version={result.get('model_version', 'logit-v1')}")
    click.echo(f"n={int(result['n'])}")
    click.echo(f"logloss={result['logloss']}")
    click.echo(f"brier={result['brier']}")
    click.echo(f"accuracy={result['accuracy']}")
    click.echo(f"home_always_accuracy={result['home_always_accuracy']}")


@cli.command("train")
def train_cmd() -> None:
    """Fit logit v1 from silver.int_game_features and persist its artifact."""
    result = train_model()
    click.echo(f"model={result['model_name']} version={result['model_version']}")
    click.echo(f"training_rows={result['training_rows']}")
    click.echo(f"training_seasons={','.join(result['training_seasons'])}")
    click.echo(f"trained_at={result['trained_at']}")


def main() -> None:
    cli()


if __name__ == "__main__":
    main()
