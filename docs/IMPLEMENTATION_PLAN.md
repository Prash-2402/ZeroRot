# ZERO ROT — Digital Twin Platform: Implementation Plan

Rebuild of the hackathon app into an interconnected post-harvest + cold-chain digital twin
(spec: "MASTER BUILD PROMPT", Nov 2026). Name stays **ZERO ROT**.

## Repository inspection (start state)
- Backend: FastAPI + SQLAlchemy 2 + SQLite, a 3-batch demo seed, Q10 decay engine (`app/engine/decay.py`) with a
  sourced parameter registry (UC Davis), decision/plan engines, rescue workflow, Mitra assistant (Groq + rule-based + RAG).
- Frontend: React 19 + Vite + Tailwind 3 + R3F 9 farmer view, operator pages under `/ops`.
- Conflicts with the new spec: demo seed data populates dashboards; no auth; SQLite only; no thermal/gas physics;
  simulated mandi prices; no CV model; green theme.

## What is kept
- `app/engine/decay.py`, `registry.py`, `confidence.py`, `value.py` (Q10 kinetics, Monte Carlo band, confidence index).
- `data/parameters` registry, extended with potato. Onion is catalogued but **prediction not supported** (ambient
  onion storage is governed by dormancy/sprouting, which a respiration Q10 model does not represent).
- Mitra knowledge library (`data/knowledge`) for RAG.

## Architecture
```
React (Vite, R3F)  ──REST /api/v1 + WS /ws/simulations/{id}──►  FastAPI
                                                                │
   integrations/  Open-Meteo (weather+geocoding) · OSRM (routes) · data.gov.in Agmarknet · Groq · Web Push
   simulation/    authoritative state per simulation: thermal, humidity, gas (Dalton), deterioration, truck zones,
                  scenarios, alert engine, virtual sensors → persisted readings + snapshots
   ml/            OpenCV produce inspection · price forecasting (scikit-learn GBR, backtested)
   services/      cold-storage allocation · profit (sell now vs later) · analytics · PDF/CSV reports · QR sessions
   db/            SQLAlchemy models (24 tables) + Alembic migrations · PostgreSQL (Docker) / SQLite (local dev)
```

## Data honesty rules (enforced in code)
| Data | Label |
|---|---|
| Virtual sensors | `SIMULATED` (deterministic physics, no random noise) |
| Open-Meteo weather, OSRM routes, Agmarknet prices | `LIVE` with retrieval time, or `DATA UNAVAILABLE` with the error |
| Farmer-entered price / reading | `MANUAL` |
| CV inspection | method + model version; `uncertain` when confidence is low; sample vs batch quantity kept separate |
| Groq text | explanation only, never numbers it was not given; failure → visible error, numerical results continue |

## Phases
1. Foundation: schema, migrations, auth (JWT, roles), commodity catalog, audit log.
2. Simulation engine + tests (thermal, humidity, gas, deterioration, cold room, truck zones, scenarios, alerts).
3. Integrations: weather/geocoding, routing, market adapter, forecasting, Groq structured explanations.
4. CV inspection, allocation optimizer, profit engine, analytics + exports.
5. QR sessions (token + PIN, expiring, revocable, scoped), mobile PWA, web push.
6. Frontend rebuild in the black / white / gold design system with four 3D twins.
7. Tests, Docker Compose (Postgres), README, implementation report.
