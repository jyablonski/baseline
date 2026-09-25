"""Operator-only view of ingestion, dbt, and ML health.

Behind a bearer token (``ADMIN_API_TOKEN``) and **fails closed**: with no
token configured every route returns 503 rather than serving the data
publicly. The Next.js /admin page holds the token server-side and is itself
gated by GitHub OAuth, so the token never reaches a browser.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status

from dependencies import get_admin_repository, require_admin_token
from repositories.admin import AdminRepository, JobAlreadyPendingError
from schemas import AdminHealth, AdminJob, ItemResponse, JobRequest, PipelineRun

router = APIRouter(dependencies=[Depends(require_admin_token)])


@router.get("/health", response_model=ItemResponse[AdminHealth])
def get_admin_health(
    run_limit: int = Query(20, ge=1, le=100),
    run_offset: int = Query(0, ge=0),
    repo: AdminRepository = Depends(get_admin_repository),
) -> ItemResponse[AdminHealth]:
    """Everything the dashboard needs in one round trip."""
    return ItemResponse(data=AdminHealth.model_validate(repo.get_health(run_limit, run_offset)))


@router.get("/runs", response_model=list[PipelineRun])
def get_admin_runs(
    limit: int = Query(50, ge=1, le=200),
    repo: AdminRepository = Depends(get_admin_repository),
) -> list[PipelineRun]:
    return [PipelineRun.model_validate(row) for row in repo.get_recent_runs(limit)]


@router.get("/jobs", response_model=list[AdminJob])
def list_admin_jobs(
    limit: int = Query(20, ge=1, le=100),
    repo: AdminRepository = Depends(get_admin_repository),
) -> list[AdminJob]:
    return [AdminJob.model_validate(job) for job in repo.get_jobs(limit)]


@router.post("/jobs", response_model=ItemResponse[AdminJob], status_code=status.HTTP_202_ACCEPTED)
def enqueue_admin_job(
    request: JobRequest,
    repo: AdminRepository = Depends(get_admin_repository),
) -> ItemResponse[AdminJob]:
    """Queue a job for the host runner to execute.

    202, not 200: nothing has run yet. The API never executes these — it has no
    Docker socket and must not be given one — so a host-side runner claims the
    row and reports back.
    """
    try:
        job = repo.enqueue_job(request.job_type, requested_by=request.requested_by)
    except JobAlreadyPendingError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return ItemResponse(data=AdminJob.model_validate(job))
