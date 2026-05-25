# HX MM PHASE-1A Route Compliance Report

Audit date: 2026-05-24
Scope: frontend route map and API contract compliance.

## Frontend Route Map Compliance

Frozen route map from `docs/contracts/frontend_route_map.md`:

| Route | Required purpose | Requires login | Current status | Compliance |
|---|---|---:|---|---|
| `/` | Public tracking landing | No | Present and renders public tracking module. | Compliant |
| `/track` | Public tracking page | No | Present. | Compliant |
| `/tracking` | Alias for public tracking | No | Present. | Compliant |
| `/scan` | Warehouse PDA | Yes | Present and protected by auth. | Partially compliant; workflow still button/status based. |
| `/admin` | Admin operations backend | Yes, admin role | Present and protected by admin role. | Mostly compliant; UI still contains legacy status/event controls. |
| `/login` | Login page | No | Present. | Compliant |
| `/shipment/:tracking_no` | Internal shipment detail | Yes | Present and protected. | Compliant at frontend route level. |
| `/dashboard` | Not listed in frozen contract | N/A | Present as compatibility redirect to `/admin`. | Legacy route; should be documented or removed after migration. |

## Frontend Architecture Observations

- Public, PDA, admin, login, and shipment detail are split into separate page modules.
- Route separation is directionally compliant with TASK-003A.
- Shared UI still leaks legacy status dictionaries into all modules through `frontend/src/shared/ui.jsx`.
- PDA route exists but still violates workflow contract because it uses status/action buttons.

## API Contract Compliance

Frozen API contracts require at least:

- `GET /public/tracking/{tracking_no}`
- `POST /tracking_events`
- `POST /batches`
- `POST /batches/{batch_id}/depart`
- `POST /batches/{batch_id}/arrive`
- `GET /exceptions/open`

Current API routes found:

| Current route | Method | Contract status | Notes |
|---|---|---|---|
| `/auth/login` and `/api/auth/login` | POST | Existing non-contract auth route | Auth route is necessary operationally, but duplicated root mount should be treated as legacy. |
| `/auth/me` and `/api/auth/me` | GET | Existing non-contract auth route | Same duplicate mount issue. |
| `/track/query` and `/api/track/query` | GET | Non-compliant path | Should be `/public/tracking/{tracking_no}`. |
| `/shipment/create` and `/api/shipment/create` | POST | Legacy compatibility route | Creates shipment and status/event data outside official API contract. |
| `/shipment/:tracking_no` and `/api/shipment/:tracking_no` | GET | Legacy/internal route | Frontend internal detail exists, but API is also exposed publicly through root and `/api`. |
| `/shipment/:tracking_no/event` and `/api/shipment/:tracking_no/event` | POST | Non-compliant event API | Should be replaced by `POST /tracking_events`. |
| `/shipment/:tracking_no/scan-update` and `/api/shipment/:tracking_no/scan-update` | POST | Non-compliant PDA API | Button/action workflow violates event-driven PDA rule. |
| `/shipments/inbound-scan` and `/api/shipments/inbound-scan` | POST | Transitional scan API | Could be migrated into official `POST /tracking_events` plus shipment auto-create. |
| `/admin/shipments` and `/api/admin/shipments` | GET | Operational route, not in frozen minimum contract | Allowed as admin extension if it does not bypass event model. |
| `/admin/shipments/:tracking_no/logs` and `/api/admin/shipments/:tracking_no/logs` | GET | Operational route, not in frozen minimum contract | Should remain separate from logistics timeline. |
| `/admin/operators/create` and `/api/admin/operators/create` | POST | Operational route, not in frozen minimum contract | Admin-only extension; should remain role guarded. |
| `/admin/operators/disable` and `/api/admin/operators/disable` | POST | Operational route, not in frozen minimum contract | Admin-only extension; should remain role guarded. |
| `/admin/operators/reset-password` and `/api/admin/operators/reset-password` | POST | Operational route, not in frozen minimum contract | Admin-only extension; should remain role guarded. |
| `/admin/operators/change-password` and `/api/admin/operators/change-password` | POST | Operational route, not in frozen minimum contract | Admin-only extension; should remain role guarded. |

## Missing Contract APIs

| Required API | Current status | Migration risk | Recommended fix |
|---|---|---|---|
| `GET /public/tracking/{tracking_no}` | Missing | Low | Add canonical route; keep `/track/query` as alias temporarily. |
| `POST /tracking_events` | Missing | High | Add as canonical event write path in PHASE-1B. |
| `POST /batches` | Missing | Medium | Implement in PHASE-1E. |
| `POST /batches/{batch_id}/depart` | Missing | Medium | Implement in PHASE-1E and generate tracking events. |
| `POST /batches/{batch_id}/arrive` | Missing | Medium | Implement in PHASE-1E and generate tracking events. |
| `GET /exceptions/open` | Missing | Medium | Implement after official exception event/status path exists. |

## Route Mounting Violation

| File path | Violation type | Current behavior | Required contract-compliant behavior | Migration risk | Recommended fix |
|---|---|---|---|---|---|
| `backend/index.js` | Duplicate root and `/api` mounts | Routers are mounted both at root and under `/api`, exposing duplicate route surfaces. | Production API should have one canonical route surface, with any legacy aliases documented. | Medium. Existing clients may use either path. | Keep during compatibility period, but mark root mounts legacy and add deprecation path. |

## Route Compliance Conclusion

Frontend route separation is mostly aligned with the frozen map, with one legacy `/dashboard` redirect and legacy shared status dictionaries. Backend API compliance is the larger gap: the contract API surface is mostly missing or represented by legacy routes using old event/status semantics.
