from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from config import settings

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


def upsert_rows(
    session: Session,
    model: type,
    rows: list[dict],
    conflict_columns: list[str],
) -> int:
    if not rows:
        return 0
    skip_update = set(conflict_columns) | {"id"}
    update_cols = [
        column.name
        for column in model.__table__.columns  # ty: ignore[unresolved-attribute]
        if column.name not in skip_update
    ]
    stmt = insert(model).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=conflict_columns,
        set_={col: getattr(stmt.excluded, col) for col in update_cols},
    )
    session.execute(stmt)
    session.commit()
    return len(rows)
