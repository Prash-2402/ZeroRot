# ZERO ROT

**AI-powered post-harvest loss prevention and intelligent cold-chain digital twin platform**
Problem statement DL-SJBIT-HK26-AGR007 · *Intelligent Agriculture. Reduced Losses. Better Profits.*

ZERO ROT follows a batch of harvested produce from the farm through storage, inspection and transport to sale.
Physics-based digital twins (traditional storage room, refrigerated cold room, refrigerated truck) are driven by live
weather and real road routes. They predict quality and shelf life, raise alerts with corrective actions, and feed a
market-aware sell-now vs store-and-sell decision.

**Data policy:** every value is labelled SIMULATED, LIVE, MANUAL or DATA UNAVAILABLE. Nothing is pre-filled or invented.
If a source is down, the UI says so instead of making up a number. Groq AI only *explains* numbers computed by the models.

---

## Modules

| Module | What it does | Data sources |
|---|---|---|
| Post-harvest | Farmers, batches (commodity, maturity, quantity, harvest quality, location), status workflow, mobile QR per batch | User input |
| Traditional storage | Brick / mud / tin room twin: envelope heat transfer, ventilation, psychrometrics, respiration heat, Dalton partial pressures, O₂/CO₂ balance, quality decay | Open-Meteo forecast (LIVE) or manual |
| Advanced storage | Photo inspection (OpenCV) → good / damaged / rejected / uncertain per item, sample vs batch estimate, animated sorting-line replay of the real result, capacity- and compatibility-aware cold-zone allocation | Uploaded photos |
| Cold storage | Facilities and zones with real capacity, load and cost; cold-room twin with refrigeration controller, door, coil condensation, humidifier, automatic corrective control | Open-Meteo, user zone specs |
| Price intelligence | Agmarknet prices via data.gov.in, gradient-boosted forecast backtested against a naive baseline with an empirical P10–P90 band, GDELT news context, profit engine | data.gov.in (key), GDELT |
| Cold chain | Reefer truck on an OSRM road route, weather sampled along the route, 6-zone cargo heat model (front unit → rear door), exterior and cutaway heatmap views, virtual sensors, GPS, ETA and delay, 7 scenarios | OSRM, Open-Meteo |
| Alerts | Rule-based events with timestamp, reading, expected range, risk and recommendation; acknowledge; corrective actions (manual or automatic, all logged); WebSocket toasts and web push | Simulation state |
| Analytics | Same-engine counterfactual comparison (traditional vs cold storage, fault vs normal cold chain) with CSV and PDF export | Simulation engine |
| Mobile | QR link + 6-digit PIN → scoped, expiring, revocable session for one batch / simulation / zone / truck; PWA with push | — |

Cold-chain scenarios: 1 normal · 2 high external temperature · 3 refrigeration failure · 4 door open · 5 cooling degradation · 6 humidity deviation · 7 extended delay.

Supported commodities: tomato, mango, banana, potato (prediction), onion (catalogue only: dormancy and sprouting are not modelled, so prediction is refused with a reason).
Every parameter carries its source, classification (sourced / derived / assumption) and limitations; see Settings → Commodity parameters and `docs/parameter_audit.md`.

---

## Quick start (local, SQLite)

Requirements: Python 3.11+ (tested 3.12), Node 18+ (tested 24).

```bash
pip install -r backend/requirements.txt
cp .env.example .env          # optional keys: GROQ_API_KEY, DATA_GOV_API_KEY; set JWT_SECRET
cd frontend && npm ci --legacy-peer-deps && npm run build && cd ..
python -m uvicorn app.main:app --app-dir backend --port 8000
```

Open http://localhost:8000. The first account you create becomes the administrator. Migrations run automatically at startup (Alembic).

For frontend development with hot reload, run `npm run dev` in `frontend/` (http://localhost:5173, proxies `/api` and `/ws` to port 8000).

### Docker (PostgreSQL)

```bash
cp .env.example .env    # set JWT_SECRET and POSTGRES_PASSWORD
docker compose up --build
```

See `docs/DEPLOYMENT.md` for production notes (HTTPS, PUBLIC_BASE_URL for QR links, push).

---

## Try it in five minutes

1. **Post-Harvest** → add a batch (e.g. tomato, 500 kg, location search "Kolar").
2. **Traditional Storage** → New simulation → the backend fetches the live forecast and starts the room twin. Change speed, open the door, close the vents, inject *heat wave*, watch temperature, RH, O₂/CO₂, quality and the alerts.
3. **Cold Storage** → add a facility and a zone (temperature range, capacity, kW, UA). **Advanced Storage** → upload produce photos, then *Recommend zone* → *Allocate*. Back in Cold Storage → *Cold-room simulation*.
4. **Cold Chain** → add a truck and a route (two place searches; OSRM returns the road) → *Trip simulation*. Switch Exterior / Cutaway, inject *refrigeration failure*, watch the rear zones warm first.
5. **Analytics** → compare traditional vs cold storage or a fault vs normal trip → export CSV or PDF.
6. Any **QR** button → scan with a phone on the same network (set PUBLIC_BASE_URL to your LAN address), enter the PIN.

---

## Architecture

```
React 19 + Vite + Tailwind + TanStack Query + React Three Fiber
        │  REST /api/v1/*      WebSocket /ws/simulations/{id}, /ws/alerts   (JWT or scoped QR token)
FastAPI ─┬─ simulation manager (asyncio loop, authoritative state, snapshots, readings, predictions, alerts)
         ├─ physics: environment · thermal · humidity · gas · deterioration · cold_storage · truck_model · event_manager
         ├─ services: allocation · profit · analytics · reports (CSV/PDF) · QR sessions · sim config
         ├─ ml: price forecasting (scikit-learn) · vision (OpenCV classical)
         ├─ integrations: Open-Meteo · OSRM · data.gov.in Agmarknet · GDELT · Groq · Web Push (VAPID)
         └─ SQLAlchemy 2 + Alembic → SQLite (dev) / PostgreSQL (prod), 25 tables
```

API groups (`/api/v1`): auth, commodities, farmers, batches, weather, storage, inspections, trucks, routes, simulations,
alerts, corrective-actions, market, profit, ai, analytics, qr, mobile, notifications, integrations, audit.
Interactive docs: http://localhost:8000/docs.

Security: bcrypt passwords, HS256 JWT with expiry, roles (admin / operator / farmer), restricted CORS, per-IP rate
limiting (stricter for login, QR PIN and AI), WebSocket token auth, audit log, QR tokens stored as SHA-256 hashes with
PIN lockout after 5 failures, no secrets in the frontend.

---

## Tests

```bash
cd backend && python -m pytest -q        # 49 tests: physics, engine, API incl. outages and access control
cd frontend && npm test                  # 10 tests: formatting, API error handling, data-origin labels
```

---

## Documentation

- `docs/IMPLEMENTATION_REPORT.md`: what is complete, tested, connected, what needs credentials, what is incomplete
- `docs/DEPLOYMENT.md`: deployment guide
- `docs/IMPLEMENTATION_PLAN.md`, `docs/architecture.md`, `docs/parameter_audit.md`
- Produce photo credits: `frontend/public/produce/credits.json`
