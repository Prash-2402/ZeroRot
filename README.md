# ZERO ROT

**AI-Powered Post-Harvest Quality, Shelf-Life and Market Value Prediction Platform**
*Predict. Preserve. Prevent.* · Problem statement DL-SJBIT-HK26-AGR007 (LAKSHYA 2026)

> India loses ₹1.53 lakh crore of produce after harvest every year (NABCONS 2022). Our goal is zero.

For every batch, ZERO ROT answers three questions, turns the answers into one decision the farmer controls, and protects the produce live when something goes wrong:

1. **How will its quality change?** Decay Engine, a quality trajectory with a P10–P90 band
2. **How much shelf life is left?** Days to the minimum sellable score, with an uncertainty interval
3. **What will it be worth?** Saleable mass × scenario price × grade factor, with low, base and high price paths

ONE BATCH → ONE DIGITAL TWIN → THREE PREDICTIONS → ONE CLEAR DECISION → FARMER ACTS.

| Layer | What is built |
|---|---|
| PREDICT | Batch registration, versioned parameter registry with sources, decay engine (Q, W, R tracked separately), Monte Carlo uncertainty, confidence index, digital twin with time slider, live what-if |
| DECIDE | Rule-Based Sell / Store / Ship engine with rejected options and reasons, Market Shift Planner (Today / Day 2 / Day 4 / Day 7), price-crash warnings, group shipping |
| PROTECT | Control Room map (MapLibre + deck.gl), 15 trucks on real OSRM road geometry, SIMULATED cold-chain feed, reefer failure injection, rescue workflow (Groq tool calling or rule-based), human-approved reroute, ghost comparison, in-app, Telegram and WhatsApp-preview alerts in Kannada |
| PROVE | Harvest passport (QR), impact dashboard from backend records, district exposure map, validation records (MAE / RMSE / bias) |

---

## Quick start (DEMO MODE: no keys needed)

Requirements: Python 3.11+ (tested on 3.12), Node 18+ (tested on 24).

```bash
pip install -r backend/requirements.txt
```

```bash
npm --prefix frontend install
```

Seed the database (deterministic demo start state, about 0.5 s; the backend also seeds on first start):

```bash
cd backend && python -m app.db.seed
```

Run the backend (API docs at http://localhost:8000/docs):

```bash
python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
```

Run the frontend (http://localhost:5173):

```bash
npm --prefix frontend run dev
```

Run the tests:

```bash
cd backend && python -m pytest -q
```

Reset the demo (also a button in the header and the Control Room admin panel):

```bash
curl -X POST http://localhost:8000/api/v1/demo/reset
```

### Single port + judge mode on a phone (LAN or hotspot)

Build the frontend once. The backend then serves the whole app on port 8000:

```bash
npm --prefix frontend run build
```

```bash
python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
```

Put the laptop and the phones on the same Wi-Fi or hotspot, open `http://<laptop-LAN-IP>:8000/`, and the QR code on the Control Room opens `/judge` on any phone. It reads the laptop's LAN address from `/api/v1/network`. On Windows, allow Python through the firewall for private networks. If the network blocks device-to-device traffic, use a tunnel instead:

```bash
npx cloudflared tunnel --url http://localhost:8000
```

---

## Farmer view (default screen)

Opening the app shows **one Kolar farmer's farm in 3D** (Three.js via React Three Fiber). There are three places, each with one batch:

| Place | Batch | Story |
|---|---|---|
| Farm shed | ZR-TOM-001 · 500 kg tomatoes (open shed, weather-estimated) | Scenario 1: prediction and decision |
| Cold storage container (Malur) | ZR-MAN-001 · 1.8 t mangoes | Scenario 3: when to sell (market shift) |
| Mandi company's reefer truck | ZR-BAN-001 · 6 t bananas, waiting at the loading bay | Scenario 2: handover, breakdown and rescue |

* Tap a place and the camera flies in. The batch card shows the **three answers** (quality now, days left with range, worth today) with a real photo for the freshness stage and **one recommended action**.
* **See the future**: dragging the slider spoils the crate photo and counts the rupee value down. Every number comes from the same decay engine.
* **What if I…** buttons (keep it cool, sell in 2 days, send to Bengaluru) re-run the engine and show before/after values.
* **See all choices** opens Sell now / Store / Send to another mandi, plus *When should I sell?* (Today, Day 2, Day 4, Day 7) under Normal, Price crash, Festival and Heavy rain conditions.
* **Mandi truck**: *Hand over to mandi truck* plays the crate-loading animation and the truck drives off. *Simulate cooling breakdown* (or **F**) makes it smoke and flash red. Rescue checks then run, the new route waits for **your approval**, and the result reads "You protected ₹X" with a faded ghost truck showing what would have happened.
* **ಕನ್ನಡ / English** switch at the top. Alerts also show their Kannada text.
* **Detailed mode** adds charts, confidence reasons, rejected options, demo scenario shortcuts and an **Analytics** link to the operator screens (`/ops`: control-room map, transport, markets, impact, settings).

Produce photos are from Wikimedia Commons (CC BY-SA / public domain). Credits are in `frontend/public/produce/credits.json`. They illustrate the freshness stage, not the actual batch.

## Demo script (deterministic, all in DEMO MODE)

**Reset demo** (top right) restores the start state in under 2 seconds. With Detailed mode on, the *Demo scenario* menu jumps straight to each story.

1. **Shed (tomatoes):** tap the shed, read the three answers, drag *See the future*, tap *Keep it cool*, then *See all choices*.
2. **Mandi truck (bananas):** tap the truck, *Hand over to mandi truck* (watch the crates load), *Simulate cooling breakdown*, then *Approve new route*, and see "You protected ₹X".
3. **Cold storage (mangoes):** tap the container, *See all choices*, switch *When should I sell?* between Price crash (Today) and Festival demand (Day 4), and pick a non-recommended day to see "₹X less than recommended. Your choice."

## REAL MODE and API keys

Toggle **DEMO / REAL** in the header (or `POST /api/v1/mode`). REAL MODE checks every provider, uses whatever works, and shows status dots plus a reason for anything unavailable. It never silently falls back while showing REAL; fallbacks are labelled.

Copy `.env.example` to `.env` (repo root) and fill in:

| Key | Used for | Where to get it |
|---|---|---|
| `DATA_GOV_API_KEY` | Live Agmarknet mandi prices | Register at https://data.gov.in, then "My Account → API key" (free) |
| `GROQ_API_KEY`, `GROQ_MODEL` | Agentic rescue workflow (tool calling) | https://console.groq.com/keys (free tier) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Real farmer alerts with Approve / Store / Sell buttons | Create a bot with @BotFather; send it a message, then read `chat.id` from `https://api.telegram.org/bot<TOKEN>/getUpdates` |
| `WHATSAPP_*` | Not used yet (adapter + preview only) | Meta WhatsApp Cloud API (future) |

Open-Meteo (weather), OSRM (roads) and Carto (map tiles) need no key. Telegram button replies work through long polling, so no public webhook is needed. `POST /api/v1/telegram/webhook` also exists. Keys stay in the backend and are never sent to the browser or logged.

---

## Data origins and honesty

Every reading and record carries its origin (`manual`, `simulated`, `external_api`, `cached`, `image_derived`, `model_prediction`), and the UI shows it.

| Data | Status in this build |
|---|---|
| Weather | **Real** Open-Meteo hourly forecast for 15 districts and 10 mandis, cached on 2026-11-05 (`data/seed/weather_cache.json`). REAL MODE refreshes it live. |
| Road routes | **Real** OSRM road geometry and distance/time table, cached (`routes_cache.json`, `distance_table.json`, `reroutes_cache.json`). |
| Karnataka outline | OpenStreetMap via Nominatim (ODbL), used by the offline map. |
| Mandi prices | **SIMULATED** 60-day series, labelled everywhere. No data.gov.in key was available at build time; set `DATA_GOV_API_KEY` for live prices. |
| Cold-chain feed, trucks, other farmers | **SIMULATED** (setpoint + noise + injected faults) on real roads. |

Naming follows the brief: *Decay Engine*, *Prediction Engine*, *Rule-Based Decision Engine*, *Agentic Rescue Workflow* (only when Groq actually runs it), *Rule-Based Workflow* otherwise. No trained-ML claims, no invented accuracy, and no autonomous control: reroutes need human approval. WhatsApp messages are previews and are never claimed as sent.

## The science (summary; full detail in `docs/parameter_audit.md`)

```
k(T, RH) = k_ref · m(maturity) · Q10^((T − T_ref)/10) · h(RH) · c(E)
Q(t+Δt)  = Q(t) · exp(−k·Δt)                 (hourly steps over the actual history)
W: dW/dt = kw · VPD(T,RH) · (1 − W)          weight loss → mass only
R: rot below Q_rot, high RH, heat, chilling  rejected units → removed from sale only
Value    = M·(1−W)·(1−R) · price(t) · grade(Q)
```

* **k_ref** is calibrated from published storage life L, using `k_ref = ln(100/40)/L`. This guarantees Q reaches 40 at day L by construction; it does **not** validate the curve shape.
* **Q10** is derived from UC Davis respiration tables, using the pair that covers ambient shed temperatures.
* **Chilling** thresholds and doses come from UC Davis (tomato 10 °C, 5 °C for 6–8 days; banana 13 °C, with dose points). Penalty shapes, W and R are labelled engineering assumptions.
* **Uncertainty**: 200 Monte Carlo draws over the registry ranges give the P10–P90 bands.
* **Confidence** is a data-quality index (0–100), **not a calibrated probability**: `100 × (0.20C + 0.10D + 0.10F + 0.15S + 0.15B + 0.20P + 0.10A)`. An all-simulated feed is capped at MEDIUM (74). The two weakest factors are shown as the reason.
* **Price scenarios** come from the 10th–90th percentile of comparable day-over-day changes (same commodity, mandi and unit; gaps over 7 days and outliers beyond 5σ dropped). With fewer than 14 points, a labelled ±15% assumed band is used instead.
* **Morning auctions (demo assumption):** loads arriving outside 04:00–10:00 wait for the next 06:00 auction. This is applied the same way to Sell, Ship and rescue options.

## Test results

`python -m pytest -q` gives **30 passed**. These cover brief tests 1–15 and 12a–12g: monotonic decay, temperature, chilling, humidity, spikes, invalid inputs, missing data lowers confidence, coverage vs burst, reading de-duplication, infeasible SHIP, insufficient data, Market Shift choice, the confidence reference value, value protected = difference (never positive when worse), the ±15% short-history band, k_ref reproducing storage life within 1%, confidence edge cases, an exact value-loss breakdown, comparable price series, Scenarios 1–3 offline with no keys, Reset Demo restoring the exact state in under 2 s, and what-if latest-request handling.

## Repository

```
backend/app/engine/      decay, confidence, value, decision, plans, market_shift, ghost, conditions, registry
backend/app/simulation/  tick loop, transport geometry
backend/app/workflows/   rescue workflow (Groq tool calling + rule-based fallback)
backend/app/providers/   cached / live providers, Telegram, WhatsApp preview, FutureIoTProvider interface
backend/app/api/v1/      core (predict/decide), ops (protect/demo), prove
backend/scripts/         fetch_seed.py (refresh real cached data), build_registry.py (registry + audit)
data/parameters/         versioned parameter registry JSON with sources
data/seed/               cached real weather, routes, outline, locations
docs/                    parameter_audit.md, architecture.md
frontend/src/            React + TypeScript + Tailwind + TanStack Query + Zustand + Recharts + deck.gl
```

## Known limitations

* Mandi prices are simulated until a data.gov.in key is configured. The live adapter maps Agmarknet market names into the same schema.
* k_ref calibration fixes the end point, not the curve shape. No experimental quality-over-time data has been fitted yet, and the Validation page stays empty until real outcomes are recorded.
* The open-shed climate is regional weather, not a shed measurement (the app says so and accepts a manual reading).
* Basemap tiles need internet. When they fail, the map switches automatically to an offline Karnataka outline with the same trucks, routes and facilities.
* The district view uses district centroids; district boundary polygons are not bundled.
* Single demo login and no role-based access, by design for the hackathon. SQLite is used; the models are Postgres-compatible via `DATABASE_URL`.

## Future IoT integration

`FutureIoTProvider` documents the contract. A device (ESP32, LoRa, reefer telematics) posts `{"ts", "temperature", "humidity", "origin": "sensor"}` to `POST /api/v1/batches/{id}/readings`. The engine already consumes readings by origin, and confidence treats `sensor` as a measured source, so no engine change is needed.
