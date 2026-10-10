"""Conference rank and games-behind from Regular Season W–L when official ranks are missing."""

from __future__ import annotations

from collections import defaultdict


def apply_derived_ranks(rows: list[dict]) -> list[dict]:
    """Fill null conference_rank / games_back from Regular Season W–L.

    Official values win when present. Otherwise rank within conference by
    win %, then wins, then fewer losses, then team name. Games behind uses
    the conference leader's W–L: ((leader_w - w) + (l - leader_l)) / 2.
    """
    if not rows:
        return rows

    by_conference: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_conference[_conference_key(row)].append(dict(row))

    filled: list[dict] = []
    for group in by_conference.values():
        ordered = sorted(group, key=_record_sort_key)
        leader = ordered[0] if ordered else None
        leader_wins = leader.get("wins") if leader else None
        leader_losses = leader.get("losses") if leader else None
        for index, row in enumerate(ordered, start=1):
            if row.get("conference_rank") is None:
                row["conference_rank"] = index
            if (
                row.get("games_back") is None
                and leader_wins is not None
                and leader_losses is not None
                and row.get("wins") is not None
                and row.get("losses") is not None
            ):
                row["games_back"] = (
                    (leader_wins - row["wins"]) + (row["losses"] - leader_losses)
                ) / 2
            filled.append(row)
    return filled


def _conference_key(row: dict) -> str:
    return str(row.get("conference") or "").casefold()


def _record_sort_key(row: dict) -> tuple:
    win_pct = row.get("win_pct")
    wins = row.get("wins")
    losses = row.get("losses")
    name = str(row.get("team_name") or "")
    return (
        -(win_pct if win_pct is not None else -1.0),
        -(wins if wins is not None else -1),
        losses if losses is not None else 10**9,
        name,
    )
