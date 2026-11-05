# ZERO ROT architecture

```
React (Vite)  ──REST /api/v1──►  FastAPI  ──►  domain.py  ──►  engine/ (one engine for everything)
   ▲                               │                             decay · confidence · value · plans
   └────────WebSocket /ws/live ◄───┤                             decision · market_shift · ghost
                                   │
                          simulation/loop.py  (one asyncio task, 1 tick/s, N sim-minutes/tick)
                          workflows/rescue.py (Groq tool calling or rule-based; human approval)
                          providers/ (cached | live: weather, mandi, routes, AI, Telegram; IoT interface)
                          SQLite via SQLAlchemy 2 (Postgres-compatible)
```

* **One engine.** The twin, what-if, decision, Market Shift Planner, simulation tick, rescue plans and ghost comparison all call `engine/decay.simulate` / `step`. The frontend never computes decay; every slider move calls `POST /simulations/recalculate`.
* **Plans.** `engine/plans.evaluate_plans` turns a list of storage/transport segments into quality, mass and net rupees for many options in one vectorised call. It is used by Sell/Store/Ship, the rescue options and the ghost comparison.
* **Simulated clock.** The demo has a fixed epoch (2026-11-05 06:00 IST) that matches the cached weather window, so scenarios are deterministic. `SIM_MINUTES_PER_TICK` (default 2) and pause are adjustable live.
* **WebSocket events:** `tick` (trucks, stats), `batch.update`, `alert.new`, `workflow.start/step/done`, `trip.update`, `reset`, `mode`.
* **Reroute flow.** `inject-failure` stores the exact failure state, then the rescue workflow runs and stores a proposal on the trip. Only `approve-reroute` (app, judge view or Telegram button) changes the route, computes the ghost comparison from the stored failure state, and writes `ghost_comparisons` plus `impact_events`.
