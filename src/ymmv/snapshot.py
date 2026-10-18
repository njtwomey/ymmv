"""Database snapshots as plain SQL, so the data can live in git as diffable text.

    db/snapshot/tables.sql     the schema: CREATE TABLE / CREATE INDEX statements
    db/snapshot/{table}.sql    one INSERT per row, ordered by primary key

Values are escaped by SQLite itself (its quote() function) and rows are written in
a fixed order, so snapshotting an unchanged table produces an identical file, and a
scrape shows up in `git diff` as just the rows it touched. `restore` rebuilds a
database from these files.
"""

import sqlite3
from pathlib import Path

SCHEMA_FILE = "tables.sql"


def _tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return [r[0] for r in rows]


def _order_by(conn: sqlite3.Connection, table: str) -> str:
    """The primary key columns (in key order), or rowid for tables without one."""
    info = conn.execute(f'PRAGMA table_info("{table}")').fetchall()  # cid, name, type, notnull, default, pk
    pk = sorted((r[5], r[1]) for r in info if r[5])
    return ", ".join(f'"{name}"' for _, name in pk) if pk else "rowid"


def snapshot(db: Path, out: Path) -> dict[str, int]:
    """Write the schema and each table's rows as SQL files; return rows written per table."""
    out.mkdir(parents=True, exist_ok=True)
    if not db.exists():
        raise FileNotFoundError(f"No database at {db}")
    # A normal connection, used only to read: a read-only one can't open a WAL-mode
    # database when its -shm file is absent (i.e. whenever nothing else has it open).
    conn = sqlite3.connect(db)
    try:
        schema = conn.execute(
            "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' "
            "ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name"
        ).fetchall()
        (out / SCHEMA_FILE).write_text("".join(f"{sql};\n\n" for (sql,) in schema).rstrip() + "\n")

        counts: dict[str, int] = {}
        tables = _tables(conn)
        for table in tables:
            cols = [r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')]
            col_list = ", ".join(f'"{c}"' for c in cols)
            values = " || ', ' || ".join(f'quote("{c}")' for c in cols)
            query = f'SELECT {values} FROM "{table}" ORDER BY {_order_by(conn, table)}'
            n = 0
            with (out / f"{table}.sql").open("w") as f:
                for (row,) in conn.execute(query):
                    f.write(f'INSERT INTO "{table}" ({col_list}) VALUES ({row});\n')
                    n += 1
            counts[table] = n
        # Tables that no longer exist shouldn't linger as stale files.
        for stale in out.glob("*.sql"):
            if stale.name != SCHEMA_FILE and stale.stem not in tables:
                stale.unlink()
        return counts
    finally:
        conn.close()


def restore(src: Path, db: Path, force: bool = False) -> dict[str, int]:
    """Rebuild a database from a snapshot directory; return rows restored per table."""
    schema = src / SCHEMA_FILE
    if not schema.exists():
        raise FileNotFoundError(f"No {SCHEMA_FILE} in {src}")
    if db.exists():
        if not force:
            raise FileExistsError(f"{db} already exists: pass force to replace it")
        for suffix in ("", "-wal", "-shm"):
            Path(f"{db}{suffix}").unlink(missing_ok=True)
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db)
    try:
        conn.executescript(schema.read_text())
        counts: dict[str, int] = {}
        for table in _tables(conn):
            f = src / f"{table}.sql"
            if not f.exists():
                counts[table] = 0
                continue
            conn.executescript(f"BEGIN;\n{f.read_text()}COMMIT;")
            counts[table] = conn.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
        return counts
    finally:
        conn.close()
