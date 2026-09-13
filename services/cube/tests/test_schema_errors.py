from pathlib import Path

import pytest

from schema import validate_schema

EXTRA_CUBES = """
  - name: team_game_flow
    sql: SELECT 1 FROM gold.fct_game_flow
    measures:
      - name: biggest_lead_blown
      - name: biggest_comeback
      - name: overtime_games
  - name: games_schedule
  - name: game_predictions
  - name: player_injuries
  - name: game_odds
  - name: play_by_play
  - name: reddit_posts
  - name: reddit_comments
  - name: reddit_entity_mentions
  - name: reddit_flair
  - name: transactions
  - name: transaction_participants
  - name: player_mvp_scores
    sql_table: gold.fct_player_mvp_scores
    dimensions:
      - name: season_type
      - name: mvp_score
      - name: mvp_rank
"""

PLAYER_DIMS = """
    dimensions:
      - name: current_season_salary
      - name: height
      - name: weight
      - name: birth_date
      - name: first_season
      - name: last_season
"""

STANDINGS = """
  - name: standings
    dimensions:
      - name: id
        primary_key: true
      - name: season
      - name: conf_games_back
"""


@pytest.mark.unit
def test_validate_schema_rejects_empty_model(tmp_path: Path) -> None:
    (tmp_path / "cube.js").write_text("module.exports = {}\n", encoding="utf-8")
    (tmp_path / "model" / "cubes").mkdir(parents=True)
    (tmp_path / "model" / "views").mkdir()
    with pytest.raises(ValueError, match="Missing cubes"):
        validate_schema(tmp_path)


@pytest.mark.unit
def test_validate_schema_rejects_missing_views(tmp_path: Path) -> None:
    (tmp_path / "cube.js").write_text("module.exports = {}\n", encoding="utf-8")
    cubes = tmp_path / "model" / "cubes"
    views = tmp_path / "model" / "views"
    cubes.mkdir(parents=True)
    views.mkdir()
    (cubes / "all.yml").write_text(
        f"""
cubes:
  - name: players
    sql_table: gold.dim_players
  - name: games
    sql_table: gold.fct_team_game_results
  - name: player_game_logs
    sql_table: gold.other
    measures: []
  - name: team_game_results
    sql_table: gold.fct_team_game_results
  - name: standings
    sql_table: gold.fct_standings
  - name: teams
    sql_table: gold.dim_teams
  - name: team_games
    sql: SELECT 1 FROM gold.fct_team_game_results
  - name: player_season_stats
    sql_table: gold.fct_player_season_stats
  - name: player_contracts
    sql_table: gold.fct_player_contracts
  - name: team_payroll
    sql_table: gold.fct_team_payroll
{EXTRA_CUBES}
""",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="Missing views"):
        validate_schema(tmp_path)


@pytest.mark.unit
def test_validate_schema_rejects_wrong_sql_table(tmp_path: Path) -> None:
    (tmp_path / "cube.js").write_text("module.exports = {}\n", encoding="utf-8")
    cubes = tmp_path / "model" / "cubes"
    views = tmp_path / "model" / "views"
    cubes.mkdir(parents=True)
    views.mkdir()
    (cubes / "all.yml").write_text(
        f"""
cubes:
  - name: players
  - name: games
  - name: player_game_logs
    sql_table: gold.other
    measures: []
  - name: team_game_results
  - name: standings
  - name: teams
  - name: team_games
  - name: player_season_stats
  - name: player_contracts
  - name: team_payroll
{EXTRA_CUBES}
""",
        encoding="utf-8",
    )
    (views / "player_performance.yml").write_text(
        "views:\n  - name: player_performance\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="fct_player_game_logs"):
        validate_schema(tmp_path)


@pytest.mark.unit
def test_validate_schema_rejects_missing_measures(tmp_path: Path) -> None:
    (tmp_path / "cube.js").write_text("module.exports = {}\n", encoding="utf-8")
    cubes = tmp_path / "model" / "cubes"
    views = tmp_path / "model" / "views"
    cubes.mkdir(parents=True)
    views.mkdir()
    (cubes / "all.yml").write_text(
        f"""
cubes:
  - name: players
  - name: games
  - name: player_game_logs
    sql_table: gold.fct_player_game_logs
    measures: []
  - name: team_game_results
  - name: standings
  - name: teams
  - name: team_games
  - name: player_season_stats
  - name: player_contracts
  - name: team_payroll
{EXTRA_CUBES}
""",
        encoding="utf-8",
    )
    (views / "player_performance.yml").write_text(
        "views:\n  - name: player_performance\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="missing measure"):
        validate_schema(tmp_path)


def _valid_player_game_logs() -> str:
    return """
  - name: player_game_logs
    sql_table: gold.fct_player_game_logs
    measures:
      - name: games_played
      - name: avg_points
      - name: back_to_back_games
      - name: games_played_in_b2b
      - name: games_sat_in_b2b
      - name: avg_points_b2b
      - name: avg_points_non_b2b
"""


@pytest.mark.unit
def test_validate_schema_rejects_missing_salary_and_team_games(tmp_path: Path) -> None:
    (tmp_path / "cube.js").write_text("module.exports = {}\n", encoding="utf-8")
    cubes = tmp_path / "model" / "cubes"
    views = tmp_path / "model" / "views"
    cubes.mkdir(parents=True)
    views.mkdir()
    (views / "player_performance.yml").write_text(
        "views:\n  - name: player_performance\n",
        encoding="utf-8",
    )
    (cubes / "all.yml").write_text(
        f"""
cubes:
  - name: players
    dimensions: []
  - name: games
{_valid_player_game_logs()}
  - name: team_game_results
{STANDINGS}
  - name: teams
    sql_table: gold.dim_teams
  - name: team_games
    sql: SELECT 1 FROM gold.fct_team_game_results
    measures: []
  - name: player_season_stats
  - name: player_contracts
  - name: team_payroll
{EXTRA_CUBES}
""",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="current_season_salary"):
        validate_schema(tmp_path)

    (cubes / "all.yml").write_text(
        f"""
cubes:
  - name: players
{PLAYER_DIMS}
  - name: games
{_valid_player_game_logs()}
  - name: team_game_results
{STANDINGS}
  - name: teams
    sql_table: gold.other
  - name: team_games
    sql: SELECT 1 FROM gold.fct_team_game_results
    measures:
      - name: games
      - name: wins
      - name: losses
  - name: player_season_stats
  - name: player_contracts
  - name: team_payroll
{EXTRA_CUBES}
""",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="gold.dim_teams"):
        validate_schema(tmp_path)

    (cubes / "all.yml").write_text(
        f"""
cubes:
  - name: players
{PLAYER_DIMS}
  - name: games
{_valid_player_game_logs()}
  - name: team_game_results
{STANDINGS}
  - name: teams
    sql_table: gold.dim_teams
    dimensions:
      - name: current_season_payroll
  - name: team_games
    sql: SELECT 1 FROM gold.other
    measures:
      - name: games
      - name: wins
      - name: losses
  - name: player_season_stats
  - name: player_contracts
  - name: team_payroll
{EXTRA_CUBES}
""",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="fct_team_game_results"):
        validate_schema(tmp_path)

    (cubes / "all.yml").write_text(
        f"""
cubes:
  - name: players
{PLAYER_DIMS}
  - name: games
{_valid_player_game_logs()}
  - name: team_game_results
{STANDINGS}
  - name: teams
    sql_table: gold.dim_teams
    dimensions: []
  - name: team_games
    sql: SELECT 1 FROM gold.fct_team_game_results
    measures:
      - name: games
      - name: wins
      - name: losses
  - name: player_season_stats
  - name: player_contracts
  - name: team_payroll
{EXTRA_CUBES}
""",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="current_season_payroll"):
        validate_schema(tmp_path)

    (cubes / "all.yml").write_text(
        f"""
cubes:
  - name: players
{PLAYER_DIMS}
  - name: games
{_valid_player_game_logs()}
  - name: team_game_results
{STANDINGS}
  - name: teams
    sql_table: gold.dim_teams
    dimensions:
      - name: current_season_payroll
  - name: team_games
    sql: SELECT 1 FROM gold.fct_team_game_results
    measures: []
  - name: player_season_stats
  - name: player_contracts
  - name: team_payroll
{EXTRA_CUBES}
""",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="team_games is missing measure"):
        validate_schema(tmp_path)

    (cubes / "all.yml").write_text(
        f"""
cubes:
  - name: players
{PLAYER_DIMS}
  - name: games
{_valid_player_game_logs()}
  - name: team_game_results
{STANDINGS}
  - name: teams
    sql_table: gold.dim_teams
    dimensions:
      - name: current_season_payroll
  - name: team_games
    sql: SELECT 1 FROM gold.fct_team_game_results
    measures:
      - name: games
      - name: wins
      - name: losses
  - name: player_season_stats
  - name: player_contracts
  - name: team_payroll
{EXTRA_CUBES}
""",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="season_type"):
        validate_schema(tmp_path)


@pytest.mark.unit
def test_validate_schema_rejects_incomplete_mvp_scores(tmp_path: Path) -> None:
    (tmp_path / "cube.js").write_text("module.exports = {}\n", encoding="utf-8")
    cubes = tmp_path / "model" / "cubes"
    views = tmp_path / "model" / "views"
    cubes.mkdir(parents=True)
    views.mkdir()
    (views / "player_performance.yml").write_text(
        "views:\n  - name: player_performance\n",
        encoding="utf-8",
    )

    def write_model(mvp_cube: str) -> None:
        (cubes / "all.yml").write_text(
            f"""
cubes:
  - name: players
{PLAYER_DIMS}
  - name: games
{_valid_player_game_logs()}
  - name: team_game_results
{STANDINGS}
  - name: teams
    sql_table: gold.dim_teams
    dimensions:
      - name: current_season_payroll
  - name: team_games
    sql: SELECT 1 FROM gold.fct_team_game_results
    measures:
      - name: games
      - name: wins
      - name: losses
    dimensions:
      - name: season_type
  - name: player_season_stats
  - name: player_contracts
  - name: team_payroll
{EXTRA_CUBES.split("  - name: player_mvp_scores")[0]}
{mvp_cube}
""",
            encoding="utf-8",
        )

    write_model("  - name: player_mvp_scores\n    sql_table: gold.other\n")
    with pytest.raises(ValueError, match="gold.fct_player_mvp_scores"):
        validate_schema(tmp_path)

    write_model(
        "  - name: player_mvp_scores\n"
        "    sql_table: gold.fct_player_mvp_scores\n"
        "    dimensions:\n"
        "      - name: season_type\n"
        "      - name: mvp_score\n"
    )
    with pytest.raises(ValueError, match="missing dimension mvp_rank"):
        validate_schema(tmp_path)
