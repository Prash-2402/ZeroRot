# Deployment guide

ZERO ROT ships as one container: the FastAPI backend serves the API, the WebSockets and the built React app from the
same origin. PostgreSQL is the production database; SQLite is for local development only.

## 1. Configure

```bash
cp .env.example .env
```

| Variable | Required | Notes |
|---|---|---|
| `ENVIRONMENT=production` | yes | Refuses to start without `JWT_SECRET` and a PostgreSQL `DATABASE_URL` |
| `JWT_SECRET` | yes | `python -c "import secrets;print(secrets.token_urlsafe(48))"` |
| `DATABASE_URL` | yes (prod) | `postgresql+psycopg2://user:pass@host:5432/zerorot` (compose sets it for you) |
| `POSTGRES_PASSWORD` | compose | Password for the bundled PostgreSQL container |
| `CORS_ORIGINS` | yes | Your public origin(s), comma-separated |
| `PUBLIC_BASE_URL` | for QR | Public HTTPS URL; QR links point here, so phones must be able to reach it |
| `GROQ_API_KEY` | optional | AI explanations; without it the "Explain" buttons show *AI explanation unavailable* |
| `DATA_GOV_API_KEY` | optional | Verified Agmarknet prices; without it prices show *DATA UNAVAILABLE* (manual price entry still works) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | recommended | Web push keys. If empty they are generated once and stored in `VAPID_KEY_FILE` |

Weather (Open-Meteo), geocoding and routing (public OSRM) need no keys. For heavy use, point `OSRM_BASE_URL` at your own
OSRM server; the public demo server is rate-limited and has no uptime guarantee.

## 2. Run with Docker Compose

```bash
docker compose up --build -d
docker compose logs -f app
```

- The app listens on port 8000. Migrations run automatically at startup (`alembic upgrade head`).
- Data persists in the `pgdata` volume; VAPID keys in the `vapid` volume.
- Health check: `GET /api/v1/auth/setup`.
- The first account created in the browser becomes the administrator; create other users in Settings → Users.

## 3. HTTPS (required for push and installable PWA)

Put a TLS-terminating reverse proxy in front of port 8000 and forward WebSockets. Example (Caddy):

```
zerorot.example.in {
    reverse_proxy app:8000
}
```

Nginx needs `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` for `/ws/`.
uvicorn runs with `--proxy-headers`, so client IPs used for rate limiting and audit come from the proxy.

## 4. Without Docker

```bash
pip install -r backend/requirements.txt
cd frontend && npm ci --legacy-peer-deps && npm run build && cd ..
ENVIRONMENT=production DATABASE_URL=postgresql+psycopg2://... JWT_SECRET=... \
  python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000 --proxy-headers
```

Run a single worker. The simulation manager keeps authoritative in-memory runtimes (snapshotted to the database), so
several workers would each advance their own copy. Scale vertically or split the manager into its own process before
adding workers.

## 5. Operations

- **Backups:** back up the PostgreSQL database. Simulation snapshots, readings, predictions, alerts and audit logs all live there.
- **Restarts:** running simulations resume from their latest snapshot.
- **Rotating `JWT_SECRET`** signs everyone out and invalidates all mobile QR sessions.
- **Revoking a phone:** Settings → Mobile QR sessions → Revoke.
- **Logs:** standard output (uvicorn + `zerorot.*` loggers).

## Verification status

The Dockerfile and `docker-compose.yml` were written but **not executed** in the development environment (Docker
engine unavailable), and the Alembic migration has only been run against SQLite. Run the compose stack once and check
the startup logs before relying on it. See `docs/IMPLEMENTATION_REPORT.md`.
