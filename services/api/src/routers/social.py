from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from dependencies import get_social_repository
from queries.social import CONTENT_TYPES, ENTITY_TYPES, FLAIR_SCOPES, POST_SORTS
from repositories.social import DEFAULT_SORT, SocialRepository
from schemas import (
    ItemResponse,
    PaginatedResponse,
    PaginationMeta,
    SocialComment,
    SocialEntity,
    SocialFacet,
    SocialFanbase,
    SocialLeader,
    SocialPost,
    SocialPostDetail,
    SocialSummary,
)

router = APIRouter()

# self and link — the rollup groups into exactly these two.


def _validate_sort(sort: str) -> str:
    if sort not in POST_SORTS:
        raise HTTPException(
            status_code=400,
            detail=f"sort must be one of {', '.join(sorted(POST_SORTS))}",
        )
    return sort


def _validate_content_type(content_type: str | None) -> str | None:
    if content_type is None:
        return None
    normalized = content_type.strip().lower()
    if normalized not in CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"content_type must be one of {', '.join(CONTENT_TYPES)}",
        )
    return normalized


def _validate_entity_type(entity_type: str) -> str:
    normalized = entity_type.strip().lower()
    if normalized not in ENTITY_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"entity_type must be one of {', '.join(ENTITY_TYPES)}",
        )
    return normalized


def _validate_scope(scope: str | None) -> str | None:
    if scope is None:
        return None
    normalized = scope.strip().lower()
    if normalized not in FLAIR_SCOPES:
        raise HTTPException(
            status_code=400,
            detail=f"scope must be one of {', '.join(FLAIR_SCOPES)}",
        )
    return normalized


@router.get("/summary", response_model=ItemResponse[SocialSummary])
def get_social_summary(
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    subreddit: Annotated[str | None, Query()] = None,
    repo: SocialRepository = Depends(get_social_repository),
) -> ItemResponse[SocialSummary]:
    """Counts for the page header. `to_date` is inclusive of that whole day."""
    row = repo.get_summary(from_date=from_date, to_date=to_date, subreddit=subreddit)
    return ItemResponse(data=SocialSummary.model_validate(row))


@router.get("/posts", response_model=PaginatedResponse[SocialPost])
def list_social_posts(
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    subreddit: Annotated[str | None, Query()] = None,
    tag: Annotated[str | None, Query()] = None,
    source: Annotated[str | None, Query()] = None,
    content_type: Annotated[str | None, Query()] = None,
    contested: Annotated[bool, Query()] = False,
    search: Annotated[str | None, Query()] = None,
    sort: Annotated[str, Query()] = DEFAULT_SORT,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: SocialRepository = Depends(get_social_repository),
) -> PaginatedResponse[SocialPost]:
    total, rows = repo.list_posts(
        from_date=from_date,
        to_date=to_date,
        subreddit=subreddit,
        tag=tag,
        source=source,
        content_type=_validate_content_type(content_type),
        contested=contested,
        search=search,
        sort=_validate_sort(sort),
        limit=limit,
        offset=offset,
    )
    data = [SocialPost.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=total, limit=limit, offset=offset),
    )


@router.get("/posts/{reddit_id}", response_model=ItemResponse[SocialPostDetail])
def get_social_post(
    reddit_id: str,
    repo: SocialRepository = Depends(get_social_repository),
) -> ItemResponse[SocialPostDetail]:
    row = repo.get_post(reddit_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return ItemResponse(data=SocialPostDetail.model_validate(row))


@router.get("/posts/{reddit_id}/comments", response_model=PaginatedResponse[SocialComment])
def list_social_post_comments(
    reddit_id: str,
    repo: SocialRepository = Depends(get_social_repository),
) -> PaginatedResponse[SocialComment]:
    """The stored top-10 sample for a post, not its thread. Compare against
    the post's `num_comments` before labelling this in a UI."""
    if not repo.post_exists(reddit_id):
        raise HTTPException(status_code=404, detail="Post not found")
    rows = repo.list_post_comments(reddit_id)
    data = [SocialComment.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=len(data), offset=0),
    )


def _leaderboard_response(rows: list[dict], limit: int) -> PaginatedResponse[SocialLeader]:
    data = [SocialLeader.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=limit, offset=0),
    )


@router.get("/tags", response_model=PaginatedResponse[SocialLeader])
def list_social_tags(
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    subreddit: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    repo: SocialRepository = Depends(get_social_repository),
) -> PaginatedResponse[SocialLeader]:
    """Leading title brackets — reporters and content types both land here."""
    rows = repo.list_tags(from_date=from_date, to_date=to_date, subreddit=subreddit, limit=limit)
    return _leaderboard_response(rows, limit)


@router.get("/sources", response_model=PaginatedResponse[SocialLeader])
def list_social_sources(
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    subreddit: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    repo: SocialRepository = Depends(get_social_repository),
) -> PaginatedResponse[SocialLeader]:
    """Link destinations, with self-posts collapsed to the key `self`."""
    rows = repo.list_sources(from_date=from_date, to_date=to_date, subreddit=subreddit, limit=limit)
    return _leaderboard_response(rows, limit)


@router.get("/facets", response_model=PaginatedResponse[SocialFacet])
def list_social_facets(
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    subreddit: Annotated[str | None, Query()] = None,
    repo: SocialRepository = Depends(get_social_repository),
) -> PaginatedResponse[SocialFacet]:
    """Counts for the content-type chips, over the same window as the feed."""
    rows = repo.list_facets(from_date=from_date, to_date=to_date, subreddit=subreddit)
    data = [SocialFacet.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=len(data), offset=0),
    )


@router.get("/entities", response_model=PaginatedResponse[SocialEntity])
def list_social_entities(
    entity_type: Annotated[str, Query()] = "player",
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    repo: SocialRepository = Depends(get_social_repository),
) -> PaginatedResponse[SocialEntity]:
    """Player or team social. Players match on full name only — a post that says
    only "Jokic" or "Kawhi" is not counted against that player."""
    rows = repo.list_entities(
        entity_type=_validate_entity_type(entity_type),
        from_date=from_date,
        to_date=to_date,
        limit=limit,
    )
    data = [SocialEntity.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=limit, offset=0),
    )


@router.get("/fanbases", response_model=PaginatedResponse[SocialFanbase])
def list_social_fanbases(
    scope: Annotated[str | None, Query()] = None,
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    subreddit: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 32,
    repo: SocialRepository = Depends(get_social_repository),
) -> PaginatedResponse[SocialFanbase]:
    """Which fanbases are in the thread, from r/nba user flair.

    Counts posts and comments together. About half of authors carry no flair and
    are absent here, and flair is the author's *current* badge as of the scrape,
    so this describes who is talking now rather than who was talking then.
    """
    rows = repo.list_fanbases(
        scope=_validate_scope(scope),
        from_date=from_date,
        to_date=to_date,
        subreddit=subreddit,
        limit=limit,
    )
    data = [SocialFanbase.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=limit, offset=0),
    )
