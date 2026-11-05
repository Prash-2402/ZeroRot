"""Market price sources behind one adapter interface. Only verified sources; no scraping, no invented values.

DataGovAgmarknet: Government of India Open Government Data platform (data.gov.in), Agmarknet daily market prices.
Needs DATA_GOV_API_KEY (free registration). Each fetch is stored, so history accumulates over time; an optional
history resource id (AGMARKNET_HISTORY_RESOURCE_ID) can backfill older dates when the dataset supports date filters.
Market news: GDELT DOC 2.0 API (no key), used only as context, never as price evidence."""
from __future__ import annotations

from datetime import datetime, timezone

import httpx

from app.core.config import settings

AGMARK_NAMES = {"tomato": "Tomato", "mango": "Mango", "banana": "Banana", "potato": "Potato", "onion": "Onion", "cabbage": "Cabbage",
                "cauliflower": "Cauliflower", "carrot": "Carrot", "brinjal": "Brinjal", "okra": "Bhindi(Ladies Finger)", "green_chilli": "Green Chilli",
                "grapes": "Grapes", "papaya": "Papaya", "pomegranate": "Pomegranate", "orange": "Orange", "rice": "Paddy(Dhan)(Common)",
                "wheat": "Wheat", "maize": "Maize"}
# data.gov.in stalls requests carrying the default python-httpx User-Agent; identify the client plainly
HEADERS = {"User-Agent": "ZeroRot/2.0 (post-harvest platform)", "Accept": "application/json"}


class Unavailable(Exception):
    pass


class MarketSource:
    name = "base"

    def status(self) -> tuple[str, str]:
        raise NotImplementedError

    def fetch(self, commodity: str, state: str | None = None, limit: int = 1000) -> list[dict]:
        raise NotImplementedError


class DataGovAgmarknet(MarketSource):
    name = "data.gov.in Agmarknet"

    def __init__(self, resource_id: str | None = None):
        self.resource_id = resource_id or settings.agmarknet_resource_id

    def status(self):
        if not settings.data_gov_api_key:
            return "unavailable", "DATA_GOV_API_KEY not configured (free key from data.gov.in)"
        return "configured", f"resource {self.resource_id}"

    def fetch(self, commodity: str, state: str | None = None, limit: int = 1000, offset: int = 0) -> list[dict]:
        if not settings.data_gov_api_key:
            raise Unavailable("DATA_GOV_API_KEY not configured")
        params = {"api-key": settings.data_gov_api_key, "format": "json", "limit": limit, "offset": offset,
                  "filters[commodity]": AGMARK_NAMES.get(commodity, commodity.title())}
        if state:
            params["filters[state.keyword]"] = state
        try:
            r = httpx.get(f"https://api.data.gov.in/resource/{self.resource_id}", params=params, headers=HEADERS, timeout=30)
            r.raise_for_status()
            j = r.json()
        except httpx.HTTPError as e:
            raise Unavailable(f"data.gov.in request failed ({type(e).__name__})")
        out = []
        for rec in j.get("records", []):
            date = rec.get("arrival_date") or rec.get("Arrival_Date")
            modal = rec.get("modal_price") or rec.get("Modal_Price")
            if not date or modal in (None, ""):
                continue
            try:
                obs = datetime.strptime(date, "%d/%m/%Y")
            except ValueError:
                continue
            out.append({"commodity": commodity, "market": (rec.get("market") or rec.get("Market") or "").strip(),
                        "district": rec.get("district") or rec.get("District"), "state": rec.get("state") or rec.get("State"),
                        "variety": rec.get("variety") or rec.get("Variety"), "price_min": _num(rec.get("min_price") or rec.get("Min_Price")),
                        "price_max": _num(rec.get("max_price") or rec.get("Max_Price")), "price_modal": _num(modal), "unit": "Rs/quintal",
                        "observation_date": obs, "source": f"{self.name} ({self.resource_id})"})
        return [x for x in out if x["price_modal"]]


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def sources() -> list[MarketSource]:
    out = [DataGovAgmarknet()]
    if settings.agmarknet_history_resource_id:
        out.append(DataGovAgmarknet(settings.agmarknet_history_resource_id))
    return out


def news(commodity: str, max_records: int = 12) -> list[dict]:
    """Recent news articles (GDELT DOC 2.0). Context only."""
    import time
    q = f"{AGMARK_NAMES.get(commodity, commodity).lower()} price sourcecountry:IN"
    params = {"query": q, "mode": "artlist", "format": "json", "maxrecords": max_records, "sort": "datedesc", "timespan": "14d"}
    arts = None
    for attempt in range(2):
        try:
            r = httpx.get("https://api.gdeltproject.org/api/v2/doc/doc", params=params, timeout=12)
            if r.status_code == 429 and attempt == 0:
                time.sleep(5.5)   # GDELT allows one request every 5 seconds
                continue
            r.raise_for_status()
            arts = r.json().get("articles", [])
            break
        except (httpx.HTTPError, ValueError) as e:
            raise Unavailable(f"News source unavailable ({type(e).__name__}{' / rate limited' if '429' in str(e) else ''})")
    if arts is None:
        raise Unavailable("News source rate limited; try again in a minute")
    return [{"title": a.get("title"), "url": a.get("url"), "domain": a.get("domain"),
             "seen": a.get("seendate"), "language": a.get("language")} for a in arts if a.get("title")]


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)
