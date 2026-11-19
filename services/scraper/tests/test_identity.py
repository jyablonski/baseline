from datetime import date
from types import SimpleNamespace
from uuid import uuid4

import pytest
from catalog.teams import TEAM_CATALOG
from identity import (
    BREF_PROVIDER,
    IdentityResolutionError,
    _upsert_game_external_id,
    _upsert_player_external_id,
    _upsert_team_external_id,
    ensure_player,
    resolve_game,
    resolve_team_id,
    seed_team_catalog,
)

from models import (
    Game,
    GameExternalId,
    IdentityReviewQueue,
    Player,
    PlayerExternalId,
    Team,
    TeamAlias,
    TeamExternalId,
)


class FakeSession:
    def __init__(self) -> None:
        self.rows: dict[tuple[object, object], object] = {}
        self.added: list[object] = []
        self.candidates: list[object] = []

    def get(self, model, key):
        return self.rows.get((model, key))

    def add(self, row) -> None:
        self.added.append(row)
        key = (
            getattr(row, "team_id", None)
            if isinstance(row, Team)
            else getattr(row, "player_id", None)
        )
        if isinstance(row, Team):
            self.rows[(Team, row.team_id)] = row
        elif isinstance(row, Player):
            self.rows[(Player, row.player_id)] = row
        elif isinstance(row, PlayerExternalId):
            self.rows[(PlayerExternalId, (row.provider, row.external_id))] = row
        elif isinstance(row, TeamExternalId):
            self.rows[(TeamExternalId, (row.provider, row.external_id))] = row
        elif isinstance(row, GameExternalId):
            self.rows[(GameExternalId, (row.provider, row.external_id))] = row
        elif isinstance(row, Game):
            self.rows[(Game, row.game_id)] = row
        elif isinstance(row, (TeamAlias, IdentityReviewQueue)):
            pass
        del key

    def flush(self) -> None:
        return None

    def scalar(self, statement):
        return None

    def scalars(self, statement):
        return SimpleNamespace(all=lambda: self.candidates)


@pytest.mark.unit
def test_seed_team_catalog_and_resolve_aliases() -> None:
    session = FakeSession()
    assert seed_team_catalog(session) == len(TEAM_CATALOG) == 30
    assert any(isinstance(row, TeamExternalId) for row in session.added)
    aliases = [row.alias for row in session.added if isinstance(row, TeamAlias)]
    assert len(aliases) == len(set(aliases))
    assert resolve_team_id(session, "GSW") == TEAM_CATALOG[9].team_id
    assert resolve_team_id(session, "unknown") is None


@pytest.mark.unit
def test_ensure_player_creates_and_reuses_provider_identity() -> None:
    session = FakeSession()
    player_id = ensure_player(
        session,
        provider=BREF_PROVIDER,
        external_id="CurryST01",
        full_name="Stephen Curry",
        team_id=uuid4(),
        metadata={"position": "PG", "birth_date": date(1988, 3, 14)},
    )
    assert isinstance(player_id, type(uuid4()))
    assert session.rows[(PlayerExternalId, (BREF_PROVIDER, "curryst01"))].metadata_json == {
        "position": "PG",
        "birth_date": "1988-03-14",
    }
    same_id = ensure_player(
        session,
        provider=BREF_PROVIDER,
        external_id="curryst01",
        full_name="S. Curry",
        team_id=uuid4(),
    )
    assert same_id == player_id
    assert session.rows[(Player, player_id)].full_name == "Stephen Curry"
    assert session.rows[(Player, player_id)].first_name == "Stephen"
    assert session.rows[(Player, player_id)].last_name == "Curry"


@pytest.mark.unit
def test_ensure_player_moves_team_only_for_the_roster() -> None:
    """A contracts page still lists players a team waived and pays; that
    team must not replace the one his current roster names."""
    session = FakeSession()
    roster_team, waiving_team, new_signing_team = uuid4(), uuid4(), uuid4()
    player_id = ensure_player(
        session,
        provider=BREF_PROVIDER,
        external_id="peavymi01",
        full_name="Micah Peavy",
        team_id=roster_team,
        from_roster=True,
    )
    ensure_player(
        session,
        provider=BREF_PROVIDER,
        external_id="peavymi01",
        full_name="Micah Peavy",
        team_id=waiving_team,
    )
    assert session.rows[(Player, player_id)].team_id == roster_team

    ensure_player(
        session,
        provider=BREF_PROVIDER,
        external_id="peavymi01",
        full_name="Micah Peavy",
        team_id=new_signing_team,
        from_roster=True,
    )
    assert session.rows[(Player, player_id)].team_id == new_signing_team


@pytest.mark.unit
def test_only_a_roster_makes_a_player_active() -> None:
    """Active means on a current roster. A player first seen on a contracts
    page (waived, still paid) is not, and a later contracts or box-score
    mention must not revive one the roster scrape benched."""
    session = FakeSession()
    player_id = ensure_player(
        session, provider=BREF_PROVIDER, external_id="loverla01", full_name="Lawson Lovering"
    )
    assert session.rows[(Player, player_id)].is_active is False

    ensure_player(
        session,
        provider=BREF_PROVIDER,
        external_id="loverla01",
        full_name="Lawson Lovering",
        from_roster=True,
    )
    assert session.rows[(Player, player_id)].is_active is True

    session.rows[(Player, player_id)].is_active = False
    ensure_player(
        session, provider=BREF_PROVIDER, external_id="loverla01", full_name="Lawson Lovering"
    )
    assert session.rows[(Player, player_id)].is_active is False


@pytest.mark.unit
def test_ensure_player_fills_a_missing_team() -> None:
    session = FakeSession()
    player_id = ensure_player(
        session, provider=BREF_PROVIDER, external_id="newgu01", full_name="New Guy"
    )
    team_id = uuid4()
    ensure_player(
        session,
        provider=BREF_PROVIDER,
        external_id="newgu01",
        full_name="New Guy",
        team_id=team_id,
    )
    assert session.rows[(Player, player_id)].team_id == team_id


@pytest.mark.unit
def test_ensure_player_requires_external_key_and_records_review() -> None:
    session = FakeSession()
    with pytest.raises(IdentityResolutionError, match="provider key"):
        ensure_player(session, provider=BREF_PROVIDER, external_id="", full_name="Unknown Player")
    assert any(isinstance(row, IdentityReviewQueue) for row in session.added)


@pytest.mark.unit
def test_identity_crosswalk_conflicts_are_rejected() -> None:
    session = FakeSession()
    player_key = (BREF_PROVIDER, "curryst01")
    session.rows[(PlayerExternalId, player_key)] = SimpleNamespace(
        player_id=uuid4(), metadata_json={}
    )
    with pytest.raises(IdentityResolutionError, match="already mapped"):
        _upsert_player_external_id(
            session, player_id=uuid4(), provider=BREF_PROVIDER, external_id="curryst01"
        )

    team_key = (BREF_PROVIDER, "GSW")
    session.rows[(TeamExternalId, team_key)] = SimpleNamespace(team_id=uuid4())
    with pytest.raises(IdentityResolutionError, match="already mapped"):
        _upsert_team_external_id(session, team_id=uuid4(), external_id="GSW")

    game_key = (BREF_PROVIDER, "game-1")
    session.rows[(GameExternalId, game_key)] = SimpleNamespace(game_id=uuid4(), metadata_json={})
    with pytest.raises(IdentityResolutionError, match="already mapped"):
        _upsert_game_external_id(
            session, game_id=uuid4(), provider=BREF_PROVIDER, external_id="game-1"
        )


@pytest.mark.unit
def test_resolve_game_creates_then_reuses_external_identity() -> None:
    session = FakeSession()
    home_id, away_id = uuid4(), uuid4()
    game_id = resolve_game(
        session,
        provider=BREF_PROVIDER,
        external_id="202410220GSW",
        season="2024-25",
        season_type="Regular Season",
        game_date=date(2024, 10, 22),
        home_team_id=home_id,
        away_team_id=away_id,
        values={"status": "Final"},
    )
    assert session.rows[(Game, game_id)].status == "Final"
    game = session.rows[(Game, game_id)]
    reused = resolve_game(
        session,
        provider=BREF_PROVIDER,
        external_id="202410220GSW",
        season="2024-25",
        season_type="Regular Season",
        game_date=date(2024, 10, 22),
        home_team_id=home_id,
        away_team_id=away_id,
        values={"arena": "Chase Center"},
    )
    assert reused == game_id
    assert game.arena == "Chase Center"


@pytest.mark.unit
def test_resolve_game_rejects_ambiguous_schedule_candidates() -> None:
    session = FakeSession()
    session.candidates = [SimpleNamespace(game_id=uuid4()), SimpleNamespace(game_id=uuid4())]
    with pytest.raises(IdentityResolutionError, match="ambiguous"):
        resolve_game(
            session,
            provider=BREF_PROVIDER,
            external_id="unknown-game",
            season="2024-25",
            season_type="Regular Season",
            game_date=date(2024, 10, 22),
            home_team_id=uuid4(),
            away_team_id=uuid4(),
        )
