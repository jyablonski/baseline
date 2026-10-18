from fastapi import HTTPException

# Accepts the label in any spacing or case ("regular-season", "PlayIn", "nba cup")
# and returns the spelling gold stores.
SEASON_TYPES = {
    "regularseason": "Regular Season",
    "cup": "Cup",
    "nbacup": "Cup",
    "playoffs": "Playoffs",
    "playin": "PlayIn",
}


def validate_season_type(season_type: str | None) -> str | None:
    if season_type is None:
        return None
    key = season_type.strip().lower().replace("-", "").replace(" ", "")
    if key not in SEASON_TYPES:
        raise HTTPException(
            status_code=400,
            detail="season_type must be Regular Season, Cup, Playoffs, or PlayIn",
        )
    return SEASON_TYPES[key]


def normalize_team(team: str | None) -> str | None:
    """Gold stores abbreviations uppercased; blank means no filter."""
    return team.strip().upper() if team and team.strip() else None
