"""Open trucks (traditional godown lots) have no cooling unit: their alerts never offer setpoint or cooling repairs."""
from types import SimpleNamespace as NS

from app.services.flow import FIX_LABEL, _fixes_for


def alert(code, rh=None, lo=None):
    return NS(code=code, reading={"rh_pct": rh} if rh is not None else {}, expected={"min_pct": lo} if lo is not None else {})


OPEN = NS(kind="cold_chain", config={"refrigerated": False})
REEFER = NS(kind="cold_chain", config={"refrigerated": True})


def test_open_truck_heat_alert_offers_shade_not_cooling():
    assert _fixes_for(OPEN, alert("TEMP_EXCURSION")) == ["shade_cargo"]
    assert _fixes_for(OPEN, alert("COOLING_FAILURE")) == []
    assert _fixes_for(OPEN, alert("CHILLING_RISK")) == []
    assert _fixes_for(OPEN, alert("GAS_ABNORMAL")) == ["open_tarp_sides"]
    assert _fixes_for(OPEN, alert("ROUTE_DELAY")) == ["replan_route"]
    assert all(a in FIX_LABEL for a in ("shade_cargo", "open_tarp_sides"))


def test_reefer_keeps_cooling_fixes():
    assert _fixes_for(REEFER, alert("TEMP_EXCURSION")) == ["adjust_setpoint", "restore_cooling"]
    assert _fixes_for(REEFER, alert("COOLING_FAILURE")) == ["restore_cooling", "activate_backup_cooling"]
