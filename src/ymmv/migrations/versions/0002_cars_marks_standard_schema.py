"""Cars as a concept, the standard listing schema, and user marks.

- cars table; scrape_runs.car_id and listings.car_id
- listings: subtitle -> variant; new make, model, doors, body_type, colour, reserved
- marks table (written by the web app)
- backfill: everything so far is the 3-door MINI Hatch; Only Mini colour and
  reserved status recovered from the stored raw data

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-18
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

CAR = "mini-hatch-3dr"


def upgrade() -> None:
    op.create_table(
        "cars",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("label", sa.String, nullable=False),
        sa.Column("make", sa.String, nullable=False),
        sa.Column("model", sa.String, nullable=False),
        sa.Column("doors", sa.Integer),
        sa.Column("body_type", sa.String),
        sa.Column("trims", sa.JSON, nullable=False),
        sa.Column("spec", sa.JSON, nullable=False),
    )
    op.create_table(
        "marks",
        sa.Column("listing_id", sa.Integer, sa.ForeignKey("listings.id"), primary_key=True),
        sa.Column("mark", sa.String(32), nullable=False),
        sa.Column("note", sa.String),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )
    with op.batch_alter_table("scrape_runs") as t:
        t.add_column(sa.Column("car_id", sa.String(64)))
        t.create_index("ix_scrape_runs_car_id", ["car_id"])
    with op.batch_alter_table("listings") as t:
        t.alter_column("subtitle", new_column_name="variant")
        t.alter_column("trim", type_=sa.String(32))
        t.add_column(sa.Column("car_id", sa.String(64)))
        t.add_column(sa.Column("make", sa.String))
        t.add_column(sa.Column("model", sa.String))
        t.add_column(sa.Column("doors", sa.Integer))
        t.add_column(sa.Column("body_type", sa.String))
        t.add_column(sa.Column("colour", sa.String))
        t.add_column(sa.Column("reserved", sa.Boolean, nullable=False, server_default=sa.false()))
        t.create_index("ix_listings_car_id", ["car_id"])

    trims = ["JCW", "Cooper S", "Cooper", "One"]
    op.get_bind().execute(
        sa.text(
            "INSERT INTO cars (id, label, make, model, doors, body_type, trims, spec) "
            "VALUES (:id, 'MINI Hatch 3-door', 'MINI', 'Hatch', 3, NULL, :trims, :spec)"
        ),
        {"id": CAR, "trims": json.dumps(trims), "spec": json.dumps({"id": CAR, "backfilled": True})},
    )
    op.execute(f"UPDATE scrape_runs SET car_id = '{CAR}'")
    op.execute(
        f"UPDATE listings SET car_id = '{CAR}', make = 'MINI', model = 'Hatch', doors = 3, body_type = 'Hatchback'"
    )
    latest_raw = (
        "(SELECT json_extract(o.raw, '$.{key}') FROM observations o WHERE o.listing_id = listings.id "
        "AND json_extract(o.raw, '$.{key}') IS NOT NULL ORDER BY o.observed_at DESC LIMIT 1)"
    )
    op.execute(f"UPDATE listings SET colour = {latest_raw.format(key='colorbasic')} WHERE source = 'onlymini'")
    op.execute(
        f"UPDATE listings SET colour = {latest_raw.format(key='colour')} WHERE source = 'onlymini' AND colour IS NULL"
    )
    op.execute(
        f"UPDATE listings SET reserved = 1 WHERE source = 'onlymini' AND price_gbp IS NULL "
        f"AND lower(coalesce({latest_raw.format(key='status')}, '')) LIKE 'reserved%'"
    )


def downgrade() -> None:
    with op.batch_alter_table("listings") as t:
        t.drop_index("ix_listings_car_id")
        for col in ("reserved", "colour", "body_type", "doors", "model", "make", "car_id"):
            t.drop_column(col)
        t.alter_column("variant", new_column_name="subtitle")
    with op.batch_alter_table("scrape_runs") as t:
        t.drop_index("ix_scrape_runs_car_id")
        t.drop_column("car_id")
    op.drop_table("marks")
    op.drop_table("cars")
