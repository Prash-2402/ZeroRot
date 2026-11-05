"""Reference data only: the commodity catalog from the sourced parameter registry. No demo batches, prices or readings."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import Commodity, CommodityStorageParameter
from app.engine.registry import load_registry


def sync_commodities(db: Session) -> int:
    n = 0
    for key, p in load_registry().items():
        c = db.get(Commodity, key)
        if c is None:
            c = Commodity(id=key)
            db.add(c)
        c.name, c.name_kn, c.registry_version = p.display_name, p.kannada, p.version
        c.prediction_supported = p.prediction_supported
        c.prediction_note = p.meta.get("prediction_note")
        c.ethylene, c.ethylene_sensitive = p.meta.get("ethylene"), bool(p.meta.get("ethylene_sensitive"))
        existing = {x.key: x for x in c.parameters}
        for short, rec in p.params.items():
            row = existing.get(short) or CommodityStorageParameter(key=short)
            if short not in existing:
                c.parameters.append(row)
            rng = rec.get("range") or [None, None]
            row.name, row.value, row.unit = rec["name"], float(rec["value"]), rec["unit"]
            row.range_low, row.range_high = rng[0], rng[1]
            row.classification, row.source = rec["classification"], rec["source"]
            row.derivation, row.limitations = rec.get("derivation"), rec.get("limitations")
        n += 1
    db.commit()
    return n
