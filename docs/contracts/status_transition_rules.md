# Status Transition Rules

This document freezes allowed shipment lifecycle transitions for HX MM.

Any transition not listed here is forbidden. Future development must validate status changes by inserting valid tracking events, not by directly mutating shipment status.

## Normal Route Transitions

| current_status | allowed_next_statuses |
|---|---|
| CREATED | WAREHOUSE_RECEIVED, EXCEPTION |
| WAREHOUSE_RECEIVED | CHINA_TRANSIT, EXCEPTION |
| CHINA_TRANSIT | AT_BORDER, EXCEPTION |
| AT_BORDER | CUSTOMS_CLEARANCE, EXCEPTION |
| CUSTOMS_CLEARANCE | MYANMAR_TRANSIT, EXCEPTION |
| MYANMAR_TRANSIT | OUT_FOR_DELIVERY, EXCEPTION |
| OUT_FOR_DELIVERY | DELIVERED, EXCEPTION |
| DELIVERED | None |
| EXCEPTION | CREATED, WAREHOUSE_RECEIVED, CHINA_TRANSIT, AT_BORDER, CUSTOMS_CLEARANCE, MYANMAR_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, RETURNED |
| RETURNED | None |

## Canonical Path

CREATED -> WAREHOUSE_RECEIVED -> CHINA_TRANSIT -> AT_BORDER -> CUSTOMS_CLEARANCE -> MYANMAR_TRANSIT -> OUT_FOR_DELIVERY -> DELIVERED

## Exception Rules

- `EXCEPTION` may be entered from any non-terminal status.
- `EXCEPTION` may recover to a valid operational status only when a corrective tracking event is inserted and audit context exists.
- `EXCEPTION` may resolve to `RETURNED` when the parcel is confirmed returned.
- `DELIVERED` and `RETURNED` are terminal statuses and cannot transition to any other status.

## Forbidden Examples

| forbidden_transition | reason |
|---|---|
| DELIVERED -> OUT_FOR_DELIVERY | Delivered is terminal. |
| DELIVERED -> MYANMAR_TRANSIT | Delivered is terminal. |
| RETURNED -> CHINA_TRANSIT | Returned is terminal. |
| CREATED -> DELIVERED | Missing required logistics lifecycle events. |
| WAREHOUSE_RECEIVED -> MYANMAR_TRANSIT | Missing China transit, border, and customs events. |

## Event-Driven Enforcement

- A transition must be caused by a valid tracking event code from `tracking_event_codes.md`.
- The resulting status of the event must match an allowed next status from this document.
- Application code must not directly set shipment status independently of a tracking event.

## Related Contracts

- `logistics_status_codes.md`
- `tracking_event_codes.md`
- `workflow_lifecycle.md`
- `GLOBAL_RULES.md`
