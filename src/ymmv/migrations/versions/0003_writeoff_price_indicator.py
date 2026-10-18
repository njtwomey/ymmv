"""Listing write-off category and the site's own price rating.

Backfilled from the AutoTrader cards already stored in observations.raw
(the WRITE_OFF_CATEGORY badge and advertCardFeatures.priceIndicator).

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-18
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("listings") as t:
        t.add_column(sa.Column("writeoff", sa.String(8)))
        t.add_column(sa.Column("price_indicator", sa.String(8)))
    op.execute(
        "UPDATE listings SET writeoff = ("
        " SELECT json_extract(b.value, '$.displayText') FROM observations o, json_each(o.raw, '$.badges') b"
        " WHERE o.listing_id = listings.id AND json_extract(b.value, '$.type') = 'WRITE_OFF_CATEGORY'"
        " ORDER BY o.observed_at DESC LIMIT 1"
        ") WHERE source = 'autotrader'"
    )
    op.execute(
        "UPDATE listings SET price_indicator = ("
        " SELECT json_extract(o.raw, '$.trackingContext.advertCardFeatures.priceIndicator') FROM observations o"
        " WHERE o.listing_id = listings.id ORDER BY o.observed_at DESC LIMIT 1"
        ") WHERE source = 'autotrader'"
    )
    op.execute(
        "UPDATE listings SET price_indicator = NULL"
        " WHERE price_indicator NOT IN ('GREAT', 'GOOD', 'FAIR', 'HIGH', 'LOW')"
    )


def downgrade() -> None:
    with op.batch_alter_table("listings") as t:
        t.drop_column("price_indicator")
        t.drop_column("writeoff")
