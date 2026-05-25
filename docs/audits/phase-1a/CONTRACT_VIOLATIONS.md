# HX MM PHASE-1A Contract Violations

Audit date: 2026-05-24
Scope: contract compliance only. No runtime behavior was changed.

## Contract Baseline

Frozen contracts reviewed from `docs/contracts/`:

- `GLOBAL_RULES.md`
- `logistics_status_codes.md`
- `tracking_event_codes.md`
- `status_transition_rules.md`
- `workflow_lifecycle.md`
- `api_contracts.md`
- `frontend_route_map.md`

Official shipment statuses are restricted to:

- CREATED
- WAREHOUSE_RECEIVED
- CHINA_TRANSIT
- AT_BORDER
- CUSTOMS_CLEARANCE
- MYANMAR_TRANSIT
- OUT_FOR_DELIVERY
- DELIVERED
- EXCEPTION
- RETURNED

Official tracking event codes are restricted to:

- WAREHOUSE_RECEIVE
- CHINA_DEPART
- BORDER_ARRIVE
- CUSTOMS_CLEAR
- MYANMAR_ARRIVE
- DISPATCH
- DELIVER
- EXCEPTION_REPORT

## Executive Summary

The current codebase is partially migrated toward `tracking_events`, but it is not yet contract-compliant.

Main violations:

- legacy status codes are still used across backend, database, seed data, and frontend.
- `tracking_events` exists but uses `event_type` as a status-like value instead of the frozen `event_code` dictionary.
- legacy `shipment_events` remains actively written and read.
- public tracking API exists as `/track/query`, but the frozen contract requires `/public/tracking/{tracking_no}`.
- button/action-based PDA workflows still exist.
- `shipment.status/current_status` is still directly inserted or updated in several flows instead of being purely aggregated from official tracking events.

## Detailed Violations

| File path | Violation type | Current behavior | Required contract-compliant behavior | Migration risk | Recommended fix |
|---|---|---|---|---|---|
| `backend/status.js` | Non-official status dictionary | Defines `PENDING`, `IN_CHINA_WAREHOUSE`, `IN_CHINA_TRANSIT`, `CUSTOMS`, `IN_MYANMAR`; missing `CREATED`, `WAREHOUSE_RECEIVED`, `CHINA_TRANSIT`, `MYANMAR_TRANSIT`, `RETURNED`. | Use only `logistics_status_codes.md` statuses. Transition rules must match `status_transition_rules.md`. | High. This file influences state validation across shipment APIs. | In PHASE-1B, replace dictionary with frozen statuses and map legacy statuses only at compatibility boundaries. |
| `backend/status.js` | Invalid transition rules | Allows legacy transitions such as `PENDING -> IN_CHINA_TRANSIT` and `IN_CHINA_TRANSIT -> IN_MYANMAR`. | Use frozen transitions: `CREATED -> WAREHOUSE_RECEIVED -> CHINA_TRANSIT -> AT_BORDER -> CUSTOMS_CLEARANCE -> MYANMAR_TRANSIT -> OUT_FOR_DELIVERY -> DELIVERED`, with documented exception handling. | High. Changing at once can block existing scan flows. | Introduce a migration adapter and update callers gradually. |
| `database/schema.sql` | Legacy default status | `shipments.current_status` defaults to `PENDING`. | New shipments should be represented by official lifecycle state `CREATED`, computed from events. | Medium. Existing rows may contain legacy values. | Add migration plan for legacy status normalization; do not bulk rewrite until tracking_events adoption is complete. |
| `database/schema.sql` | Legacy `shipment_events` source of truth | Defines and constrains `shipment_events` using legacy event/status values. | `tracking_events` must be the single source of truth. | High. Existing APIs still write this table. | Keep table temporarily as read-only compatibility, then stop writes in PHASE-1C. |
| `database/schema.sql` | Non-contract `tracking_events` shape | `tracking_events` uses `event_type`, `event_description`, `event_city`, and source types `MANUAL`, `SYSTEM`, `KUAIDI100`, `CAINIAO`; no official `event_code` or `resulting_status`. | Contract requires official event codes and source types `scan/system/admin` plus resulting status mapping. | High. Existing services depend on `event_type`. | Add additive columns or compatibility view in migration; route all new writes through official event codes. |
| `database/migrations/004_tracking_events_core.sql` | Non-contract tracking event migration | Creates/backfills `tracking_events` using legacy event/status values and uppercase source types. | Migration should align with official event codes and source types. | Medium. Migration may already be applied in environments. | Create new follow-up migration instead of editing applied migration. |
| `database/seed.sql` | Legacy statuses and events | Seeds `shipments` and `shipment_events` using `PENDING`, `IN_CHINA_TRANSIT`, `AT_BORDER`, `IN_MYANMAR`. | Seed data must use official statuses and official tracking event codes. | Low for dev, medium if used in staging. | Replace future seed with official tracking events after PHASE-1B. |
| `backend/services/trackingEvents.js` | Event code violation | `TRACKING_EVENT_TYPES` contains status-like values such as `PENDING`, `IN_CHINA_WAREHOUSE`, `CUSTOMS`, `IN_MYANMAR`. | Use only official event codes from `tracking_event_codes.md`. | High. This is the current aggregation core. | Convert API input from `event_type` to `event_code`; compute resulting status from frozen mapping. |
| `backend/services/trackingEvents.js` | Direct shipment status cache update with wrong source | Updates `shipments.current_status` and `shipments.status` from latest `tracking_events.event_type`. | Status cache may be updated only as aggregation from official tracking event codes/resulting statuses. | Medium. Aggregation idea is correct, but source codes are wrong. | Keep aggregation pattern, replace source dictionary and column semantics. |
| `backend/services/chinaLogistics.js` | Non-official status generation | Produces `CUSTOMS`, `IN_CHINA_TRANSIT`, `PENDING`, `IN_MYANMAR`. | Third-party sync must output official event codes and resulting official statuses. | Medium. China sync is planned/partial, but can pollute timelines. | Map carrier raw data to `CHINA_DEPART`, `BORDER_ARRIVE`, `CUSTOMS_CLEAR`, etc. |
| `backend/services/syncChina.js` | Legacy table write | Inserts into `shipment_events` during sync. | New logistics facts must be inserted into `tracking_events` only. | Medium. Existing sync compatibility may depend on shipment_events. | Dual-write only during migration with tracking_events as primary; then remove shipment_events writes. |
| `backend/routes/shipments.js` | Public API contract mismatch | Provides `GET /track/query?tracking_no=...`. | Contract requires `GET /public/tracking/{tracking_no}`. | Low if alias is added; medium if existing clients rely on old route. | Add contract route as canonical endpoint, keep `/track/query` as compatibility alias temporarily. |
| `backend/routes/shipments.js` | Non-official event dictionary | `PUBLIC_EVENT_TYPE_MAP` and `EVENT_STATUS_MAP` use values such as `CHINA_WAREHOUSE`, `BORDER_ARRIVED`, `INBOUND`, `IN_MYANMAR`. | Use official event codes and resulting status mapping from contracts. | High. Public query output and event write behavior depend on it. | Replace with frozen event code dictionary in PHASE-1B. |
| `backend/routes/shipments.js` | Legacy `shipment_events` write | Writes `shipment_events` in create, manual event, and scan/update flows. | `tracking_events` must be the only source of truth. | High. Active business flows still depend on this table. | Stop new writes after tracking_events official event-code path is stable. |
| `backend/routes/shipments.js` | Direct status creation | `POST /shipment/create` and inbound scan create rows with direct `current_status/status` values. | Create event first, aggregate shipment status from event. | High. Creation is a core flow. | Use `CREATED` or `WAREHOUSE_RECEIVE` event to initialize status. |
| `backend/routes/shipments.js` | Button/action-based workflow | `POST /shipment/:tracking_no/scan-update` maps actions such as arrived_muse, arrived_mandalay, out_for_delivery, delivered into status changes. | PDA must add official tracking events through drawer/event workflow, not status buttons. | High. This is explicitly forbidden by TASK-004 and GLOBAL_RULES. | Migrate PDA to `POST /tracking_events` with official event code selection. |
| `backend/routes/shipments.js` | API bypasses contract route set | Contract APIs `POST /tracking_events`, `POST /batches`, batch depart/arrive, and `GET /exceptions/open` are absent. | Required API contracts must exist before feature expansion. | Medium. Some modules may be planned, but contract compliance expects endpoints. | Implement incrementally after PHASE-1A audit, starting with `POST /tracking_events`. |
| `backend/index.js` | Duplicate bare route mounts | Mounts auth, shipments, and operators both at root and under `/api`. | API contract should expose a single canonical namespace. | Medium. Removing root mounts could break existing clients. | Keep temporarily; document as legacy. Add deprecation plan and route tests. |
| `frontend/src/shared/ui.jsx` | Hardcoded legacy status mapping | `STATUS_OPTIONS`, `STATUS_FLOW`, labels, and progress UI include legacy statuses. | Frontend must only display official statuses and translate official event/status codes. | Medium. UI will mislead users and operators. | Replace with frozen status dictionary and compatibility mapping only at API boundary. |
| `frontend/src/pages/PublicTrackingPage.jsx` | Public UI uses legacy lifecycle | Progress flow and event fallback use legacy statuses/event types such as `PENDING`, `IN_CHINA_WAREHOUSE`. | Consumer tracking must render official `latest_event`, `current_status`, and official timeline event codes. | Medium. Public tracking experience is contract-sensitive. | Update after API returns official event codes. |
| `frontend/src/pages/WarehousePdaPage.jsx` | Button-based PDA workflow | Uses status/action buttons and `scan-update`. | PDA must add official tracking events through drawer workflow, continuous scan, event selection. | High. This is forbidden by the frozen workflow rules. | Convert to event-driven scan workbench in PHASE-1D. |
| `frontend/src/pages/AdminOperationsPage.jsx` | Direct event/status UI | Admin event form posts `event_type` and status values such as `IN_MYANMAR`; status filters include legacy codes. | Admin must insert official tracking events; shipment status must be computed. | Medium. Admin operation can pollute data. | Change form to official `event_code` after API contract is adopted. |
| `frontend/src/i18n/*/translation.json` | Legacy status translation | Translates statuses that are not in frozen contract, including `PENDING`, `IN_CHINA_TRANSIT`, `IN_MYANMAR`. | Translation files should only expose official statuses and event codes, plus clearly marked legacy compatibility strings if needed. | Low. User-facing mismatch risk. | Move legacy labels to compatibility namespace and phase out. |

## Incremental Migration Plan

### PHASE-1B: tracking_events full adoption

Goal: make official `tracking_events` the write path for all logistics facts.

- introduce official event-code dictionary from `tracking_event_codes.md`.
- make `POST /tracking_events` the canonical event creation API.
- add or map `event_code` and `resulting_status` semantics without breaking existing rows.
- make public query timeline read official tracking events first.
- keep legacy routes as compatibility aliases only.

### PHASE-1C: legacy status removal

Goal: remove direct status mutation and legacy status values from active code paths.

- stop writing `shipment_events` in normal business flows.
- stop accepting legacy statuses in public/admin UI.
- replace `PENDING`, `IN_CHINA_TRANSIT`, `IN_MYANMAR`, `CUSTOMS`, and `IN_CHINA_WAREHOUSE` with official status values.
- keep read-only compatibility for old records until data migration is complete.

### PHASE-1D: event-driven PDA workflow

Goal: replace button-based scan/status workflow with JD/SF-style event capture.

- scan tracking number.
- identify carrier.
- choose or infer city/node.
- choose official event code.
- submit tracking event.
- aggregate shipment status automatically.
- show scan history and duplicate detection based on event identity, not status buttons.

### PHASE-1E: batch lifecycle integration

Goal: integrate batch lifecycle without bypassing tracking_events.

- create batch records according to contract.
- assign shipments to batches.
- batch depart/arrive APIs generate official tracking events for affected shipments.
- manifest/reporting reads from batch and tracking event data.

## Conclusion

The current system is usable as a transitional MVP, but it violates the frozen contracts in several core places. The safest next move is not a rewrite. The safest move is to introduce the official tracking event write path first, then gradually retire legacy status and `shipment_events` writes.
