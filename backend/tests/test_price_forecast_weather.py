"""Weather-aware price forecast: uses weather when supplied, stays within the weather forecast's reach, and maps
forecast dates onto days from today scaled to today's price."""
import math
from datetime import date, timedelta

from app.ml import forecasting
from app.services.flow import _forecast_by_day


def _series(n=200):
    start = date.today() - timedelta(days=n)
    rows, wx = [], {}
    for i in range(n + 20):
        d = start + timedelta(days=i)
        rain = 40.0 if i % 23 in (0, 1, 2) else 0.0
        wx[d] = (rain, 30 + 3 * math.sin(i / 9))
        if i < n:
            # heavy rain cuts arrivals: price rises for a few days after it
            bump = 1.25 if any((i - k) % 23 in (0, 1, 2) for k in (1, 2, 3)) else 1.0
            rows.append((d, 20 * bump * (1 + 0.1 * math.sin(i / 15))))
    return rows, wx


def test_weather_features_used_and_horizon_limited():
    rows, wx = _series()
    plain = forecasting.forecast(rows, 14)
    withw = forecasting.forecast(rows, 14, wx)
    assert plain["status"] == withw["status"] == "ok"
    assert withw["weather_features"] is True and plain["weather_features"] is False
    assert len(withw["points"]) <= 14
    short = {d: v for d, v in wx.items() if d <= rows[-1][0] + timedelta(days=5)}   # weather known only 5 days ahead
    assert len(forecasting.forecast(rows, 14, short)["points"]) == 5


def test_forecast_by_day_scales_to_todays_price():
    today = date.today()
    fc = {"status": "ok", "last_price": 10.0,
          "points": [{"date": (today + timedelta(days=d)).isoformat(), "price": 10 + d, "low": 9 + d, "high": 11 + d} for d in range(1, 4)]}
    out = _forecast_by_day(fc, 20.0, 14)
    assert [round(x["price"], 2) for x in out] == [22.0, 24.0, 26.0] and out[0]["low"] < out[0]["price"] < out[0]["high"]
    assert _forecast_by_day({"status": "insufficient_data"}, 20.0, 14) is None
