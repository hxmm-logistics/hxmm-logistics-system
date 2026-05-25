# HX MM Production Runbook

HX MM is a Myanmar-focused cross-border logistics tracking system. This document describes staging and production initialization for the existing Express + PostgreSQL + React Vite monolith.

## Environment

Create `.env` in the project root:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/hxmm_staging
JWT_SECRET=replace_with_a_long_random_secret
PORT=4000
CORS_ORIGIN=https://hxmm.net
NODE_ENV=production
```

Rules:

- `DATABASE_URL` must point to a real PostgreSQL database.
- `JWT_SECRET` must not be the default value from examples.
- Production `CORS_ORIGIN` must be an explicit origin, not `*`.
- Keep `.env` out of Git.

## Staging Database

Recommended providers:

- Neon PostgreSQL
- Supabase PostgreSQL
- Railway PostgreSQL

Connectivity check:

```bash
node -e "import('pg').then(async ({default: pg}) => { const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }); const r = await pool.query('SELECT version()'); console.log(r.rows[0].version); await pool.end(); })"
```

If using PowerShell:

```powershell
$env:DATABASE_URL = "postgresql://USER:PASSWORD@HOST:5432/hxmm_staging"
node -e "import('pg').then(async ({default: pg}) => { const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }); const r = await pool.query('SELECT version()'); console.log(r.rows[0].version); await pool.end(); })"
```

## Initialization

Install dependencies:

```bash
npm install
```

Initialize database:

```bash
npm run db:init
```

`db:init` runs:

1. `npm run db:schema`
2. `npm run db:migrate`
3. `npm run db:migrate:auth`
4. `npm run db:migrate:tracking`
5. `npm run db:migrate:tracking-events`
6. `npm run db:migrate:phase1b`
7. `npm run db:migrate:phase1f`
8. `npm run db:migrate:batches`
9. `npm run db:migrate:exceptions`
10. `npm run db:seed`
11. `npm run db:seed:users`

Runtime tables expected after initialization:

- `shipments`
- `tracking_events`
- `batches`
- `batch_shipments`
- `exceptions`
- `shipment_status_logs`
- `operation_logs`
- `users`

Verification query:

```bash
psql "$DATABASE_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('shipments','tracking_events','batches','batch_shipments','exceptions','shipment_status_logs','operation_logs','users') ORDER BY table_name;"
```

## Build

```bash
npm run build
```

Build output is generated in:

```text
dist/
```

## Backend Startup

Local/staging:

```bash
npm run start
```

Health check:

```bash
curl http://127.0.0.1:4000/api/health
```

Expected:

```json
{"ok":true,"service":"HX MM","database":"ok"}
```

## Acceptance

Run after the backend is running and database is initialized:

```bash
ACCEPTANCE_BASE_URL=http://127.0.0.1:4000/api \
ACCEPTANCE_USERNAME=admin \
ACCEPTANCE_PASSWORD=admin123456 \
npm run acceptance
```

PowerShell:

```powershell
$env:ACCEPTANCE_BASE_URL="http://127.0.0.1:4000/api"
$env:ACCEPTANCE_USERNAME="admin"
$env:ACCEPTANCE_PASSWORD="admin123456"
npm run acceptance
```

Acceptance verifies:

- health check
- login
- shipment creation
- PDA inbound receive
- tracking event aggregation
- public tracking query
- invalid transition rejection
- batch create
- batch shipment add
- batch depart
- batch arrive
- exception create
- dashboard stats

## PM2

Start:

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

Restart:

```bash
pm2 restart hx-mm-api --update-env
pm2 logs hx-mm-api --lines 50
```

Status:

```bash
pm2 list
pm2 show hx-mm-api
```

## Nginx Expectations

Nginx should:

- serve `dist/` for the React SPA
- proxy `/api/` to `http://127.0.0.1:4000/api/`
- preserve SPA fallback to `index.html`
- set security headers
- enable gzip

Example checks:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -I https://hxmm.net/track
curl https://hxmm.net/api/health
```

## Public Verification

```bash
curl https://hxmm.net/api/health
curl https://hxmm.net/api/public/tracking/YT123456789
```

If the deployment keeps compatibility routes:

```bash
curl https://hxmm.net/public/tracking/YT123456789
```

## Rollback

Before migration:

```bash
pg_dump "$DATABASE_URL" > backup_before_release_$(date +%Y%m%d_%H%M%S).sql
```

Rollback code:

```bash
git checkout <previous_release_tag_or_commit>
npm install
npm run build
pm2 restart hx-mm-api --update-env
```

Rollback Phase-1F legacy table drop if needed:

```bash
node scripts/run-sql.js database/migrations/006_phase1f_drop_shipment_events.rollback.sql
```

Restore full database only when required:

```bash
psql "$DATABASE_URL" < backup_before_release_YYYYMMDD_HHMMSS.sql
```

## Deployment Checklist

1. Confirm `.env` has valid `DATABASE_URL`, `JWT_SECRET`, `PORT`, `CORS_ORIGIN`.
2. Confirm database connection works.
3. Run `npm install`.
4. Run `npm run db:init`.
5. Run `npm run build`.
6. Start backend with PM2.
7. Check `/api/health`.
8. Run `npm run acceptance`.
9. Reload Nginx.
10. Verify public URLs.

## Known Blockers To Resolve Before Staging Operational

- A real `DATABASE_URL` is required.
- PostgreSQL client tools are recommended for direct verification.
- Acceptance requires a running backend and valid seeded admin credentials.
