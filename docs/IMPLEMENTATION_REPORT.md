# Implementation report

Status as of 5 Nov 2026. Rule followed throughout: an item is marked complete only if it runs end to end. Anything
partial, untested or dependent on credentials is listed as such.

## 1. Completed and verified end to end (browser + API)

| Area | What was verified |
|---|---|
| Auth & RBAC | First-user admin setup, login, JWT expiry, 401 → sign-out, admin-only users and audit endpoints |
| Post-harvest | Farmer and batch creation with Open-Meteo place search, status changes, onion refused for prediction with a reason |
| Traditional storage twin | Created from the UI with live Kolar weather (surface pressure ~922 hPa from Open-Meteo); daily temperature cycle with thermal lag, RH, O₂/CO₂, quality decay, P10–P90 shelf life, alerts, door/vent controls, scenarios |
| Cold-room twin | Facility → zone → allocation recommendation (capacity, temperature range, co-storage compatibility) → allocation → simulation with automatic corrective control |
| Cold-chain twin | Truck + OSRM route (Kolar → KR Market, 69.1 km, live) → trip; exterior and cutaway views, 6-zone heatmap, sensor tags, route progress/GPS/ETA, scenario injection (refrigeration failure → CRITICAL alert pushed over WebSocket) |
| Advanced storage | Photo upload → OpenCV per-item classification → bounding boxes → sorting-line replay of the real counts |
| Alerts | Timestamp, reading, expected range, risk, recommendation; acknowledge; corrective actions; WebSocket toasts; hysteresis (1 h clear before resolve) |
| Profit engine | Manual price → day-by-day net profit, P10 shelf-life cutoff, never recommends waiting when it is worse |
| AI explanations | Groq (`openai/gpt-oss-120b`) structured JSON, validated; numbers cross-checked against the model payload; failure shown as *unavailable* |
| Analytics | Traditional vs cold storage (418 kg loss prevented for a 500 kg tomato batch over 7 d in the test run) and fault vs normal cold chain; CSV and PDF export |
| Mobile QR | QR + PIN, wrong PIN rejected, scoped view of one simulation, alerts acknowledge, view-only enforced without the control permission |
| Honest states | Prices show DATA UNAVAILABLE without a data.gov.in key; weather outage returns 503 with a manual-ambient option; forecast returns *insufficient data* below 60 points |

## 2. Automated tests

- **Backend: 49 passing** (`cd backend && python -m pytest -q`)
  - Physics (14): Dalton partial pressures, psychrometrics, thermal lag, gradual cold-room failure, door effect, CO₂ accumulation, truck front-to-rear gradient, refrigeration failure, delay, alert open/resolve with hysteresis, automatic control, determinism, manual ambient, loss formula
  - Engine (23): decay model, Monte Carlo, validation, registry, plus legacy v1 modules (see §6)
  - API (12): auth, catalog, allocation capacity limits, weather outage → 503, storage alerts and actions, QR scoping and revocation, profit, market unavailable, forecast insufficient data, inspection, cold chain + comparison + PDF/CSV, Groq unavailable, summary
- **Frontend: 10 passing** (`cd frontend && npm test`): formatting, API client error handling (503 message surfaced, 401 sign-out, backend unreachable), data-origin labels, empty and error states
- **Type check and production build:** `tsc -b` and `vite build` pass.

## 3. External connections

| Service | Status | Notes |
|---|---|---|
| Open-Meteo forecast + geocoding | **Connected, live** | No key |
| OSRM routing | **Connected, live** | Public demo server (rate-limited); self-host for production |
| Groq | **Connected** with the local key | Explanations only; never used for numbers |
| GDELT news | Connected, intermittently rate-limited (HTTP 429) | Retries once, then shows *unavailable* |
| data.gov.in Agmarknet | **Needs credentials** | `DATA_GOV_API_KEY` not configured → prices DATA UNAVAILABLE |
| Web push (VAPID) | Keys generated, subscribe/test endpoints implemented | Delivery not tested end to end (needs HTTPS and browser permission) |
| PostgreSQL | **Not tested** | Docker engine unavailable during development; Alembic migration verified on SQLite only |

## 4. Needs credentials or configuration

- `DATA_GOV_API_KEY` for verified mandi prices. Forecasting additionally needs ≥ 60 daily observations per market (`AGMARKNET_HISTORY_RESOURCE_ID` or accumulated daily refreshes).
- `PUBLIC_BASE_URL` reachable from phones for QR links; HTTPS for push and the installable PWA.
- `JWT_SECRET`, `POSTGRES_PASSWORD` for deployment.

## 5. Needs model weights

- **Computer vision:** no trained model is shipped and ONNX inference is **not implemented**. Inspection uses classical
  OpenCV colour/texture analysis with engineering thresholds, labelled as such in the UI. It has not been validated
  against a labelled dataset; known weakness: small dark spots on overripe bananas are under-detected.

## 6. Incomplete, untested or limited

- **Docker / compose:** `Dockerfile` and `docker-compose.yml` are written but were never built or run here.
- **PostgreSQL:** not run against a real PostgreSQL instance.
- **3D assets:** the twins use procedural Three.js geometry plus real produce photos on crates. No downloaded realistic 3D models (glTF) are included.
- **Deterioration model:** Q10 decay calibrated to published storage life; the shape of the quality curve is not validated against measurements. Onion prediction is disabled (dormancy and sprouting not modelled).
- **Physics simplifications:** lumped air and produce nodes; the truck is 6 zones along its length (no vertical stratification); the cold-room setpoint controller is proportional, not a real compressor cycle.
- **Counterfactual comparisons** are simulated estimates from the same engine, not measured savings, and are labelled that way.
- **Interface language:** English UI. Kannada is available for AI explanations; the earlier v1 Kannada UI mode and the Mitra voice assistant were not carried into this redesign.
- **Scaling:** single-process simulation manager (run one worker).
- **Frontend tests:** unit and component level only; no browser end-to-end suite.
- **Legacy code:** v1 engine modules (`backend/app/engine/conditions, confidence, decision, geo, ghost, market_shift, plans, predict, format`) are no longer used by the v2 API. They remain only for their existing tests and contain v1 demo market scenarios that are unreachable from the app.
