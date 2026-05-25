# Workflow Lifecycle

This document freezes the HX MM logistics lifecycle architecture.

The system is event-driven. `tracking_events` is the only source of truth for shipment lifecycle movement.

## Lifecycle Overview

Shipment lifecycle:

CREATED -> WAREHOUSE_RECEIVED -> CHINA_TRANSIT -> AT_BORDER -> CUSTOMS_CLEARANCE -> MYANMAR_TRANSIT -> OUT_FOR_DELIVERY -> DELIVERED

Exception lifecycle:

Any non-terminal status -> EXCEPTION -> recovery status or RETURNED

Terminal statuses:

- DELIVERED
- RETURNED

## Text Architecture Diagram

1. Public or internal shipment record exists in `shipments`.
2. Warehouse, system, or admin workflow inserts a valid `tracking_events` record.
3. The event code maps to exactly one resulting shipment status.
4. The status transition is validated against `status_transition_rules.md`.
5. The latest valid tracking event becomes the basis for aggregated shipment fields.
6. `shipments.status`, `shipments.current_city`, and related display cache fields are updated by aggregation only.
7. Public tracking reads shipment summary plus newest-first tracking events.

## State Diagram

CREATED
  -> WAREHOUSE_RECEIVED
  -> CHINA_TRANSIT
  -> AT_BORDER
  -> CUSTOMS_CLEARANCE
  -> MYANMAR_TRANSIT
  -> OUT_FOR_DELIVERY
  -> DELIVERED

Any non-terminal status
  -> EXCEPTION
  -> CREATED / WAREHOUSE_RECEIVED / CHINA_TRANSIT / AT_BORDER / CUSTOMS_CLEARANCE / MYANMAR_TRANSIT / OUT_FOR_DELIVERY / DELIVERED / RETURNED

RETURNED
  -> terminal

DELIVERED
  -> terminal

## Event-to-Lifecycle Mapping

| tracking_event_code | resulting_status |
|---|---|
| WAREHOUSE_RECEIVE | WAREHOUSE_RECEIVED |
| CHINA_DEPART | CHINA_TRANSIT |
| BORDER_ARRIVE | AT_BORDER |
| CUSTOMS_CLEAR | CUSTOMS_CLEARANCE |
| MYANMAR_ARRIVE | MYANMAR_TRANSIT |
| DISPATCH | OUT_FOR_DELIVERY |
| DELIVER | DELIVERED |
| EXCEPTION_REPORT | EXCEPTION |

## Source of Truth Rules

- `tracking_events` is the only true logistics history.
- Public timeline must be generated from `tracking_events`.
- Admin detail timeline must be generated from `tracking_events`.
- Batch departure/arrival must create `tracking_events` for affected shipments.
- Third-party carrier sync must create `tracking_events`, not directly update shipment status.

## Aggregated Shipment Fields

The following fields are derived/cache fields and must not be manually edited as workflow actions:

| field | aggregation source |
|---|---|
| shipments.status | latest valid tracking event resulting status |
| shipments.current_city | latest valid tracking event city |
| shipments.latest_event_id | latest valid tracking event id |
| shipments.updated_at | latest aggregation/update timestamp |
| shipments.delivered_at | first valid delivery event time |

## Forbidden Workflow Patterns

- Direct assignment such as shipment.status = DELIVERED.
- Button-based status update that bypasses event creation.
- Fake timeline generation from shipment status alone.
- Public query by HX internal number.
- Admin and public tracking state sharing that causes mixed screens.

## Related Contracts

- `logistics_status_codes.md`
- `tracking_event_codes.md`
- `status_transition_rules.md`
- `database_dictionary.md`
- `GLOBAL_RULES.md`
