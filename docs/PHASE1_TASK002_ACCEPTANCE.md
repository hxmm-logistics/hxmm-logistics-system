# Phase 1 TASK-002 Acceptance

## Goal
Make the public tracking page behave like a real logistics tracking product, benchmarked against Kuaidi100, Cainiao, and Alipay Logistics.

## Current Problem
The public page still felt close to an admin record view and did not emphasize latest node, carrier, progress, and consumer-grade timeline hierarchy.

## Constraints
- Preserve Express + PostgreSQL + Vite React.
- Preserve nginx, PM2, HTTPS, deployment.
- Preserve existing APIs and backward compatibility.
- Public flow must not mutate shipment status.

## Architecture
```
shipments
  -> tracking_events
  -> public tracking aggregation
```

## Acceptance Criteria
- Public users can query without login.
- Public page contains only tracking input, result card, and logistics timeline.
- HX internal numbers return `未查询到包裹`.
- API returns `shipment`, `latest_event`, `timeline`, `current_city`, `estimated_delivery`, and `carrier`.
- Timeline is newest first.
- Timeline displays city, description, timestamp, and event type.
- Carrier is shown on the result card.
- No public UI can create shipments or mutate shipment status.

## Test Commands
```bash
npm run build
node --check backend/routes/shipments.js

curl -i "http://127.0.0.1:4000/api/track/query?tracking_no=HX202605220001"
curl -i "http://127.0.0.1:4000/api/track/query?tracking_no=YT8869543962621"
```

## Expected Results
- HX query returns 404 with `未查询到包裹`.
- External tracking number returns public tracking payload with top-level `timeline`.
- Frontend `/track` shows consumer-grade tracking UI and no admin controls.

## Migration SQL
No new migration is required for TASK-002. It uses TASK-001 `tracking_events`.

## Migration Notes
Run TASK-001 migration before production TASK-002 verification:
```bash
npm run db:migrate:tracking-events
```

## Technical Debt Notes
- Admin detail still uses legacy compatible `events`.
- TASK-003 will replace the scan page with a warehouse/PDA drawer workflow.
- TASK-004 will remove legacy direct status-style controls after scan workbench is event-only.
