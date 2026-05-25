# Phase 1 TASK-001 Acceptance

## Goal
Make `tracking_events` the source of truth for logistics timeline events.

## Current Problem
The current system still writes and reads legacy `shipment_events`, and several flows directly update shipment status.

## Constraints
- Preserve Express + PostgreSQL + Vite React.
- Preserve deployment, nginx, PM2, HTTPS.
- Preserve legacy APIs for compatibility.
- Do not remove existing business flows in TASK-001.

## Architecture
```
shipment_batches
  -> shipments
  -> tracking_events
```

For TASK-001, `tracking_events` is introduced and all new create/inbound/event flows write to it. `shipments.current_status/status/current_node` are refreshed from latest `tracking_events`.

## Acceptance Criteria
- `tracking_events` table exists.
- Public tracking query returns `timeline`.
- Shipment detail returns `tracking_events` and compatible `events`.
- Creating a shipment writes `tracking_events`.
- Inbound scan writes `tracking_events`.
- Adding an event writes `tracking_events`.
- `shipments.current_status` is refreshed from latest tracking event.
- HX internal numbers remain blocked from public tracking.

## Test Commands
```bash
npm run db:migrate:tracking-events
npm run build
node --check backend/routes/shipments.js
node --check backend/services/trackingEvents.js

curl -i "http://127.0.0.1:4000/api/track/query?tracking_no=HX202605220001"
curl -i "http://127.0.0.1:4000/api/track/query?tracking_no=YT8869543962621"
```

## Expected Results
- HX query returns 404 and `未查询到包裹`.
- Existing external tracking number returns shipment with `timeline`.
- New event inserts appear in `tracking_events`.

## Migration Notes
Run after existing auth/log migrations:
```bash
npm run db:migrate:tracking-events
```

## Technical Debt Notes
- Legacy `shipment_events` remains for compatibility.
- Legacy `scan-update` still exists and maps actions into tracking events.
- TASK-004 should remove direct button workflows after the event drawer workflow is available.
