# ZERO ROT

Post-harvest loss prevention with a live digital twin. **The phone is the app; the laptop is the simulation of the real world.**
Scan the QR on the laptop, enter a crop on the phone, and the 3D world shows it being loaded, stored, graded, sold and
driven to the mandi, from one authoritative backend simulation, in sync within a second.

| Step | Phone app | Laptop 3D world |
|---|---|---|
| 1 · Live entry | Crop, quantity, condition, sell-within days, location (GPS / search), traditional or advanced godown | Tractor brings crates; godown fills at 2 t/h with the door open |
| 2 · Godown | Live temperature, humidity, quality, shelf life, alerts + suggestions, door/vent/setpoint controls | Brick godown (weather-driven) or cold godown (auto climate control): heat haze, vents, cooling fans, cold mist, sensor tags |
| 3 · Predict | Mandi rates, spoilage (now vs recommended storage), sell-now vs store decision, AI explanation | — |
| 4 · Scan & sort (advanced) | One tap: simulated scanner grades every item from the lot's modelled quality | Enclosed scan house: conveyor, scanner tunnel, A1 / A2 / A3 boxes stacking, reject bin |
| 5 · Track | Checkpoints, ETA; reefer trucks also cargo temperature, spoilage rate, shelf life; reroute notice, arrival/delivery notifications, Kannada/English help chat | Real road route, truck by true distance, checkpoint gantries, road-block barricade and reroute, mandi unloading |

The sky follows the simulated time and location (real sun position), and rain and cloud come from the live forecast.

## Run

Python 3.11+, Node 18+.

```bash
pip install -r backend/requirements.txt
cp .env.example .env            # set JWT_SECRET; optional GROQ_API_KEY(_1.._3), DATA_GOV_API_KEY
cd frontend && npm ci --legacy-peer-deps && npm run build && cd ..
python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
```

Open http://localhost:8000 on the laptop and sign in; the first account becomes admin. Scan the QR with a phone on the
same Wi-Fi and enter the PIN. The QR uses the laptop's network address automatically, or set `PUBLIC_BASE_URL`.
Allow port 8000 through the Windows firewall if the phone can't connect. Phone GPS and push notifications need HTTPS;
without it, use place search.

**Testing slowly** (laptop bottom bar): pause, step +1 min / +10 min / +1 h of simulated time, speed from real time to
1 h per second, per-stage test scenarios (door open, cooling failure, heat wave, road blocked, refrigeration failure,
delay), Sim time / Day / Night view, and a raw-values debug panel. Two playable sample situations (monsoon tomato · advanced, heat-wave banana · traditional) run every stage automatically. "Start from the laptop" creates a lot without a phone.

Docker with PostgreSQL: `docker compose up --build` (set `POSTGRES_PASSWORD` and `JWT_SECRET` in `.env`).

## Data policy

Godown and truck sensors are **SIMULATED** by the physics engine. Weather, routes and checkpoint names are **LIVE**
(Open-Meteo, OSRM, OpenStreetMap Nominatim). Prices are verified Agmarknet data or **DATA UNAVAILABLE**; a typed price is
labelled manual. Groq only explains; numbers come from the models. Operating rates (loading, grading, unloading, bag
size, truck and chamber specs) are stated assumptions in `backend/app/services/flow.py`. Parameter sources:
`docs/parameter_audit.md`. Status: `docs/IMPLEMENTATION_REPORT.md`.

## Tests

```bash
cd backend && python -m pytest -q     # 53: physics, API, full field flow (pairing → delivery), reroute, key rotation
cd frontend && npm test               # 14: formatting, API errors, labels, sun position, route mapping
```

The operations console (records, analytics, CSV/PDF export) is at `/app`.
