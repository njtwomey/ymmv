"""Saved model configurations (written by the web app).

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-18
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_models",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("car_id", sa.String(64)),
        sa.Column("formula", sa.String, nullable=False),
        sa.Column("folds", sa.Integer, nullable=False),
        sa.Column("standardise", sa.Boolean, nullable=False),
        sa.Column("filters", sa.JSON, nullable=False),
        sa.Column("metrics", sa.JSON, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_saved_models_car_id", "saved_models", ["car_id"])


def downgrade() -> None:
    op.drop_index("ix_saved_models_car_id", "saved_models")
    op.drop_table("saved_models")
