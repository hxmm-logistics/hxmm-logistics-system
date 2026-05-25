# HX MM PHASE-1A Legacy Modules

Audit date: 2026-05-24
Scope: modules that still reflect pre-contract or transitional logic.

## Legacy Classification

| Module | Legacy behavior | Contract risk | Migration priority | Recommended migration path |
|---|---|---|---|---|
| `backend/status.js` | Legacy status dictionary and transition validator. | Blocks adoption of frozen lifecycle and permits non-contract transitions. | P0 | Replace with contract status dictionary in PHASE-1B, with compatibility mapping for old rows. |
| `backend/routes/shipments.js` | Mixed public tracking, shipment creation, manual event creation, scan-update, admin queries, legacy compatibility. | Bypasses clean API contracts and contains direct status/event mutation paths. | P0 | Split behavior by route purpose without architectural rewrite: public tracking, tracking event creation, admin compatibility. |
| `backend/services/trackingEvents.js` | Transitional tracking_events service uses status-like `event_type` values. | Looks event-driven but does not follow official event-code contract. | P0 | Convert service to official `event_code -> resulting_status` aggregation. |
| `backend/services/chinaLogistics.js` | Carrier sync maps raw states to legacy statuses. | External sync can create non-contract timeline facts. | P1 | Map raw carrier statuses into official event codes. |
| `backend/services/syncChina.js` | Writes legacy `shipment_events` and transitional tracking events. | Keeps legacy table active as source of truth. | P1 | Make `tracking_events` primary; stop legacy writes after compatibility window. |
| `database/schema.sql` | Contains legacy `shipment_events`, legacy status defaults/checks, non-contract tracking_events shape. | Database does not match frozen dictionary. | P0 | Add forward migration; do not destructively edit existing schema for deployed DB. |
| `database/migrations/003_tracking_query_and_inbound.sql` | Introduced tracking query/inbound fields with transitional status assumptions. | May contain public query and scan behavior that predates contract freeze. | P1 | Supersede with contract migration rather than editing historical migration. |
| `database/migrations/004_tracking_events_core.sql` | Introduced `tracking_events` using `event_type` and legacy source types. | Event store shape conflicts with frozen event-code contract. | P0 | Add migration for official event-code fields/constraints or compatibility view. |
| `database/seed.sql` | Seeds legacy statuses and `shipment_events`. | New environments start with non-contract data. | P1 | Replace seed with official tracking events after service migration. |
| `frontend/src/main.jsx` | Route shell includes `/dashboard` redirect compatibility. | `/dashboard` is not in frozen route map. | P2 | Keep as temporary redirect or document in route map if retained. |
| `frontend/src/shared/ui.jsx` | Shared UI contains legacy status labels, progress flow, timeline fallback. | Public/admin/PDA pages inherit legacy status thinking. | P0 | Replace with contract dictionaries and isolate compatibility labels. |
| `frontend/src/pages/PublicTrackingPage.jsx` | Public tracking renders legacy progress/status flow. | Consumer page can expose internal transitional lifecycle. | P0 | Render official `latest_event`, `current_status`, and official timeline only. |
| `frontend/src/pages/WarehousePdaPage.jsx` | Button-based scan action workflow remains. | Directly violates no button-based status workflow rule. | P0 | Convert to drawer-based official event submission. |
| `frontend/src/pages/AdminOperationsPage.jsx` | Admin can create legacy event/status values. | Admin operations can create non-contract data. | P0 | Replace admin event form with official `event_code` creation. |
| `frontend/src/i18n/zh/translation.json` | Contains legacy status/event translations. | User-facing labels drift from contract. | P2 | Move to official dictionaries after backend returns official codes. |
| `frontend/src/i18n/en/translation.json` | Contains legacy status/event translations. | User-facing labels drift from contract. | P2 | Move to official dictionaries after backend returns official codes. |
| `frontend/src/i18n/my/translation.json` | Contains legacy status/event translations. | User-facing labels drift from contract. | P2 | Move to official dictionaries after backend returns official codes. |

## Legacy Module Boundaries

These modules should be treated as compatibility layers until migration is complete:

- `shipment_events` table.
- `/shipment/:tracking_no/event` API.
- `/shipment/:tracking_no/scan-update` API.
- `/track/query` API.
- `/dashboard` frontend route redirect.
- frontend legacy status labels in `shared/ui.jsx` and i18n files.

## What Is Not Legacy

The following direction is aligned with the contract, but still needs correction:

- having a `tracking_events` module is correct.
- aggregating shipment status from tracking events is correct.
- separating `/track`, `/scan`, and `/admin` frontend modules is correct.
- keeping backward compatibility during migration is acceptable.

## Recommended Order

1. Freeze old API behavior with tests and mark legacy routes.
2. Correct `tracking_events` event-code semantics.
3. Route all new writes through official tracking events.
4. Convert public tracking UI to official event/status rendering.
5. Convert PDA/admin write flows.
6. Stop legacy `shipment_events` writes.
