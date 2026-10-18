"""Errata: field-level corrections to listings, with before/after, reason and evidence.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-18
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "errata",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("listing_id", sa.Integer, sa.ForeignKey("listings.id"), nullable=False),
        sa.Column("field", sa.String(64), nullable=False),
        sa.Column("before", sa.JSON),
        sa.Column("after", sa.JSON),
        sa.Column("reason", sa.String, nullable=False),
        sa.Column("evidence", sa.String),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.Column("reverted_at", sa.DateTime),
    )
    op.create_index("ix_errata_listing_id", "errata", ["listing_id"])


def downgrade() -> None:
    op.drop_index("ix_errata_listing_id", "errata")
    op.drop_table("errata")
