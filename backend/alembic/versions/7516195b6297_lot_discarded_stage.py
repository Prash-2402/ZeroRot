"""lot discarded stage

Revision ID: 7516195b6297
Revises: f51bfd6fd99d
Create Date: 2026-11-06 02:50:55.282477

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7516195b6297'
down_revision: Union[str, None] = 'f51bfd6fd99d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("lots", recreate="always") as b:
        b.drop_constraint("ck_lot_stage", type_="check")
        b.create_check_constraint("ck_lot_stage", "stage in ('intake','storage','grading','graded','dispatched','arrived','delivered','discarded')")



def downgrade() -> None:
    with op.batch_alter_table("lots", recreate="always") as b:
        b.drop_constraint("ck_lot_stage", type_="check")
        b.create_check_constraint("ck_lot_stage", "stage in ('intake','storage','grading','graded','dispatched','arrived','delivered')")

