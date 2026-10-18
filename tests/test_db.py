from datetime import datetime, timedelta

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import select

from ymmv import db
from ymmv.schema import ListingRecord

T0 = datetime(2026, 10, 18, 12)


def run_at(s, when, car_id="mini-hatch-3dr", source="autotrader"):
    run = db.ScrapeRun(source=source, car_id=car_id, started_at=when)
    s.add(run)
    s.flush()
    return run


def rec(source_id, price=5000):
    return ListingRecord(source_id=source_id, price_gbp=price, mileage=50000)


def listing(s, source_id):
    return s.scalar(select(db.Listing).where(db.Listing.source_id == source_id))


def test_migrations_match_models(sessions):
    with sessions() as s, s.connection() as conn:
        diff = compare_metadata(MigrationContext.configure(conn, opts={"render_as_batch": True}), db.Base.metadata)
    assert diff == []


def test_delisting_and_relisting(sessions):
    with sessions() as s:
        r1 = run_at(s, T0)
        db.record(s, r1, rec("a"), {})
        db.record(s, r1, rec("b"), {})
        db.finish(s, r1, complete=True)

        r2 = run_at(s, T0 + timedelta(days=1))
        db.record(s, r2, rec("a", price=4800), {})
        assert db.finish(s, r2, complete=True) == 1
        b = listing(s, "b")
        assert (b.status, b.delisted_at, b.price_gbp) == ("delisted", r2.started_at, 5000)
        assert listing(s, "a").price_gbp == 4800

        r3 = run_at(s, T0 + timedelta(days=2))
        db.record(s, r3, rec("b"), {})
        assert listing(s, "b").status == "active"


def test_incomplete_runs_never_delist(sessions):
    with sessions() as s:
        r1 = run_at(s, T0)
        db.record(s, r1, rec("a"), {})
        db.finish(s, r1, complete=True)
        r2 = run_at(s, T0 + timedelta(days=1))
        assert db.finish(s, r2, complete=False) == 0
        assert listing(s, "a").status == "active"


def test_delisting_is_scoped_to_source_and_car(sessions):
    with sessions() as s:
        r1 = run_at(s, T0, car_id="mini-hatch-5dr")
        db.record(s, r1, rec("five"), {})
        r2 = run_at(s, T0, source="onlymini")
        db.record(s, r2, rec("om"), {})
        r3 = run_at(s, T0 + timedelta(days=1))  # autotrader, 3-door, sees nothing
        assert db.finish(s, r3, complete=True) == 0


def test_older_snapshot_does_not_overwrite(sessions):
    with sessions() as s:
        new = run_at(s, T0)
        db.record(s, new, rec("a", price=4000), {})
        old = run_at(s, T0 - timedelta(days=1))
        db.record(s, old, rec("a", price=4500), {})
        a = listing(s, "a")
        assert (a.price_gbp, a.first_seen_at, a.last_seen_at) == (4000, old.started_at, new.started_at)
        assert len(a.observations) == 2


def test_errata_apply_survive_rescrape_and_revert(sessions):
    with sessions() as s:
        r1 = run_at(s, T0)
        db.record(s, r1, ListingRecord(source_id="a", year=2024, plate="18", mileage=74294), {})
        a = listing(s, "a")
        e = db.add_erratum(s, a.id, "year", 2018, "18 plate; advert says May 2018", "https://example/a")
        assert (a.year, e.before, e.after) == (2018, 2024, 2018)

        # The source still says 2024: the next scrape re-applies the fix.
        r2 = run_at(s, T0 + timedelta(days=1))
        db.record(s, r2, ListingRecord(source_id="a", year=2024, plate="18", mileage=74400), {})
        assert (listing(s, "a").year, listing(s, "a").mileage) == (2018, 74400)

        # Reverting puts the scraped value back and keeps the erratum on record.
        db.revert_erratum(s, e.id)
        assert listing(s, "a").year == 2024
        assert s.get(db.Erratum, e.id).active is False


def test_errata_never_overwrite_a_changed_source(sessions):
    with sessions() as s:
        r1 = run_at(s, T0)
        db.record(s, r1, ListingRecord(source_id="a", year=2024), {})
        db.add_erratum(s, listing(s, "a").id, "year", 2018, "wrong year", None)
        # The dealer later corrects the advert to 2019: the source wins.
        r2 = run_at(s, T0 + timedelta(days=1))
        db.record(s, r2, ListingRecord(source_id="a", year=2019), {})
        assert listing(s, "a").year == 2019


def test_errata_validation(sessions):
    import pytest

    with sessions() as s:
        db.record(s, run_at(s, T0), ListingRecord(source_id="a", year=2024), {})
        a = listing(s, "a")
        with pytest.raises(ValueError, match="can't be corrected"):
            db.add_erratum(s, a.id, "source_id", "x", "no", None)
        with pytest.raises(ValueError, match="already"):
            db.add_erratum(s, a.id, "year", 2024, "same", None)
        db.add_erratum(s, a.id, "year", 2018, "fix", None)
        with pytest.raises(ValueError, match="active erratum"):
            db.add_erratum(s, a.id, "year", 2017, "again", None)
