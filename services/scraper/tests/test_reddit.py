from contextlib import contextmanager
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from click.testing import CliRunner

from config import RedditConfigError, Settings, missing_reddit_env_names, require_reddit_settings
from main import cli
from models import RedditComment, RedditPost
from scrapers.reddit import (
    DEFAULT_COMMENTS_PER_POST,
    DEFAULT_SUBREDDIT,
    SELFTEXT_MAX_CHARS,
    _author_name,
    _created_utc,
    _iter_comments,
    _iter_submissions,
    _permalink,
    _reddit_client,
    _subreddit_name,
    _truncate_selftext,
    comment_to_row,
    scrape_reddit,
    submission_to_row,
)


def _filled_reddit_settings(**overrides: object) -> Settings:
    values = {
        "reddit_client_id": "id",
        "reddit_client_secret": "secret",
        "reddit_user_agent": "nba-analytics/0.1 by tester",
        "reddit_username": "",
        "reddit_password": "",
    }
    values.update(overrides)
    return Settings(database_url="postgresql://nba_user:nba_pass@localhost:5432/nba", **values)


def _empty_reddit_settings() -> Settings:
    return Settings(
        database_url="postgresql://nba_user:nba_pass@localhost:5432/nba",
        reddit_client_id="",
        reddit_client_secret="",
        reddit_user_agent="",
        reddit_username="",
        reddit_password="",
    )


class _Author:
    def __init__(self, name: str) -> None:
        self.name = name

    def __str__(self) -> str:
        return self.name


def _submission(**overrides: object) -> SimpleNamespace:
    values = {
        "id": "abc123",
        "subreddit": SimpleNamespace(display_name="nba"),
        "title": "Warriors win",
        "author": _Author("steph"),
        "score": 42,
        "num_comments": 7,
        "created_utc": 1_700_000_000.0,
        "permalink": "/r/nba/comments/abc123/warriors_win/",
        "url": "https://www.reddit.com/r/nba/comments/abc123/warriors_win/",
        "selftext": "short body",
        "link_flair_text": "Highlight",
        "author_flair_text": ":gsw-1: Warriors",
        "is_self": True,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _comment(**overrides: object) -> SimpleNamespace:
    values = {
        "id": "cmt1",
        "author": _Author("fan"),
        "body": "nice shot",
        "score": 11,
        "created_utc": 1_700_000_100.0,
        "permalink": "/r/nba/comments/abc123/warriors_win/cmt1/",
        "parent_id": "t3_abc123",
        "author_flair_text": ":lal-3: Lakers",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class _CommentForest:
    def __init__(self, comments: list[object]) -> None:
        self._comments = comments
        self.replace_more_calls: list[dict[str, object]] = []

    def replace_more(self, *, limit: int) -> None:
        self.replace_more_calls.append({"limit": limit})

    def list(self) -> list[object]:
        return list(self._comments)


@contextmanager
def _session(mock_session):
    yield mock_session


@pytest.mark.unit
def test_missing_reddit_env_names() -> None:
    empty = _empty_reddit_settings()
    assert missing_reddit_env_names(empty) == [
        "REDDIT_CLIENT_ID",
        "REDDIT_CLIENT_SECRET",
        "REDDIT_USER_AGENT",
    ]
    assert missing_reddit_env_names(_filled_reddit_settings()) == []
    partial = _filled_reddit_settings(reddit_client_secret="  ")
    assert missing_reddit_env_names(partial) == ["REDDIT_CLIENT_SECRET"]


@pytest.mark.unit
def test_require_reddit_settings_message() -> None:
    empty = _empty_reddit_settings()
    with pytest.raises(
        RedditConfigError, match="Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT"
    ):
        require_reddit_settings(empty)
    assert require_reddit_settings(_filled_reddit_settings()).reddit_client_id == "id"


@pytest.mark.unit
def test_require_reddit_settings_uses_get_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("config.get_settings", _empty_reddit_settings)
    with pytest.raises(RedditConfigError, match="Set REDDIT_"):
        require_reddit_settings()
    assert missing_reddit_env_names() == [
        "REDDIT_CLIENT_ID",
        "REDDIT_CLIENT_SECRET",
        "REDDIT_USER_AGENT",
    ]


@pytest.mark.unit
def test_reddit_post_model_schema() -> None:
    assert RedditPost.__table__.schema == "source"
    assert RedditPost.__table__.name == "reddit_posts"
    assert "reddit_id" in RedditPost.__table__.columns
    assert RedditComment.__table__.schema == "source"
    assert RedditComment.__table__.name == "reddit_comments"
    assert "post_reddit_id" in RedditComment.__table__.columns


@pytest.mark.unit
def test_submission_to_row_mapping() -> None:
    scraped = datetime(2026, 9, 4, 12, 0, 0)
    row = submission_to_row(_submission(), scraped_at=scraped)
    assert row is not None
    assert row["reddit_id"] == "abc123"
    assert row["subreddit"] == "nba"
    assert row["title"] == "Warriors win"
    assert row["author"] == "steph"
    assert row["score"] == 42
    assert row["num_comments"] == 7
    assert row["created_utc"] == datetime(2023, 11, 14, 22, 13, 20)
    assert row["permalink"] == "https://www.reddit.com/r/nba/comments/abc123/warriors_win/"
    assert row["selftext"] == "short body"
    assert row["flair"] == "Highlight"
    assert row["author_flair"] == ":gsw-1: Warriors"
    assert row["is_self"] is True
    assert row["scraped_at"] == scraped


@pytest.mark.unit
def test_submission_to_row_skips_blank_id() -> None:
    assert submission_to_row(_submission(id="")) is None
    assert submission_to_row(_submission(id=None)) is None


@pytest.mark.unit
def test_author_deleted_and_selftext_truncated() -> None:
    long_body = "x" * (SELFTEXT_MAX_CHARS + 25)
    row = submission_to_row(
        _submission(author=None, selftext=long_body, link_flair_text=None, is_self=False)
    )
    assert row is not None
    assert row["author"] is None
    assert row["selftext"] is not None
    assert len(row["selftext"]) == SELFTEXT_MAX_CHARS
    assert row["flair"] is None
    assert row["is_self"] is False

    deleted = submission_to_row(_submission(author="[deleted]", selftext=""))
    assert deleted is not None
    assert deleted["author"] is None
    assert deleted["selftext"] is None


@pytest.mark.unit
def test_permalink_and_subreddit_fallbacks() -> None:
    assert _permalink(_submission(permalink="https://old.reddit.com/r/nba/comments/x/")) == (
        "https://old.reddit.com/r/nba/comments/x/"
    )
    assert _permalink(_submission(permalink="r/nba/comments/x/")) == (
        "https://www.reddit.com/r/nba/comments/x/"
    )
    assert _permalink(_submission(id="zz", permalink="")) == "https://www.reddit.com/comments/zz"
    assert _permalink(_submission(id="", permalink="")) == ""
    assert _subreddit_name(_submission(subreddit="warriors")) == "warriors"
    assert _subreddit_name(_submission(subreddit=None)) == ""
    assert _author_name(_submission(author="  ")) is None
    fallback = datetime(2026, 1, 1)
    assert _created_utc(_submission(created_utc=None), fallback=fallback) == fallback
    assert _created_utc(_submission(created_utc="nope"), fallback=fallback) == fallback
    assert _truncate_selftext(None) is None


@pytest.mark.unit
def test_iter_submissions_dedupes_hot_and_top() -> None:
    subreddit = MagicMock()
    first = _submission(id="a")
    second = _submission(id="b")
    third = _submission(id="c")
    subreddit.hot.return_value = [first, second]
    subreddit.top.return_value = [second, third, _submission(id="")]
    got = _iter_submissions(subreddit, limit=10, time_filter="week")
    assert [item.id for item in got] == ["a", "b", "c"]
    subreddit.hot.assert_called_once_with(limit=10)
    subreddit.top.assert_called_once_with(time_filter="week", limit=10)


@pytest.mark.unit
def test_scrape_reddit_upserts_mapped_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    client = MagicMock()
    subreddit = MagicMock()
    subreddit.hot.return_value = [_submission(id="hot1")]
    subreddit.top.return_value = [_submission(id="top1")]
    client.subreddit.return_value = subreddit
    captured: list[dict] = []

    def capture(_session, model, rows, conflict):
        assert model is RedditPost
        assert conflict == ["reddit_id"]
        captured.extend(rows)
        return len(rows)

    monkeypatch.setattr("scrapers.reddit.get_session", lambda: _session(MagicMock()))
    monkeypatch.setattr("scrapers.reddit.upsert_rows", capture)
    written = scrape_reddit(
        subreddit="r/nba",
        limit=5,
        time_filter="day",
        client=client,
        cfg=_filled_reddit_settings(),
    )
    assert written == 2
    assert {row["reddit_id"] for row in captured} == {"hot1", "top1"}
    client.subreddit.assert_called_once_with("nba")


@pytest.mark.unit
def test_scrape_reddit_preserves_team_sub_and_builds_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = MagicMock()
    subreddit = MagicMock()
    subreddit.hot.return_value = []
    subreddit.top.return_value = []
    client.subreddit.return_value = subreddit
    monkeypatch.setattr("scrapers.reddit.get_session", lambda: _session(MagicMock()))
    monkeypatch.setattr("scrapers.reddit.upsert_rows", lambda *args, **kwargs: 0)
    monkeypatch.setattr("scrapers.reddit._reddit_client", lambda cfg: client)
    written = scrape_reddit(subreddit="rockets", cfg=_filled_reddit_settings())
    assert written == 0
    client.subreddit.assert_called_once_with("rockets")
    empty = scrape_reddit(subreddit="r/", client=client, cfg=_filled_reddit_settings())
    assert empty == 0
    assert client.subreddit.call_args_list[-1].args == ("nba",)


@pytest.mark.unit
def test_scrape_reddit_missing_creds_does_not_build_praw(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "scrapers.reddit._reddit_client",
        lambda cfg: (_ for _ in ()).throw(AssertionError("PRAW should not be constructed")),
    )
    with pytest.raises(RedditConfigError, match="Set REDDIT_"):
        scrape_reddit(cfg=_empty_reddit_settings())


@pytest.mark.unit
def test_scrape_reddit_rejects_bad_args() -> None:
    cfg = _filled_reddit_settings()
    with pytest.raises(ValueError, match="time_filter"):
        scrape_reddit(time_filter="year", client=MagicMock(), cfg=cfg)
    with pytest.raises(ValueError, match="limit"):
        scrape_reddit(limit=0, client=MagicMock(), cfg=cfg)
    with pytest.raises(ValueError, match="comments_per_post"):
        scrape_reddit(comments_per_post=-1, client=MagicMock(), cfg=cfg)


@pytest.mark.unit
def test_reddit_client_readonly_and_script(monkeypatch: pytest.MonkeyPatch) -> None:
    constructed: list[dict] = []

    class FakeReddit:
        def __init__(self, **kwargs):
            constructed.append(kwargs)
            self.read_only = False

    monkeypatch.setattr("scrapers.reddit.praw.Reddit", FakeReddit)
    readonly = _reddit_client(_filled_reddit_settings())
    assert readonly.read_only is True
    assert "username" not in constructed[0]
    assert constructed[0]["check_for_updates"] is False

    logged_in = _reddit_client(_filled_reddit_settings(reddit_username="bot", reddit_password="pw"))
    assert logged_in.read_only is False
    assert constructed[1]["username"] == "bot"
    assert constructed[1]["password"] == "pw"


@pytest.mark.unit
def test_default_subreddit_is_nba() -> None:
    assert DEFAULT_SUBREDDIT == "nba"
    assert DEFAULT_COMMENTS_PER_POST == 250


@pytest.mark.unit
def test_comment_to_row_mapping() -> None:
    scraped = datetime(2026, 9, 6, 12, 0, 0)
    row = comment_to_row(_comment(), post_reddit_id="abc123", scraped_at=scraped)
    assert row is not None
    assert row["reddit_id"] == "cmt1"
    assert row["post_reddit_id"] == "abc123"
    assert row["parent_id"] == "t3_abc123"
    assert row["author"] == "fan"
    assert row["body"] == "nice shot"
    assert row["author_flair"] == ":lal-3: Lakers"
    assert row["score"] == 11
    assert row["created_utc"] == datetime(2023, 11, 14, 22, 15, 0)
    assert row["permalink"] == "https://www.reddit.com/r/nba/comments/abc123/warriors_win/cmt1/"
    assert row["scraped_at"] == scraped


@pytest.mark.unit
def test_comment_to_row_skips_blank_ids() -> None:
    assert comment_to_row(_comment(id=""), post_reddit_id="abc123") is None
    assert comment_to_row(_comment(), post_reddit_id="") is None
    assert comment_to_row(_comment(), post_reddit_id="  ") is None
    long_body = "y" * (SELFTEXT_MAX_CHARS + 10)
    row = comment_to_row(
        _comment(author="[deleted]", body=long_body, parent_id=""),
        post_reddit_id="abc123",
    )
    assert row is not None
    assert row["author"] is None
    assert row["parent_id"] is None
    assert row["body"] is not None
    assert len(row["body"]) == SELFTEXT_MAX_CHARS


@pytest.mark.unit
def test_iter_comments_takes_top_n_by_score() -> None:
    low = _comment(id="low", score=1)
    high = _comment(id="high", score=50)
    mid = _comment(id="mid", score=9)

    class MoreComments:
        id = "more1"
        body = None

    forest = _CommentForest([low, high, MoreComments(), mid, _comment(id=""), high])
    got = _iter_comments(SimpleNamespace(comments=forest), limit=2)
    assert [item.id for item in got] == ["high", "mid"]
    assert forest.replace_more_calls == [{"limit": 0}]
    assert _iter_comments(SimpleNamespace(comments=forest), limit=0) == []
    assert _iter_comments(SimpleNamespace(), limit=5) == []


@pytest.mark.unit
def test_scrape_reddit_upserts_comments_for_posts(monkeypatch: pytest.MonkeyPatch) -> None:
    forest = _CommentForest([_comment(id="c1", score=3), _comment(id="c2", score=30)])
    client = MagicMock()
    subreddit = MagicMock()
    subreddit.hot.return_value = [_submission(id="hot1", comments=forest)]
    subreddit.top.return_value = []
    client.subreddit.return_value = subreddit
    captured: dict[str, list[dict]] = {"posts": [], "comments": []}

    def capture(_session, model, rows, conflict):
        if model is RedditPost:
            assert conflict == ["reddit_id"]
            captured["posts"].extend(rows)
        elif model is RedditComment:
            assert conflict == ["reddit_id"]
            captured["comments"].extend(rows)
        else:
            raise AssertionError(model)
        return len(rows)

    monkeypatch.setattr("scrapers.reddit.get_session", lambda: _session(MagicMock()))
    monkeypatch.setattr("scrapers.reddit.upsert_rows", capture)
    written = scrape_reddit(
        subreddit="nba",
        limit=5,
        time_filter="day",
        comments_per_post=1,
        client=client,
        cfg=_filled_reddit_settings(),
    )
    assert written == 1
    assert {row["reddit_id"] for row in captured["posts"]} == {"hot1"}
    assert [row["reddit_id"] for row in captured["comments"]] == ["c2"]
    assert captured["comments"][0]["post_reddit_id"] == "hot1"
    assert forest.replace_more_calls == [{"limit": 0}]


@pytest.mark.unit
def test_scrape_reddit_skips_comments_when_per_post_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    forest = _CommentForest([_comment(id="c1")])
    client = MagicMock()
    subreddit = MagicMock()
    subreddit.hot.return_value = [_submission(id="hot1", comments=forest)]
    subreddit.top.return_value = []
    client.subreddit.return_value = subreddit
    models: list[object] = []

    def capture(_session, model, rows, conflict):
        models.append(model)
        return len(rows)

    monkeypatch.setattr("scrapers.reddit.get_session", lambda: _session(MagicMock()))
    monkeypatch.setattr("scrapers.reddit.upsert_rows", capture)
    scrape_reddit(
        comments_per_post=0,
        client=client,
        cfg=_filled_reddit_settings(),
    )
    assert models == [RedditPost]
    assert forest.replace_more_calls == []


@pytest.mark.unit
def test_scrape_reddit_skips_comments_when_post_id_blank(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    forest = _CommentForest([_comment(id="c1")])
    blank = SimpleNamespace(id="", comments=forest)
    monkeypatch.setattr("scrapers.reddit._iter_submissions", lambda *args, **kwargs: [blank])
    models: list[object] = []

    def capture(_session, model, rows, conflict):
        models.append(model)
        return len(rows)

    monkeypatch.setattr("scrapers.reddit.get_session", lambda: _session(MagicMock()))
    monkeypatch.setattr("scrapers.reddit.upsert_rows", capture)
    written = scrape_reddit(client=MagicMock(), cfg=_filled_reddit_settings())
    assert written == 0
    assert models == [RedditPost]
    assert forest.replace_more_calls == []


@pytest.mark.unit
def test_cli_scrape_reddit_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("main.scrape_reddit", lambda **kwargs: 12)
    defaulted = CliRunner().invoke(cli, ["scrape-reddit"])
    assert defaulted.exit_code == 0
    assert "r/nba" in defaulted.output
    result = CliRunner().invoke(
        cli,
        ["scrape-reddit", "--subreddit", "nba", "--limit", "25", "--time-filter", "week"],
    )
    assert result.exit_code == 0
    assert "12" in result.output
    assert "r/nba" in result.output
    prefixed = CliRunner().invoke(cli, ["scrape-reddit", "--subreddit", "r/"])
    assert prefixed.exit_code == 0
    assert "r/nba" in prefixed.output
    comments = CliRunner().invoke(cli, ["scrape-reddit", "--comments-per-post", "3"])
    assert comments.exit_code == 0


@pytest.mark.unit
def test_cli_scrape_reddit_missing_creds(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(**kwargs):
        raise RedditConfigError(
            "Reddit credentials are missing. Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT."
        )

    monkeypatch.setattr("main.scrape_reddit", boom)
    result = CliRunner().invoke(cli, ["scrape-reddit"])
    assert result.exit_code != 0
    assert "Set REDDIT_" in result.output
    assert "Traceback" not in result.output


@pytest.mark.unit
def test_cli_scrape_reddit_bad_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(**kwargs):
        raise ValueError("limit must be >= 1")

    monkeypatch.setattr("main.scrape_reddit", boom)
    result = CliRunner().invoke(cli, ["scrape-reddit", "--limit", "0"])
    assert result.exit_code != 0
    assert "limit must be >= 1" in result.output


@pytest.mark.unit
def test_cli_scrape_all_skips_reddit_unless_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    called = {"reddit": 0}
    monkeypatch.setattr("main.scrape_teams", lambda: 30)
    monkeypatch.setattr("main.scrape_players", lambda enrich=False: 10)
    monkeypatch.setattr("main.scrape_contracts", lambda: (8, 2))
    monkeypatch.setattr("main.scrape_games", lambda season: 82)
    monkeypatch.setattr("main.scrape_player_game_logs", lambda season, active_only=False: 5)
    monkeypatch.setattr("main.scrape_standings", lambda season: 30)
    monkeypatch.setattr("main.scrape_transactions", lambda season: (9, 20))

    def reddit(**kwargs):
        called["reddit"] += 1
        return 4

    monkeypatch.setattr("main.scrape_reddit", reddit)
    monkeypatch.setattr("main.stamp_cli_success", lambda: None)
    skipped = CliRunner().invoke(cli, ["scrape-all", "--seasons", "2024-25"])
    assert skipped.exit_code == 0
    assert called["reddit"] == 0
    assert "Reddit posts" not in skipped.output

    included = CliRunner().invoke(cli, ["scrape-all", "--seasons", "2024-25", "--with-reddit"])
    assert included.exit_code == 0
    assert called["reddit"] == 1
    assert "Reddit posts: 4" in included.output


@pytest.mark.unit
def test_cli_scrape_all_reddit_failure_uses_existing_slack(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    posted: list[str] = []

    def fake_post(*args, **kwargs):
        posted.append(kwargs["json"]["text"])
        return SimpleNamespace(status_code=200)

    monkeypatch.setattr("notify.requests.post", fake_post)
    monkeypatch.setattr(
        "notify.settings", SimpleNamespace(slack_webhook_url="https://hooks.slack.test/x")
    )
    monkeypatch.setattr("main.scrape_teams", lambda: 30)
    monkeypatch.setattr("main.scrape_players", lambda enrich=False: 10)
    monkeypatch.setattr("main.scrape_contracts", lambda: (8, 2))
    monkeypatch.setattr("main.scrape_games", lambda season: 82)
    monkeypatch.setattr("main.scrape_player_game_logs", lambda season, active_only=False: 5)
    monkeypatch.setattr("main.scrape_standings", lambda season: 30)
    monkeypatch.setattr("main.scrape_transactions", lambda season: (9, 20))

    def boom():
        raise RedditConfigError("Reddit credentials are missing. Set REDDIT_CLIENT_ID.")

    monkeypatch.setattr("main.scrape_reddit", boom)
    result = CliRunner().invoke(cli, ["scrape-all", "--seasons", "2024-25", "--with-reddit"])
    assert result.exit_code == 1
    assert len(posted) == 1
    assert "reddit" in posted[0]
    assert "REDDIT_CLIENT_ID" in posted[0]


@pytest.mark.unit
def test_author_flair_is_separate_from_post_flair() -> None:
    """link_flair_text tags the post; author_flair_text is the user's team badge."""
    row = submission_to_row(_submission(link_flair_text=None, author_flair_text=":nyk-4: Knicks"))
    assert row is not None
    assert row["flair"] is None
    assert row["author_flair"] == ":nyk-4: Knicks"


@pytest.mark.unit
def test_author_flair_missing_blank_and_overlong() -> None:
    from scrapers.reddit import FLAIR_MAX_CHARS

    assert submission_to_row(_submission(author_flair_text=None))["author_flair"] is None
    assert submission_to_row(_submission(author_flair_text="   "))["author_flair"] is None
    long_flair = ":lal-1: " + "x" * (FLAIR_MAX_CHARS + 40)
    row = submission_to_row(_submission(author_flair_text=long_flair))
    assert row is not None
    assert len(row["author_flair"]) == FLAIR_MAX_CHARS

    comment = comment_to_row(_comment(author_flair_text=None), post_reddit_id="abc123")
    assert comment is not None
    assert comment["author_flair"] is None
