# HX MM PHASE-1A Status Mutation Report

Audit date: 2026-05-24
Contract rule: `tracking_events` is the single source of truth. `shipment.status` is computed/aggregated only, never directly set by business workflows.

## Summary

The codebase has an aggregation service, but status mutation is still not contract-compliant because:

- status cache is derived from non-official `event_type` values.
- shipment rows are created with direct legacy status values.
- button/action workflows still cause status changes.
- legacy `shipment_events` writes continue in active flows.

## Detected Mutation Paths

| File path | Violation type | Current behavior | Required contract-compliant behavior | Migration risk | Recommended fix |
|---|---|---|---|---|---|
| `backend/services/trackingEvents.js` | Aggregation uses wrong source vocabulary | Recalculates `shipments.current_status` and `shipments.status` from `tracking_events.event_type`, where `event_type` is a legacy status-like value. | Recalculate status from official `tracking_events.event_code -> resulting_status` mapping only. | Medium. Aggregation mechanism is useful but dictionary is wrong. | Keep aggregation function, replace input/output contract in PHASE-1B. |
| `backend/routes/shipments.js` | Direct status on shipment creation | `POST /shipment/create` inserts initial shipment status fields directly, usually `PENDING`. | Create shipment, add official initial tracking event, aggregate status from that event. | High. Core create flow. | Introduce official create event path; keep old endpoint as compatibility wrapper. |
| `backend/routes/shipments.js` | Direct status on inbound scan | `POST /shipments/inbound-scan` creates shipment rows with direct status values and legacy inbound state. | Scan should create a `WAREHOUSE_RECEIVE` tracking event; status becomes `WAREHOUSE_RECEIVED`. | High. Warehouse flow is core to Phase 1. | Migrate inbound scan to official tracking event creation. |
| `backend/routes/shipments.js` | Button/action status mutation | `POST /shipment/:tracking_no/scan-update` maps action buttons to status values. | PDA must submit official tracking events, not mutate statuses through action buttons. | High. Explicitly forbidden by contract. | Replace with drawer/event-code workflow in PHASE-1D. |
| `backend/routes/shipments.js` | Manual event endpoint accepts status-like values | `POST /shipment/:tracking_no/event` accepts `event_type` and validates it as status transition. | Endpoint should be superseded by `POST /tracking_events` accepting official `event_code`. | Medium. Existing admin UI depends on it. | Keep legacy route but internally translate only during compatibility window. |
| `backend/services/syncChina.js` | Sync creates legacy events | China sync writes to `shipment_events` and creates transitional tracking events from legacy statuses. | Sync should create official tracking events based on normalized carrier facts. | Medium. Sync is a production integration surface. | Map raw China status to official event codes before persistence. |
| `database/schema.sql` | Legacy default mutation at DB level | `shipments.current_status` has default `PENDING`. | Default should not be business source of truth; status should be derived from events. | Medium. DB default can silently create invalid state. | Remove or neutralize default in a forward migration only after code is migrated. |
| `database/migrations/004_tracking_events_core.sql` | Historical bulk status update | Backfill migration updates shipment status based on generated tracking event rows. | Historical migration can remain, but new migrations must use official event-code aggregation. | Low if already applied, medium if replayed. | Do not edit applied migration; add corrective migration. |

## False Positives / Acceptable Patterns

- Updating `shipment.status` as an aggregated cache is allowed only when driven by official tracking events.
- Keeping legacy status columns during migration is allowed if they are not independently mutated by business workflows.
- Read-only legacy compatibility is allowed temporarily.

## Required End State

- No route accepts arbitrary shipment status updates.
- No route maps UI buttons directly to shipment status.
- All status changes are produced by official tracking events.
- `shipments.status/current_status` are cache fields only.
- Legacy rows are normalized or mapped at read time until data migration is complete.
