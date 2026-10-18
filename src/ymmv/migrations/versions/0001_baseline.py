"""Baseline: the schema as it was before migrations (3-door MINI Hatch only).

Revision ID: 0001
Revises:
Create Date: 2026-10-18
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scrape_runs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("started_at", sa.DateTime, nullable=False),
        sa.Column("finished_at", sa.DateTime),
        sa.Column("complete", sa.Boolean, nullable=False),
        sa.Column("n_seen", sa.Integer, nullable=False),
        sa.Column("params", sa.JSON, nullable=False),
    )
    op.create_index("ix_scrape_runs_source", "scrape_runs", ["source"])
    op.create_table(
        "listings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("source_id", sa.String(64), nullable=False),
        sa.Column("url", sa.String),
        sa.Column("title", sa.String),
        sa.Column("subtitle", sa.String),
        sa.Column("trim", sa.String(16)),
        sa.Column("engine_l", sa.Double),
        sa.Column("fuel", sa.String(16)),
        sa.Column("transmission", sa.String(16)),
        sa.Column("condition", sa.String(16)),
        sa.Column("seller_type", sa.String(16)),
        sa.Column("year", sa.Integer),
        sa.Column("plate", sa.String(8)),
        sa.Column("mileage", sa.Integer),
        sa.Column("location", sa.String),
        sa.Column("distance_miles", sa.Integer),
        sa.Column("price_gbp", sa.Integer),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("first_seen_at", sa.DateTime, nullable=False),
        sa.Column("last_seen_at", sa.DateTime, nullable=False),
        sa.Column("delisted_at", sa.DateTime),
        sa.UniqueConstraint("source", "source_id"),
    )
    op.create_index("ix_listings_status", "listings", ["status"])
    op.create_table(
        "observations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("listing_id", sa.Integer, sa.ForeignKey("listings.id"), nullable=False),
        sa.Column("run_id", sa.Integer, sa.ForeignKey("scrape_runs.id"), nullable=False),
        sa.Column("observed_at", sa.DateTime, nullable=False),
        sa.Column("price_gbp", sa.Integer),
        sa.Column("mileage", sa.Integer),
        sa.Column("raw", sa.JSON, nullable=False),
        sa.UniqueConstraint("listing_id", "run_id"),
    )
    op.create_index("ix_observations_listing_id", "observations", ["listing_id"])
    op.create_index("ix_observations_run_id", "observations", ["run_id"])


def downgrade() -> None:
    op.drop_table("observations")
    op.drop_table("listings")
    op.drop_table("scrape_runs")
