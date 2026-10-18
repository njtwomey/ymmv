"""SQLite storage (SQLAlchemy 2.0). The schema is managed by Alembic (src/ymmv/migrations).

Tables:
  cars          the car definitions from cars.yaml, copied in on each scrape
  scrape_runs   one row per (source, car) scrape: start/finish, and whether it completed
  listings      one row per advert ever seen, in the standard schema (schema.ListingRecord)
  observations  one row per (listing, run): price, mileage and the raw source data,
                so parsing can be improved later without re-scraping
  marks         the user's marks on listings (interesting / want more / ...); written
                by the web app, never touched by scrapes
  saved_models  model configurations saved from the web app (filters, formula, scores)
  errata        field-level corrections to listings (before → after, with reason and
                evidence); re-applied on every scrape, see apply_errata

Sold prices are inferred. After a *complete* run of a source for a car, any
still-active listing of that (source, car) that the run didn't see is marked
"delisted" at the run's start time. Its last asking price is the sold-price proxy.
A delisted advert that reappears is switched back to active.
"""

from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from alembic import command
from alembic.config import Config
from loguru import logger
from sqlalchemy import JSON, CursorResult, ForeignKey, String, UniqueConstraint, create_engine, inspect, select, update
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

from .cars import Car as CarSpec
from .schema import ListingRecord

MIGRATIONS = Path(__file__).parent / "migrations"


def utcnow() -> datetime:
    # SQLite has no timezone support: store naive UTC everywhere.
    return datetime.now(UTC).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class Car(Base):
    __tablename__ = "cars"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    label: Mapped[str]
    make: Mapped[str]
    model: Mapped[str]
    doors: Mapped[int | None]
    body_type: Mapped[str | None]
    trims: Mapped[list[str]] = mapped_column(JSON, default=list)  # trim family names, in order
    spec: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class ScrapeRun(Base):
    __tablename__ = "scrape_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(32), index=True)
    car_id: Mapped[str | None] = mapped_column(String(64), index=True)
    started_at: Mapped[datetime] = mapped_column(default=utcnow)
    finished_at: Mapped[datetime | None]
    complete: Mapped[bool] = mapped_column(default=False)
    n_seen: Mapped[int] = mapped_column(default=0)
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Listing(Base):
    __tablename__ = "listings"
    __table_args__ = (UniqueConstraint("source", "source_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(32))
    source_id: Mapped[str] = mapped_column(String(64))
    car_id: Mapped[str | None] = mapped_column(String(64), index=True)
    # Standard fields: see schema.ListingRecord.
    url: Mapped[str | None]
    title: Mapped[str | None]
    variant: Mapped[str | None]
    make: Mapped[str | None]
    model: Mapped[str | None]
    trim: Mapped[str | None] = mapped_column(String(32))
    engine_l: Mapped[float | None]
    fuel: Mapped[str | None] = mapped_column(String(16))
    transmission: Mapped[str | None] = mapped_column(String(16))
    doors: Mapped[int | None]
    body_type: Mapped[str | None]
    colour: Mapped[str | None]
    condition: Mapped[str | None] = mapped_column(String(16))
    seller_type: Mapped[str | None] = mapped_column(String(16))
    year: Mapped[int | None]
    plate: Mapped[str | None] = mapped_column(String(8))
    mileage: Mapped[int | None]
    location: Mapped[str | None]
    distance_miles: Mapped[int | None]
    price_gbp: Mapped[int | None]  # latest asking price
    reserved: Mapped[bool] = mapped_column(default=False)
    writeoff: Mapped[str | None] = mapped_column(String(8))
    price_indicator: Mapped[str | None] = mapped_column(String(8))
    # Tracking.
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    first_seen_at: Mapped[datetime]
    last_seen_at: Mapped[datetime]
    delisted_at: Mapped[datetime | None]

    observations: Mapped[list["Observation"]] = relationship(back_populates="listing")


class Observation(Base):
    __tablename__ = "observations"
    __table_args__ = (UniqueConstraint("listing_id", "run_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"), index=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("scrape_runs.id"), index=True)
    observed_at: Mapped[datetime]
    price_gbp: Mapped[int | None]
    mileage: Mapped[int | None]
    raw: Mapped[dict[str, Any]] = mapped_column(JSON)

    listing: Mapped[Listing] = relationship(back_populates="observations")


class Mark(Base):
    __tablename__ = "marks"

    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"), primary_key=True)
    mark: Mapped[str] = mapped_column(String(32))  # interesting | want_more | contacted | rejected
    note: Mapped[str | None]
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)


class Erratum(Base):
    """A correction to one field of one listing, e.g. year 2024 → 2018.

    The listings table shows the corrected value; the raw scraped data in
    observations is never changed. An erratum applies only while the source still
    shows its `before` value, so a fix can't overwrite data the source has changed.
    """

    __tablename__ = "errata"

    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"), index=True)
    field: Mapped[str] = mapped_column(String(64))  # a listings column, e.g. "year"
    before: Mapped[Any] = mapped_column(JSON, nullable=True)  # the value as scraped (may be null)
    after: Mapped[Any] = mapped_column(JSON, nullable=True)  # the corrected value
    reason: Mapped[str]
    evidence: Mapped[str | None]  # e.g. a URL and what it shows
    created_by: Mapped[str] = mapped_column(String(64), default="claude")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    active: Mapped[bool] = mapped_column(default=True)
    reverted_at: Mapped[datetime | None]


class SavedModel(Base):
    """A model configuration saved from the web app: filters + formula + its scores."""

    __tablename__ = "saved_models"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
    car_id: Mapped[str | None] = mapped_column(String(64), index=True)
    formula: Mapped[str]
    folds: Mapped[int]
    standardise: Mapped[bool]
    filters: Mapped[dict[str, Any]] = mapped_column(JSON)  # the dashboard's selection criteria
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON)  # n, k, r2, adj_r2, sigma, cv_* at save time
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


# ----------------------------------------------------------------- engine
def alembic_config(path: Path) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{path}")
    return cfg


def connect(path: Path) -> sessionmaker[Session]:
    """Open the database, bringing its schema up to date first."""
    path.parent.mkdir(parents=True, exist_ok=True)
    # Wait up to 30s for a lock (the web app writes marks while scrapes run).
    engine = create_engine(f"sqlite:///{path}", connect_args={"timeout": 30})
    cfg = alembic_config(path)
    tables = set(inspect(engine).get_table_names())
    if "listings" in tables and "alembic_version" not in tables:
        # A database from before migrations existed: it matches the baseline.
        command.stamp(cfg, "0001")
    command.upgrade(cfg, "head")
    with engine.connect() as conn:
        # WAL (persistent once set): readers never block on, or block, a running scrape.
        conn.exec_driver_sql("PRAGMA journal_mode=WAL")
    return sessionmaker(engine)


# ----------------------------------------------------------------- writes
def sync_car(session: Session, car: CarSpec) -> None:
    session.merge(
        Car(
            id=car.id,
            label=car.label,
            make=car.make,
            model=car.model,
            doors=car.doors,
            body_type=car.body_type,
            trims=[t.name for t in car.trims],
            spec=car.model_dump(mode="json"),
        )
    )


def record(session: Session, run: ScrapeRun, rec: ListingRecord, raw: dict[str, Any]) -> None:
    """Upsert a listing from one sighting and add its observation for this run.

    Runs can arrive out of order (e.g. an imported older snapshot): an older
    sighting only extends first_seen_at and never overwrites newer fields.
    """
    fields = rec.model_dump() | {"car_id": run.car_id}
    listing = session.scalar(select(Listing).where(Listing.source == run.source, Listing.source_id == rec.source_id))
    if listing is None:
        listing = Listing(source=run.source, first_seen_at=run.started_at, last_seen_at=run.started_at, **fields)
        session.add(listing)
    elif run.started_at >= listing.last_seen_at:
        for k, v in fields.items():
            setattr(listing, k, v)
        listing.last_seen_at = run.started_at
        listing.status, listing.delisted_at = "active", None
    else:
        listing.first_seen_at = min(listing.first_seen_at, run.started_at)
    session.flush()
    apply_errata(session, listing)
    exists = session.scalar(
        select(Observation.id).where(Observation.listing_id == listing.id, Observation.run_id == run.id)
    )
    if exists is None:
        session.add(
            Observation(
                listing_id=listing.id,
                run_id=run.id,
                observed_at=run.started_at,
                price_gbp=rec.price_gbp,
                mileage=rec.mileage,
                raw=raw,
            )
        )


# ----------------------------------------------------------------- errata
CORRECTABLE = {c.name for c in Listing.__table__.columns} - {
    "id",
    "source",
    "source_id",
    "first_seen_at",
    "last_seen_at",
}


def apply_errata(session: Session, listing: Listing) -> None:
    """Re-apply a listing's active errata after its fields were refreshed from the source."""
    for e in session.scalars(select(Erratum).where(Erratum.listing_id == listing.id, Erratum.active)):
        current = getattr(listing, e.field)
        if current == e.before:
            setattr(listing, e.field, e.after)
        elif current != e.after:
            logger.warning(
                "erratum {} not applied: listing {} {} is now {!r} at source (was {!r}); review it",
                e.id,
                listing.id,
                e.field,
                current,
                e.before,
            )


def add_erratum(
    session: Session,
    listing_id: int,
    field: str,
    after: Any,
    reason: str,
    evidence: str | None,
    created_by: str = "claude",
) -> Erratum:
    if field not in CORRECTABLE:
        raise ValueError(f"'{field}' can't be corrected. Fields: {', '.join(sorted(CORRECTABLE))}")
    listing = session.get(Listing, listing_id)
    if listing is None:
        raise ValueError(f"No listing {listing_id}")
    if session.scalar(select(Erratum).where(Erratum.listing_id == listing_id, Erratum.field == field, Erratum.active)):
        raise ValueError(f"Listing {listing_id} already has an active erratum for {field}: revert it first")
    before = getattr(listing, field)
    if before == after:
        raise ValueError(f"Listing {listing_id} {field} is already {after!r}")
    erratum = Erratum(
        listing_id=listing_id,
        field=field,
        before=before,
        after=after,
        reason=reason,
        evidence=evidence,
        created_by=created_by,
    )
    session.add(erratum)
    setattr(listing, field, after)
    session.flush()
    return erratum


def revert_erratum(session: Session, erratum_id: int) -> Erratum:
    """Deactivate an erratum (kept for the record) and put the scraped value back."""
    e = session.get(Erratum, erratum_id)
    if e is None or not e.active:
        raise ValueError(f"No active erratum {erratum_id}")
    listing = session.get(Listing, e.listing_id)
    if listing is not None and getattr(listing, e.field) == e.after:
        setattr(listing, e.field, e.before)
    e.active, e.reverted_at = False, utcnow()
    session.flush()
    return e


def finish(session: Session, run: ScrapeRun, complete: bool) -> int:
    """Close a run. If it was complete, delist this (source, car)'s unseen listings; return how many."""
    run.finished_at, run.complete = utcnow(), complete
    if not complete:
        return 0
    result = cast(
        CursorResult,
        session.execute(
            update(Listing)
            .where(
                Listing.source == run.source,
                Listing.car_id == run.car_id,
                Listing.status == "active",
                Listing.last_seen_at < run.started_at,
            )
            .values(status="delisted", delisted_at=run.started_at)
        ),
    )
    return result.rowcount
