"""Command line. `uv run ymmv --help` lists commands; `uv run scrape --help` is the scraper alone.

uv run scrape --car mini-hatch-3dr                       # every source that sells it
uv run scrape --source autotrader --car mini-hatch-3dr
uv run scrape --source onlymini --car mini-hatch-3dr --car mini-hatch-5dr
"""

import json
import sys
from pathlib import Path

from loguru import logger
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, CliApp, CliSubCommand, SettingsConfigDict
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from . import db, snapshot
from .cars import Car, load_cars
from .sources import SOURCES, Source

PROJECT = Path(__file__).resolve().parents[2]
DEFAULT_DB = PROJECT / "db" / "ymmv.sqlite"
SNAPSHOT = PROJECT / "db" / "snapshot"


class Common(BaseModel):
    db: Path = Field(DEFAULT_DB, description="SQLite database file")

    def sessions(self) -> sessionmaker[Session]:
        """Open the database, first rebuilding the default one from db/snapshot if it's missing."""
        if self.db == DEFAULT_DB and not self.db.exists() and (SNAPSHOT / snapshot.SCHEMA_FILE).exists():
            logger.info("no database at {}: restoring it from {}", self.db, SNAPSHOT)
            snapshot.restore(SNAPSHOT, self.db)
        return db.connect(self.db)


class Scrape(Common):
    """Scrape current listings of one or more cars from one or more sources into the database.

    Cars are defined in cars.yaml (`ymmv cars` lists them). After a complete run of a
    source for a car, that car's adverts the source no longer shows are marked sold (delisted).
    """

    car: list[str] = Field(description="Car id(s) from cars.yaml; repeat for several")
    source: list[str] = Field(
        list(SOURCES), description=f"Source(s): {', '.join(SOURCES)}. Default: all that sell the car"
    )
    postcode: str = Field("BS1 4DJ", description="Distances are measured from here")
    delay: float = Field(1.0, description="Average seconds between requests")
    max_pages: int | None = Field(
        None, description="Debug: stop each search after N pages. The run is then incomplete, so nothing is delisted"
    )

    def cli_cmd(self) -> None:
        cars = load_cars()
        unknown = [c for c in self.car if c not in cars] + [s for s in self.source if s not in SOURCES]
        if unknown:
            raise SystemExit(
                f"Unknown car/source: {', '.join(unknown)}. Cars: {', '.join(cars)}. Sources: {', '.join(SOURCES)}"
            )
        sessions = self.sessions()
        for car_id in self.car:
            for name in self.source:
                source = SOURCES[name](self.postcode, self.delay, self.max_pages)
                car = cars[car_id].for_source(name)
                if reason := source.unsupported(car):
                    logger.info("skipping {} for {}: {}", name, car_id, reason)
                    continue
                scrape(sessions, source, car, self.model_dump(mode="json", exclude={"db"}))


def scrape(sessions: sessionmaker[Session], source: Source, car: Car, params: dict) -> None:
    with sessions() as s:
        db.sync_car(s, car)
        run = db.ScrapeRun(source=source.name, car_id=car.id, params=params)
        s.add(run)
        s.commit()
        try:
            for rec, raw in source.listings(car):
                db.record(s, run, rec, raw)
                run.n_seen += 1
                if run.n_seen % 20 == 0:  # about a page: keeps write locks short for the web app
                    s.commit()
                if run.n_seen % 500 == 0:
                    logger.info("{} listings so far", run.n_seen)
            expected = source.expected or run.n_seen
            complete = not source.truncated and run.n_seen >= 0.97 * expected
            if not source.truncated and not complete:
                logger.warning("saw {} of {} listings: some were missed", run.n_seen, expected)
        except BaseException:
            db.finish(s, run, complete=False)
            s.commit()
            raise
        delisted = db.finish(s, run, complete)
        s.commit()
        print(
            f"{source.name} / {car.id} run {run.id}: {run.n_seen} listings ({expected} expected), "
            f"{'complete' if complete else 'INCOMPLETE'}, {delisted} newly delisted"
        )


class Cars(Common):
    """List the cars defined in cars.yaml and how many listings each has."""

    def cli_cmd(self) -> None:
        sessions = self.sessions()
        with sessions() as s:
            counts = dict(s.execute(select(db.Listing.car_id, func.count()).group_by(db.Listing.car_id)).all())
        for car in load_cars().values():
            spec = ", ".join(f"{k}={v}" for k, v in (("doors", car.doors), ("body", car.body_type)) if v)
            print(f"{car.id:<16} {car.label:<28} {car.make} {car.model} {spec:<16} {counts.get(car.id, 0):>6} listings")


class Status(Common):
    """Show scrape runs and listing counts per source and car."""

    def cli_cmd(self) -> None:
        sessions = self.sessions()
        with sessions() as s:
            runs = s.scalars(select(db.ScrapeRun).order_by(db.ScrapeRun.id)).all()
            for r in runs:
                print(
                    f"run {r.id:>3}  {r.source:<10} {r.car_id or '-':<16} {r.started_at:%Y-%m-%d %H:%M}  "
                    f"{r.n_seen:>5} seen  {'complete' if r.complete else 'incomplete'}"
                )
            counts = s.execute(
                select(db.Listing.source, db.Listing.car_id, db.Listing.status, func.count()).group_by(
                    db.Listing.source, db.Listing.car_id, db.Listing.status
                )
            ).all()
            for source, car_id, status, n in counts:
                print(f"{source:<10} {car_id or '-':<16} {status:<9} {n:>6}")
            if not runs:
                print("Empty database: run `uv run scrape --car <id>` first.")


class ErrataAdd(Common):
    """Correct one field of one listing (the scraped value stays in the raw data).

    Example: ymmv errata add --listing 589 --field year --value 2018 \\
               --reason "Dealer entered 2024; 18 plate and AutoTrader's registration date say 2018" \\
               --evidence "https://www.autotrader.co.uk/car-details/202609035684979: registrationDateFormatted May 2018"
    """

    listing: int = Field(description="Listing id (as in the app / `listings.id`)")
    field: str = Field(description="Listings column to correct, e.g. year, mileage, trim")
    value: str = Field(description='New value as JSON: 2018, 1.5, "Cooper S", null (bare text is taken as a string)')
    reason: str = Field(description="Why: what was wrong and how we know")
    evidence: str | None = Field(None, description="Where the correct value comes from (URL, excerpt)")
    by: str = Field("claude", description="Who made the correction")

    def cli_cmd(self) -> None:
        try:
            after = json.loads(self.value)
        except json.JSONDecodeError:
            after = self.value
        with self.sessions()() as s:
            try:
                e = db.add_erratum(s, self.listing, self.field, after, self.reason, self.evidence, self.by)
            except ValueError as err:
                raise SystemExit(str(err)) from None
            s.commit()
            print(f"erratum {e.id}: listing {e.listing_id} {e.field} {e.before!r} → {e.after!r}")


class ErrataShow(Common):
    """List errata (active and reverted), newest first."""

    listing: int | None = Field(None, description="Only this listing")

    def cli_cmd(self) -> None:
        with self.sessions()() as s:
            q = select(db.Erratum).order_by(db.Erratum.id.desc())
            if self.listing is not None:
                q = q.where(db.Erratum.listing_id == self.listing)
            rows = s.scalars(q).all()
            for e in rows:
                state = "active" if e.active else f"reverted {e.reverted_at:%Y-%m-%d %H:%M}"
                change = f"{e.field}: {e.before!r} → {e.after!r}"
                made = f"{e.created_by}, {e.created_at:%Y-%m-%d %H:%M}"
                print(f"#{e.id}  listing {e.listing_id}  {change}  [{state}, {made}]")
                print(f"     reason:   {e.reason}")
                if e.evidence:
                    print(f"     evidence: {e.evidence}")
            if not rows:
                print("No errata.")


class ErrataRevert(Common):
    """Undo an erratum: the scraped value comes back; the erratum is kept, marked reverted."""

    id: int = Field(description="Erratum id (see `ymmv errata show`)")

    def cli_cmd(self) -> None:
        with self.sessions()() as s:
            try:
                e = db.revert_erratum(s, self.id)
            except ValueError as err:
                raise SystemExit(str(err)) from None
            s.commit()
            print(f"erratum {e.id} reverted: listing {e.listing_id} {e.field} back to {e.before!r}")


class Errata(BaseModel):
    """Field-level corrections to listings, each with before/after, reason and evidence.

    The listings table shows corrected values; raw scraped data is never changed. Each
    scrape re-applies an erratum while the source still shows the old value.
    """

    add: CliSubCommand[ErrataAdd] = Field(description="Correct a field of a listing")
    show: CliSubCommand[ErrataShow] = Field(description="List errata")
    revert: CliSubCommand[ErrataRevert] = Field(description="Undo an erratum")

    def cli_cmd(self) -> None:
        CliApp.run_subcommand(self)


class Snapshot(Common):
    """Write the database as SQL text: db/snapshot/tables.sql (schema) and one {table}.sql per table.

    Rows are in primary-key order and values are escaped by SQLite, so unchanged data gives
    identical files and git diffs show exactly what changed. Rebuild with `ymmv restore`.
    """

    out: Path = Field(SNAPSHOT, description="Directory to write the .sql files to")

    def cli_cmd(self) -> None:
        self.sessions()  # bring the schema up to date first
        counts = snapshot.snapshot(self.db, self.out)
        for table, n in counts.items():
            print(f"{table:<16} {n:>7} rows")
        print(f"wrote {self.out}")


class Restore(Common):
    """Rebuild the database from a snapshot (db/snapshot/*.sql).

    Refuses to replace an existing database unless --force is given.
    """

    src: Path = Field(SNAPSHOT, description="Snapshot directory to restore from")
    force: bool = Field(False, description="Replace the database if it already exists")

    def cli_cmd(self) -> None:
        try:
            counts = snapshot.restore(self.src, self.db, self.force)
        except (FileExistsError, FileNotFoundError) as err:
            raise SystemExit(str(err)) from None
        for table, n in counts.items():
            print(f"{table:<16} {n:>7} rows")
        db.connect(self.db)  # apply any migrations newer than the snapshot
        print(f"restored {self.db}")


class Migrate(Common):
    """Bring the database schema up to date (this also happens automatically on every command)."""

    def cli_cmd(self) -> None:
        self.sessions()
        print(f"{self.db}: schema up to date")


class Ymmv(BaseSettings):
    """YMMV (your mileage may vary): scrape and store UK used-car listings across sites.

    Analysis and charts live in the web app (web/), which reads the same database.
    """

    model_config = SettingsConfigDict(cli_prog_name="ymmv", cli_kebab_case=True)

    scrape: CliSubCommand[Scrape] = Field(description="Scrape cars from sources into the database")
    cars: CliSubCommand[Cars] = Field(description="List the cars defined in cars.yaml")
    status: CliSubCommand[Status] = Field(description="Show runs and listing counts")
    errata: CliSubCommand[Errata] = Field(description="Correct, list or revert fixes to listings")
    snapshot: CliSubCommand[Snapshot] = Field(description="Write the database as SQL files (db/snapshot)")
    restore: CliSubCommand[Restore] = Field(description="Rebuild the database from db/snapshot")
    migrate: CliSubCommand[Migrate] = Field(description="Bring the database schema up to date")

    def cli_cmd(self) -> None:
        CliApp.run_subcommand(self)


def _logging() -> None:
    logger.remove()
    logger.add(sys.stderr, level="INFO", format="<green>{time:HH:mm:ss}</green> <level>{level: <7}</level> {message}")


def main() -> None:
    _logging()
    CliApp.run(Ymmv)


class ScrapeCli(Scrape, BaseSettings):
    """The `scrape` command on its own (the `scrape` entry point)."""

    model_config = SettingsConfigDict(cli_prog_name="scrape", cli_kebab_case=True)


def scrape_main() -> None:
    _logging()
    CliApp.run(ScrapeCli)
