"""Alembic environment. Run via `ymmv db ...` or automatically by db.connect()."""

from alembic import context
from sqlalchemy import engine_from_config, pool

from ymmv.db import Base

config = context.config

with engine_from_config(
    config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool
).connect() as connection:
    # render_as_batch: SQLite can't ALTER most things, so Alembic rebuilds tables.
    context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()
