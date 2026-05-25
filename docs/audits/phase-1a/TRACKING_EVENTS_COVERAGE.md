# HX MM PHASE-1A Tracking Events Coverage

Audit date: 2026-05-24
Contract rule: all logistics workflows must be event-driven, and `tracking_events` must be the single source of truth.

## Coverage Matrix

| Workflow/API | Uses tracking_events? | Contract compliant? | Current behavior | Required behavior | Migration risk | Recommended fix |
|---|---:|---:|---|---|---|---|
| Public query `GET /track/query` | Yes, partial | No | Reads timeline from tracking events where available, but endpoint path is non-contract and data uses legacy event/status vocabulary. | Canonical `GET /public/tracking/{tracking_no}` returns shipment, latest official event, timeline, current city, estimate, and carrier. | Medium | Add contract endpoint and adapt `/track/query` as legacy alias. |
| Shipment detail `GET /shipment/:tracking_no` | Yes, partial | No | Returns shipment and tracking events but also exposes legacy shipment semantics. | Protected/internal route may read official events; public tracking must not expose internal HX logic. | Medium | Separate public query payload from internal shipment detail payload. |
| Shipment creation `POST /shipment/create` | Yes, partial | No | Creates shipment and writes transitional tracking event, but also directly sets legacy status and writes `shipment_events`. | Creation must create official initial tracking event and aggregate status. | High | Wrap old endpoint around official event creation in PHASE-1B. |
| Manual event `POST /shipment/:tracking_no/event` | Yes, partial | No | Accepts `event_type`, writes `shipment_events`, creates tracking event from legacy value. | Supersede with `POST /tracking_events` accepting official `event_code`. | High | Add new endpoint; mark old endpoint legacy. |
| Scan update `POST /shipment/:tracking_no/scan-update` | Yes, partial | No | Button/action workflow maps action to status/event values. | PDA scan must create official tracking event after drawer workflow. | High | Replace in PHASE-1D. |
| Inbound scan `POST /shipments/inbound-scan` | Yes, partial | No | Auto-creates shipment and tracking event using transitional status/event values. | Create shipment and `WAREHOUSE_RECEIVE` event; status becomes `WAREHOUSE_RECEIVED`. | High | Migrate to official event-code model first. |
| China sync service | Yes, partial | No | Converts raw statuses to legacy statuses and writes legacy `shipment_events`. | Convert raw carrier facts to official tracking events. | Medium | Replace status mapping with event-code mapping. |
| Admin shipment list `GET /admin/shipments` | Read-only | Partial | Reads shipment cache fields and legacy statuses. | Admin list may read aggregated status cache produced by official events. | Low | Update after aggregation uses official statuses. |
| Admin logs `GET /admin/shipments/:tracking_no/logs` | No direct event-source guarantee | Partial | Returns operation/status logs, not official tracking timeline only. | Operational logs can exist, but logistics timeline must come from tracking_events. | Low | Keep operational logs separate from logistics timeline. |
| Batch create `POST /batches` | No | No | Missing. | Must follow API contract. | Medium | Implement in PHASE-1E after tracking event contract is stable. |
| Batch depart `POST /batches/{batch_id}/depart` | No | No | Missing. | Must generate official tracking events for affected shipments. | Medium | Implement in PHASE-1E. |
| Batch arrive `POST /batches/{batch_id}/arrive` | No | No | Missing. | Must generate official tracking events for affected shipments. | Medium | Implement in PHASE-1E. |
| Exceptions `GET /exceptions/open` | No | No | Missing. | Must follow API contract and read official exception status/event data. | Medium | Implement after event/status contract is adopted. |

## Tracking Event Schema Coverage

| Contract field | Current support | Gap |
|---|---:|---|
| `event_time` | Yes | Present. |
| `event_code` | No | Current field is `event_type`; values are not official event codes. |
| `event_description` | Yes | Present as description/remark compatibility. |
| `event_city` | Yes | Present in tracking_events service. |
| `operator_id` | Partial | Present in contract intent, but current code also uses `created_by`/operator compatibility. |
| `source_type` | No | Current values are uppercase external/source names, not contract `scan/system/admin`. |
| `external_payload` | Yes, partial | Present in tracking_events migration/service. |
| `resulting_status` | No | Current system infers status from `event_type`; no official resulting-status field. |

## Tracking Event Read Coverage

- Public tracking reads timeline data, but still renders event/status compatibility fields.
- Admin and shipment detail pages render legacy `event_type` and status labels.
- PDA workflow writes events but via forbidden action buttons.
- No single canonical tracking event API currently matches `api_contracts.md`.

## Recommended Coverage Target for PHASE-1B

1. Make official tracking event creation possible through `POST /tracking_events`.
2. Normalize event writes to official event codes.
3. Aggregate shipment status from official resulting status.
4. Make public query read only official timeline data.
5. Keep legacy routes operational but internally route them through official event creation where possible.
