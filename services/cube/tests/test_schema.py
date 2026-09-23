from pathlib import Path

import pytest

from schema import cube_names, cube_root, load_cubes, load_yaml, validate_schema, view_names


@pytest.mark.unit
def test_validate_schema() -> None:
    result = validate_schema()
    assert "player_game_logs" in result["cubes"]
    assert "player_performance" in result["views"]
    assert "avg_points" in result["measures"]
    assert "avg_points_b2b" in result["measures"]
    assert "teams" in result["cubes"]
    assert "team_games" in result["cubes"]
    assert "player_mvp_scores" in result["cubes"]
    assert "game_upsets" in result["cubes"]
    assert (result["root"] / "cube.js").is_file()


@pytest.mark.unit
def test_primary_key_dimensions_are_public() -> None:
    private_primary_keys = [
        f"{cube['name']}.{dimension['name']}"
        for cube in load_cubes()
        for dimension in cube.get("dimensions", [])
        if dimension.get("primary_key") and dimension.get("public") is not True
    ]
    assert private_primary_keys == []


@pytest.mark.unit
def test_cube_and_view_names() -> None:
    assert set(
        REQUIRED := {
            "players",
            "games",
            "player_game_logs",
            "team_game_results",
            "standings",
            "teams",
            "team_games",
            "player_season_stats",
            "player_contracts",
            "team_payroll",
            "games_schedule",
            "game_predictions",
            "player_injuries",
            "game_odds",
            "game_upsets",
            "play_by_play",
            "reddit_posts",
            "reddit_comments",
            "reddit_entity_mentions",
            "reddit_flair",
        }
    ).issubset(set(cube_names()))
    assert "player_performance" in view_names()
    assert cube_root().name == "cube"
    del REQUIRED


@pytest.mark.unit
def test_load_yaml_errors(tmp_path: Path) -> None:
    path = tmp_path / "ok.yml"
    path.write_text("cubes: []\n", encoding="utf-8")
    assert load_yaml(path)["cubes"] == []
    with pytest.raises(ValueError):
        bad = tmp_path / "list.yml"
        bad.write_text("- nope\n", encoding="utf-8")
        load_yaml(bad)
    with pytest.raises(FileNotFoundError):
        cube_root(tmp_path)
