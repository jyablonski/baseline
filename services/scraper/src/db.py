from collections.abc import Generator, Iterator, Sequence
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from config import settings

# Postgres bind limit is 65535. Stay under it even when a model has many columns.
# 100 rows keeps failure logs readable (500-row batches dumped thousands of binds).
PG_MAX_BIND_PARAMS = 65535
UPSERT_BATCH_SIZE = 100

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    hide_parameters=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


@contextmanager
def get_session() -> Generator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def upsert_batch_size(column_count: int, requested: int = UPSERT_BATCH_SIZE) -> int:
    """Cap a row batch so one INSERT stays under Postgres' bind-parameter limit."""
    cols = max(1, column_count)
    size = max(1, requested)
    max_rows = max(1, PG_MAX_BIND_PARAMS // cols)
    return min(size, max_rows)


def iter_upsert_batches(
    rows: Sequence[dict],
    *,
    batch_size: int = UPSERT_BATCH_SIZE,
    column_count: int,
) -> Iterator[list[dict]]:
    size = upsert_batch_size(column_count, batch_size)
    for offset in range(0, len(rows), size):
        yield list(rows[offset : offset + size])


def upsert_rows(
    session: Session,
    model: type,
    rows: list[dict],
    conflict_columns: list[str],
    batch_size: int = UPSERT_BATCH_SIZE,
) -> int:
    """Idempotent insert via ON CONFLICT DO UPDATE. Skips updating PK / `id`."""
    if not rows:
        return 0

    skip_update = set(conflict_columns) | {"id"}
    update_cols = [
        column.name
        for column in model.__table__.columns  # ty: ignore[unresolved-attribute]
        if column.name not in skip_update
    ]
    column_count = len(model.__table__.columns)  # ty: ignore[unresolved-attribute]

    written = 0
    for batch in iter_upsert_batches(rows, batch_size=batch_size, column_count=column_count):
        stmt = insert(model).values(batch)
        stmt = stmt.on_conflict_do_update(
            index_elements=conflict_columns,
            set_={col: getattr(stmt.excluded, col) for col in update_cols},
        )
        session.execute(stmt)
        written += len(batch)
    session.commit()
    return written
