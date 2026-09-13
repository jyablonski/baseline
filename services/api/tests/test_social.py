from datetime import datetime

import pytest

POST_ID = "1wcz33y"

POST_ROW = {
    "reddit_id": POST_ID,
    "subreddit": "nba",
    "title": "BREAKING: Kawhi Leonard's deal under investigation by the Justice Department",
    "author": "horseshoeoverlook",
    "score": 12817,
    "num_comments": 1952,
    "created_utc": datetime(2026, 9, 10, 23, 14, 47),
    "permalink": f"https://www.reddit.com/r/nba/comments/{POST_ID}/breaking/",
    "url": f"https://www.reddit.com/r/nba/comments/{POST_ID}/breaking/",
    "flair": None,
    "is_self": True,
    "scraped_at": datetime(2026, 9, 11, 6, 0, 0),
    "tag": None,
    "source": "self",
    "content_type": "discussion",
    "is_contested": False,
    "discussion_ratio": 0.152,
    "captured_comment_count": 10,
    "top_comment_score": 13878,
    "captured_comment_score": 45000,
    "top_comment_leverage": 1.083,
    "comment_concentration": 3.511,
    "player_mentions": ["Kawhi Leonard"],
    "team_mentions": ["LA Clippers"],
    "author_flair": ":lal-1: Lakers",
    "flair_scope": "team",
    "flair_team_abbreviation": "LAL",
    "flair_team_name": "Los Angeles Lakers",
}

LEADER_ROW = {
    "key": "Highlight",
    "post_count": 22,
    "self_post_count": 3,
    "link_post_count": 19,
    "total_score": 12043,
    "top_score": 1906,
    "avg_score": 547.0,
    "median_score": 332.0,
    "total_comments": 1683,
    "median_comments": 61.0,
    "median_discussion_ratio": 0.18,
}

COMMENT_ROW = {
    "reddit_id": "p91u8zk",
    "post_reddit_id": POST_ID,
    "parent_id": f"t3_{POST_ID}",
    "author": "smokeymicpot",
    "body": "ESPN might have gotten this like way wrong.",
    "score": 13878,
    "created_utc": datetime(2026, 9, 10, 23, 20, 0),
    "permalink": "https://www.reddit.com/r/nba/comments/1wcz33y/_/p91u8zk",
    "is_top_level": True,
    "is_removed": False,
    "author_flair": ":nyk-4: Knicks",
    "flair_scope": "team",
    "flair_team_abbreviation": "NYK",
    "flair_team_name": "New York Knicks",
}


@pytest.mark.unit
def test_list_posts(client, session, mapping_row, query_result) -> None:
    session.queue = [query_result(scalar=1), query_result([mapping_row(POST_ROW)])]
    response = client.get("/api/v1/social/posts", params={"limit": 10})
    assert response.status_code == 200
    payload = response.json()["data"][0]
    assert payload["reddit_id"] == POST_ID
    assert payload["top_comment_leverage"] == 1.083
    # Naive warehouse timestamps are published as UTC.
    assert payload["created_utc"].endswith("Z")


@pytest.mark.unit
def test_list_posts_binds_filters(client, session, query_result) -> None:
    session.queue = [query_result(scalar=0), query_result([])]
    response = client.get(
        "/api/v1/social/posts",
        params={
            "from_date": "2026-09-07",
            "to_date": "2026-09-10",
            "tag": "Highlight",
            "source": "Streamable.com",
            "contested": "true",
            "search": "kawhi",
        },
    )
    assert response.status_code == 200
    params = session.calls[0][1]
    assert params["search"] == "%kawhi%"
    assert params["tag"] == "Highlight"
    assert params["contested"] is True
    assert str(params["from_date"]) == "2026-09-07"


@pytest.mark.unit
@pytest.mark.parametrize("sort", ["recent", "score", "comments", "discussion", "leverage"])
def test_list_posts_accepts_every_sort(client, session, query_result, sort) -> None:
    session.queue = [query_result(scalar=0), query_result([])]
    response = client.get("/api/v1/social/posts", params={"sort": sort})
    assert response.status_code == 200


@pytest.mark.unit
def test_list_posts_rejects_unknown_sort(client) -> None:
    response = client.get("/api/v1/social/posts", params={"sort": "upvotes"})
    assert response.status_code == 400


@pytest.mark.unit
def test_list_posts_rejects_unknown_content_type(client) -> None:
    response = client.get("/api/v1/social/posts", params={"content_type": "meme"})
    assert response.status_code == 400


@pytest.mark.unit
def test_list_posts_normalizes_content_type(client, session, query_result) -> None:
    session.queue = [query_result(scalar=0), query_result([])]
    response = client.get("/api/v1/social/posts", params={"content_type": " Highlight "})
    assert response.status_code == 200
    assert session.calls[0][1]["content_type"] == "highlight"


@pytest.mark.unit
def test_get_post_returns_selftext(client, session, mapping_row, query_result) -> None:
    session.queue = [query_result([mapping_row({**POST_ROW, "selftext": "body text"})])]
    response = client.get(f"/api/v1/social/posts/{POST_ID}")
    assert response.status_code == 200
    assert response.json()["data"]["selftext"] == "body text"


@pytest.mark.unit
def test_get_post_missing(client, session, query_result) -> None:
    session.queue = [query_result([])]
    response = client.get("/api/v1/social/posts/nope")
    assert response.status_code == 404


@pytest.mark.unit
def test_list_post_comments(client, session, mapping_row, query_result) -> None:
    session.queue = [query_result(scalar=1), query_result([mapping_row(COMMENT_ROW)])]
    response = client.get(f"/api/v1/social/posts/{POST_ID}/comments")
    assert response.status_code == 200
    body = response.json()
    assert body["data"][0]["is_top_level"] is True
    assert body["meta"]["total"] == 1


@pytest.mark.unit
def test_list_post_comments_missing_post(client, session, query_result) -> None:
    session.queue = [query_result(scalar=None)]
    response = client.get("/api/v1/social/posts/nope/comments")
    assert response.status_code == 404


@pytest.mark.unit
def test_get_summary(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            [
                mapping_row(
                    {
                        "post_count": 169,
                        "author_count": 121,
                        "reported_comment_count": 31280,
                        "captured_comment_count": 1733,
                        "contested_post_count": 14,
                        "total_score": 120544,
                        "top_score": 12817,
                        "first_post_at": datetime(2026, 8, 28, 12, 0, 0),
                        "last_post_at": datetime(2026, 9, 11, 5, 29, 41),
                        "last_scraped_at": datetime(2026, 9, 11, 6, 0, 0),
                    }
                )
            ]
        )
    ]
    response = client.get("/api/v1/social/summary", params={"from_date": "2026-09-07"})
    assert response.status_code == 200
    data = response.json()["data"]
    # The sample we store is far smaller than the threads it came from.
    assert data["captured_comment_count"] < data["reported_comment_count"]
    assert data["last_scraped_at"].endswith("Z")


@pytest.mark.unit
@pytest.mark.parametrize("path", ["tags", "sources", "authors"])
def test_leaderboards(client, session, mapping_row, query_result, path) -> None:
    session.queue = [query_result([mapping_row(LEADER_ROW)])]
    response = client.get(f"/api/v1/social/{path}", params={"limit": 5})
    assert response.status_code == 200
    body = response.json()
    assert body["data"][0]["key"] == "Highlight"
    assert body["data"][0]["median_comments"] == 61.0
    assert body["data"][0]["link_post_count"] == 19
    assert body["meta"]["limit"] == 5
    assert session.calls[0][1]["limit"] == 5


@pytest.mark.unit
def test_composition_splits_self_from_link(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            [
                mapping_row({**LEADER_ROW, "key": "self", "median_discussion_ratio": 2.53}),
                mapping_row({**LEADER_ROW, "key": "link", "median_discussion_ratio": 0.15}),
            ]
        )
    ]
    response = client.get("/api/v1/social/composition")
    assert response.status_code == 200
    keys = [row["key"] for row in response.json()["data"]]
    assert keys == ["self", "link"]


@pytest.mark.unit
def test_facets(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            [
                mapping_row({"key": "discussion", "post_count": 15, "contested_post_count": 4}),
                mapping_row({"key": "highlight", "post_count": 12, "contested_post_count": 0}),
            ]
        )
    ]
    response = client.get("/api/v1/social/facets")
    assert response.status_code == 200
    assert response.json()["data"][0]["contested_post_count"] == 4


@pytest.mark.unit
def test_rhythm_returns_quiet_hours_as_zero(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            [
                mapping_row(
                    {
                        "hour_utc": hour,
                        "post_count": 0 if hour else 3,
                        "total_comments": 0 if hour else 112,
                        "median_score": None if hour else 204.0,
                    }
                )
                for hour in range(24)
            ]
        )
    ]
    response = client.get("/api/v1/social/rhythm")
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) == 24
    assert data[1]["post_count"] == 0
    assert data[1]["median_score"] is None


@pytest.mark.unit
@pytest.mark.parametrize("entity_type", ["player", "team"])
def test_entities(client, session, mapping_row, query_result, entity_type) -> None:
    session.queue = [
        query_result(
            [
                mapping_row(
                    {
                        "entity_id": "33333333-3333-4333-8333-333333333333",
                        "entity_name": "Kawhi Leonard",
                        "entity_abbreviation": None,
                        "post_count": 9,
                        "comment_count": 63,
                        "total_post_score": 41022,
                        "top_post_score": 12817,
                        "primary_color": None,
                        "alternate_color": None,
                    }
                )
            ]
        )
    ]
    response = client.get("/api/v1/social/entities", params={"entity_type": entity_type})
    assert response.status_code == 200
    assert response.json()["data"][0]["post_count"] == 9
    assert response.json()["data"][0]["entity_nickname"] is None
    assert session.calls[0][1]["entity_type"] == entity_type


@pytest.mark.unit
def test_team_entities_carry_the_nickname(client, session, mapping_row, query_result) -> None:
    from queries.social import LIST_ENTITIES

    session.queue = [
        query_result(
            [
                mapping_row(
                    {
                        "entity_id": "a79dabb2-26c5-443c-bbb4-cabdd8db5958",
                        "entity_name": "LA Clippers",
                        "entity_abbreviation": "LAC",
                        "entity_nickname": "Clippers",
                        "post_count": 41,
                        "comment_count": 66,
                        "total_post_score": 9000,
                        "top_post_score": 2100,
                        "primary_color": "#C8102E",
                        "alternate_color": None,
                    }
                )
            ]
        )
    ]
    response = client.get("/api/v1/social/entities", params={"entity_type": "team"})
    assert response.status_code == 200
    assert response.json()["data"][0]["entity_nickname"] == "Clippers"
    assert "dim_teams.nickname AS entity_nickname" in str(LIST_ENTITIES)


@pytest.mark.unit
def test_entities_rejects_unknown_type(client) -> None:
    response = client.get("/api/v1/social/entities", params={"entity_type": "coach"})
    assert response.status_code == 400


@pytest.mark.unit
def test_posts_carry_mentions(client, session, mapping_row, query_result) -> None:
    session.queue = [query_result(scalar=1), query_result([mapping_row(POST_ROW)])]
    response = client.get("/api/v1/social/posts")
    assert response.status_code == 200
    assert response.json()["data"][0]["player_mentions"] == ["Kawhi Leonard"]


@pytest.mark.unit
def test_entity_sql_counts_a_post_once_however_often_it_is_named() -> None:
    from queries.social import LIST_ENTITIES

    sql = str(LIST_ENTITIES)
    assert "gold.fct_reddit_entity_mentions" in sql
    assert "count(DISTINCT post_reddit_id)" in sql
    # Brand colours come from the team dimension, so players get nulls.
    assert "LEFT JOIN gold.dim_teams" in sql


@pytest.mark.unit
def test_every_sort_ends_in_a_unique_tiebreaker() -> None:
    """OFFSET paging over a non-unique ordering repeats and skips rows.

    The keys above tie constantly: every score-0 post has a null
    top_comment_leverage and a score of 0, which was 23 of the first 169 posts.
    """
    from queries.social import POST_SORTS

    for key, order in POST_SORTS.items():
        assert order.strip().endswith("posts.reddit_id DESC"), key


@pytest.mark.unit
def test_count_query_skips_the_rollups() -> None:
    """Both rollups are per-post left joins, so a count must not pay for them."""
    from queries.social import LIST_POSTS_COUNT

    sql = str(LIST_POSTS_COUNT)
    assert "gold.fct_reddit_comments" not in sql
    assert "gold.fct_reddit_entity_mentions" not in sql
    assert "LATERAL" not in sql


@pytest.mark.unit
def test_feed_pages_before_it_rolls_up() -> None:
    """The lateral must run per returned row, not per row that survives filtering."""
    from queries.social import LIST_POSTS, SORTS_NEEDING_COMMENTS

    for key, statement in LIST_POSTS.items():
        sql = str(statement)
        assert "WITH page AS" in sql, key
        # The mention rollup is never needed to order, so it stays off the page CTE.
        assert sql.index("LIMIT :limit") < sql.index("gold.fct_reddit_entity_mentions"), key
        page = sql[: sql.index("LIMIT :limit")]
        assert ("gold.fct_reddit_comments" in page) is (key in SORTS_NEEDING_COMMENTS), key


@pytest.mark.unit
def test_tag_filter_is_an_exact_match() -> None:
    """/tags hands back keys to filter on; ILIKE let a user-supplied % wildcard."""
    from queries.social import LIST_POSTS_COUNT

    assert "lower(:tag)" in str(LIST_POSTS_COUNT)


@pytest.mark.unit
def test_post_sql_uses_gold_tables_and_comment_rollup() -> None:
    from queries.social import LIST_POSTS, LIST_POSTS_COUNT

    sql = str(LIST_POSTS["discussion"])
    assert "gold.fct_reddit_posts" in sql
    assert "gold.fct_reddit_comments" in sql
    # The floor keeps zero-score posts comparable instead of dividing by zero.
    assert "greatest(posts.score, 1)" in sql
    assert "ORDER BY discussion_ratio DESC" in sql
    assert "gold.fct_reddit_posts" in str(LIST_POSTS_COUNT)


@pytest.mark.unit
def test_sort_fragments_are_not_interpolated_from_input() -> None:
    from queries.social import LIST_POSTS, POST_SORTS

    assert set(LIST_POSTS) == set(POST_SORTS)


@pytest.mark.unit
def test_score_ratios_are_null_at_zero_score_but_discussion_ratio_is_floored() -> None:
    """A score of 0 is Reddit's floor, so score-against-score ratios are meaningless.

    discussion_ratio keeps its floor on purpose: it is the feed's sort key, and
    nulling it would drop exactly the contested posts it exists to surface.
    """
    from queries.social import DISCUSSION_RATIO, POSTS_SELECT

    assert "greatest(posts.score, 1)" in DISCUSSION_RATIO
    for alias in ("top_comment_leverage", "comment_concentration"):
        fragment = POSTS_SELECT.split(f"AS {alias}")[0].rsplit("round(", 1)[-1]
        assert "nullif(posts.score, 0)" in fragment, alias


@pytest.mark.unit
def test_contested_threshold_matches_the_observed_score_floor() -> None:
    from queries.social import CONTESTED_MAX_SCORE, CONTESTED_MIN_COMMENTS, IS_CONTESTED

    assert CONTESTED_MAX_SCORE == 25
    assert CONTESTED_MIN_COMMENTS == 50
    assert f"posts.score <= {CONTESTED_MAX_SCORE}" in IS_CONTESTED


@pytest.mark.unit
def test_statements_declare_only_intended_bind_params() -> None:
    """Regex metacharacters must not read as bind params.

    text() treats ":name" as a parameter, so a non-capturing group like
    "(?:https?" silently becomes a required bind named `https`.
    """
    from queries.social import (
        GET_POST,
        GET_SUMMARY,
        LIST_AUTHORS,
        LIST_COMPOSITION,
        LIST_ENTITIES,
        LIST_FACETS,
        LIST_FANBASES,
        LIST_POST_COMMENTS,
        LIST_POSTS,
        LIST_POSTS_COUNT,
        LIST_RHYTHM,
        LIST_SOURCES,
        LIST_TAGS,
        POST_EXISTS,
    )

    expected = {
        LIST_POSTS_COUNT: {
            "from_date",
            "to_date",
            "subreddit",
            "tag",
            "source",
            "content_type",
            "contested",
            "search",
        },
        GET_POST: {"reddit_id"},
        POST_EXISTS: {"reddit_id"},
        LIST_POST_COMMENTS: {"reddit_id"},
        GET_SUMMARY: {"from_date", "to_date", "subreddit"},
        LIST_TAGS: {"from_date", "to_date", "subreddit", "limit"},
        LIST_SOURCES: {"from_date", "to_date", "subreddit", "limit"},
        LIST_AUTHORS: {"from_date", "to_date", "subreddit", "limit"},
        LIST_COMPOSITION: {"from_date", "to_date", "subreddit", "limit"},
        LIST_FACETS: {"from_date", "to_date", "subreddit"},
        LIST_RHYTHM: {"from_date", "to_date", "subreddit"},
        LIST_ENTITIES: {"entity_type", "from_date", "to_date", "limit"},
        LIST_FANBASES: {"scope", "from_date", "to_date", "subreddit", "limit"},
    }
    for statement, names in expected.items():
        assert set(statement._bindparams) == names

    for sort, statement in LIST_POSTS.items():
        assert set(statement._bindparams) == expected[LIST_POSTS_COUNT] | {"limit", "offset"}, sort


@pytest.mark.unit
def test_posts_and_comments_carry_resolved_flair(
    client, session, mapping_row, query_result
) -> None:
    session.queue = [query_result(scalar=1), query_result([mapping_row(POST_ROW)])]
    post = client.get("/api/v1/social/posts").json()["data"][0]
    assert post["flair_team_abbreviation"] == "LAL"

    session.queue = [query_result(scalar=1), query_result([mapping_row(COMMENT_ROW)])]
    comment = client.get(f"/api/v1/social/posts/{POST_ID}/comments").json()["data"][0]
    assert comment["flair_scope"] == "team"
    assert comment["flair_team_abbreviation"] == "NYK"


@pytest.mark.unit
def test_fanbases(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            [
                mapping_row(
                    {
                        "flair_scope": "team",
                        "flair_team_id": "11111111-1111-4111-8111-111111111111",
                        "flair_team_abbreviation": "LAL",
                        "flair_team_nickname": "Lakers",
                        "label": "Los Angeles Lakers",
                        "document_count": 84,
                        "post_count": 9,
                        "comment_count": 75,
                        "author_count": 61,
                        "primary_color": "#552583",
                        "alternate_color": "#FDB927",
                    }
                ),
                mapping_row(
                    {
                        "flair_scope": "other",
                        "flair_team_id": None,
                        "flair_team_abbreviation": None,
                        "flair_team_nickname": None,
                        "label": "Philippines",
                        "document_count": 4,
                        "post_count": 0,
                        "comment_count": 4,
                        "author_count": 3,
                        "primary_color": None,
                        "alternate_color": None,
                    }
                ),
            ]
        )
    ]
    response = client.get("/api/v1/social/fanbases", params={"scope": " Team "})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data[0]["flair_team_abbreviation"] == "LAL"
    # A non-team flair keeps its label and carries no team id.
    assert data[1]["label"] == "Philippines"
    assert data[1]["flair_team_id"] is None
    assert session.calls[0][1]["scope"] == "team"


@pytest.mark.unit
def test_fanbases_rejects_unknown_scope(client) -> None:
    assert client.get("/api/v1/social/fanbases", params={"scope": "bandwagon"}).status_code == 400


@pytest.mark.unit
def test_flair_join_is_shared_by_the_feed_and_the_detail_query() -> None:
    """POSTS_SELECT reads flair.*, so every path selecting it must join it."""
    from queries.social import GET_POST, LIST_POSTS

    for name, sql in [("detail", str(GET_POST))] + [
        (key, str(stmt)) for key, stmt in LIST_POSTS.items()
    ]:
        assert "gold.fct_reddit_flair" in sql, name


@pytest.mark.unit
def test_fanbase_sql_counts_posts_and_comments_together() -> None:
    from queries.social import LIST_FANBASES

    sql = str(LIST_FANBASES)
    assert "UNION ALL" in sql
    assert "gold.fct_reddit_posts" in sql and "gold.fct_reddit_comments" in sql
    # An unflaired author is not a fanbase of "unknown"; they are simply absent.
    assert "author_flair IS NOT NULL" in sql
    # The rail is 320px, so it needs the nickname rather than the full club name.
    assert "teams.nickname AS flair_team_nickname" in sql
