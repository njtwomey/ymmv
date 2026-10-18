import sqlite3
from datetime import timedelta

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, select

from ymmv import db
from ymmv.schema import ListingRecord
from ymmv.snapshot import restore, snapshot

from .test_db import T0, listing, run_at


def get(s, source_id) -> db.Listing:
    row = listing(s, source_id)
    assert row is not None
    return row


def fill(sessions):
    """A small database touching every table: runs, a delisting, an erratum and a tricky-text mark."""
    car_a = ListingRecord(source_id="a", year=2024, plate="18", variant="1.5 Cooper's 'Sport'")
    with sessions() as s:
        r1 = run_at(s, T0)
        db.record(s, r1, car_a, {"k": "v"})
        db.record(s, r1, ListingRecord(source_id="b", year=2019, price_gbp=9995, engine_l=1.5), {"x": [1, 2]})
        db.finish(s, r1, complete=True)
        r2 = run_at(s, T0 + timedelta(days=1))
        db.record(s, r2, car_a, {})
        db.finish(s, r2, complete=True)
        a_id = get(s, "a").id
        db.add_erratum(s, a_id, "year", 2018, "18 plate", "https://example/a")
        s.add(db.Mark(listing_id=a_id, mark="interesting", note="multi\nline; 'quoted'"))
        s.commit()


def test_round_trip_is_exact(tmp_path):
    src = tmp_path / "src.sqlite"
    fill(db.connect(src))
    snap, again = tmp_path / "snap", tmp_path / "again"
    counts = snapshot(src, snap)
    assert counts["listings"] == 2 and counts["errata"] == 1 and counts["marks"] == 1
    assert (snap / "tables.sql").read_text().count("CREATE TABLE") == len(counts)

    out = tmp_path / "restored.sqlite"
    assert restore(snap, out) == counts
    snapshot(out, again)
    for f in snap.glob("*.sql"):
        assert (again / f.name).read_text() == f.read_text(), f.name

    with db.connect(out)() as s:
        a, b = get(s, "a"), get(s, "b")
        assert (a.year, a.variant, a.status) == (2018, "1.5 Cooper's 'Sport'", "active")
        assert b.status == "delisted"
        assert s.scalar(select(db.Mark.note)) == "multi\nline; 'quoted'"
    with create_engine(f"sqlite:///{out}").connect() as conn:
        context = MigrationContext.configure(conn, opts={"render_as_batch": True})
        assert compare_metadata(context, db.Base.metadata) == []


def test_restore_refuses_to_overwrite(tmp_path):
    src = tmp_path / "src.sqlite"
    fill(db.connect(src))
    snapshot(src, tmp_path / "snap")
    with pytest.raises(FileExistsError):
        restore(tmp_path / "snap", src)
    restore(tmp_path / "snap", src, force=True)


def test_snapshot_of_an_idle_wal_database(tmp_path):
    """Works when nothing else has the database open, so the WAL side files are gone."""
    src = tmp_path / "src.sqlite"
    sessions = db.connect(src)
    fill(sessions)
    sessions.kw["bind"].dispose()  # close every connection
    # Move everything into the main file, then remove the side files, as SQLite does
    # when the last connection closes cleanly.
    conn = sqlite3.connect(src)
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    for suffix in ("-wal", "-shm"):
        (tmp_path / f"src.sqlite{suffix}").unlink(missing_ok=True)
    assert snapshot(src, tmp_path / "snap")["listings"] == 2


def test_dropped_tables_leave_no_stale_files(tmp_path):
    src = tmp_path / "src.sqlite"
    db.connect(src)
    snap = tmp_path / "snap"
    snap.mkdir()
    (snap / "old_table.sql").write_text("-- stale\n")
    snapshot(src, snap)
    assert not (snap / "old_table.sql").exists()


def test_cli_rebuilds_a_missing_default_database(tmp_path, monkeypatch):
    from ymmv import cli

    src = tmp_path / "src.sqlite"
    fill(db.connect(src))
    snapshot(src, tmp_path / "snap")
    target = tmp_path / "ymmv.sqlite"
    monkeypatch.setattr(cli, "DEFAULT_DB", target)
    monkeypatch.setattr(cli, "SNAPSHOT", tmp_path / "snap")
    with cli.Status(db=target).sessions()() as s:
        assert get(s, "a").year == 2018
