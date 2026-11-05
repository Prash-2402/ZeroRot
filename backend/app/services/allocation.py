"""Cold-storage allocation: feasible zones only (capacity, temperature range, co-storage compatibility),
then lowest cost at the commodity's recommended setpoint. Expected shelf life comes from the decay engine."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import ProduceBatch, StorageAllocation, StorageFacility, StorageZone
from app.engine.registry import get_produce, load_registry
from app.simulation.deterioration_model import predict
from app.simulation.state import ProduceState


def zone_load(db: Session, zone_id: int) -> float:
    return float(db.scalar(select(func.coalesce(func.sum(StorageAllocation.quantity_kg), 0.0))
                           .where(StorageAllocation.zone_id == zone_id, StorageAllocation.status == "active")) or 0.0)


def _co_stored(db: Session, zone_id: int) -> list[str]:
    rows = db.execute(select(ProduceBatch.commodity_id).join(StorageAllocation, StorageAllocation.batch_id == ProduceBatch.id)
                      .where(StorageAllocation.zone_id == zone_id, StorageAllocation.status == "active")).all()
    return sorted({r[0] for r in rows})


def recommend(db: Session, batch: ProduceBatch, planned_days: float, quantity_kg: float | None = None) -> dict:
    p = get_produce(batch.commodity_id)
    qty = quantity_kg or batch.quantity_kg
    t_ref, t_chill = p.v("t_ref"), p.v("t_chill")
    rh_mid = (p.v("rh_low") + p.v("rh_high")) / 2
    reg = load_registry()
    options, rejected = [], []
    zones = db.scalars(select(StorageZone).join(StorageFacility).where(StorageFacility.kind == "cold")).all()
    for z in zones:
        why = None
        free = z.capacity_kg - zone_load(db, z.id)
        others = [c for c in _co_stored(db, z.id) if c != batch.commodity_id]
        if z.status != "operational":
            why = f"zone status is {z.status}"
        elif free < qty:
            why = f"only {free:.0f} kg free of {z.capacity_kg:.0f} kg"
        elif not (z.temp_min <= t_ref <= z.temp_max):
            why = f"zone range {z.temp_min}-{z.temp_max} degC excludes the recommended {t_ref} degC"
        else:
            for o in others:
                po = reg[o]
                if abs(po.v("t_ref") - t_ref) > 2.0:
                    why = f"co-stored {o} needs {po.v('t_ref')} degC (incompatible setpoint)"
                    break
                if (po.meta.get("ethylene") == "producer_high" and p.meta.get("ethylene_sensitive")) or \
                   (p.meta.get("ethylene") == "producer_high" and po.meta.get("ethylene_sensitive")):
                    why = f"ethylene incompatibility with co-stored {o}"
                    break
        if why:
            rejected.append({"zone_id": z.id, "zone": f"{z.facility.name} / {z.name}", "reason": why})
            continue
        setpoint = max(t_ref, t_chill + 0.5)
        pr = predict(ProduceState(batch.commodity_id, batch.maturity, qty, batch.initial_quality), setpoint, rh_mid,
                     planned_days * 24, f"alloc-{batch.id}-{z.id}", draws=100)
        cost = qty * z.cost_per_kg_day * planned_days
        options.append({"zone_id": z.id, "zone": f"{z.facility.name} / {z.name}", "facility_id": z.facility_id, "setpoint_c": setpoint,
                        "rh_setpoint_pct": rh_mid, "free_capacity_kg": round(free, 1), "allocation_kg": qty, "estimated_cost": round(cost, 2),
                        "expected_shelf_life_days": pr["shelf_life_days"], "shelf_life_p10": pr["shelf_life_p10"], "shelf_life_p90": pr["shelf_life_p90"],
                        "spoilage_probability": pr["spoilage_probability"], "fill_after_pct": round((z.capacity_kg - free + qty) / z.capacity_kg * 100, 1),
                        "reason": f"Holds {setpoint} degC / {rh_mid:.0f}% RH (recommended for {p.display_name.lower()}), has capacity, "
                                  f"compatible with current contents{(': ' + ', '.join(others)) if others else ''}."})
    options.sort(key=lambda o: (o["spoilage_probability"], o["estimated_cost"]))
    return {"batch_id": batch.id, "commodity": batch.commodity_id, "quantity_kg": qty, "planned_days": planned_days,
            "recommended": options[0] if options else None, "options": options, "rejected": rejected,
            "message": None if options else "No cold-storage zone can take this batch (see reasons)."}
