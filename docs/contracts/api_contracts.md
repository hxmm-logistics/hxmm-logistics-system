# API Contracts

This document freezes the baseline HX MM API contracts for event-driven logistics workflows.

All future APIs must follow the patterns and field names here unless this contract is updated first.

## Global API Rules

- Public tracking uses `tracking_no` only.
- Internal HX numbers must never be accepted as public query identifiers.
- Shipment lifecycle changes must be created through tracking events.
- Direct shipment status mutation is forbidden.
- Authenticated APIs must use JWT bearer authentication unless explicitly public.
- Responses must be stable JSON objects with predictable field names.

## GET /public/tracking/{tracking_no}

Purpose: public consumer tracking query.

Authentication: not required.

Path parameters:

| field | type | required | description |
|---|---|---|---|
| tracking_no | string | yes | Public carrier tracking number. HX internal numbers are forbidden. |

Success response fields:

| field | type | required | description |
|---|---|---|---|
| success | boolean | yes | Indicates query success. |
| shipment | object | yes | Public shipment summary. |
| carrier | object | yes | Carrier code and name. |
| latest_event | object or null | yes | Latest tracking event. |
| timeline | array | yes | Newest-first public timeline. |
| current_city | string or null | yes | City/node from latest event. |
| estimated_delivery | string or timestamp or null | yes | Estimated delivery display value. |

Shipment object fields:

| field | type | required | description |
|---|---|---|---|
| tracking_no | string | yes | Public tracking number. |
| current_status | string | yes | Aggregated status from latest event. |
| current_city | string or null | yes | Latest event city/node. |
| updated_at | timestamp | yes | Last public update time. |

Error responses:

| status | meaning |
|---|---|
| 400 | Missing or invalid tracking number. |
| 404 | Shipment not found, including HX internal number input. |
| 500 | Unexpected server error. |

## POST /tracking_events

Purpose: insert a logistics tracking event and aggregate shipment status.

Authentication: required.

Request body fields:

| field | type | required | description |
|---|---|---|---|
| tracking_no | string | yes | Public tracking number of the shipment. |
| event_code | string | yes | Official event code from `tracking_event_codes.md`. |
| event_time | timestamp | no | Real logistics event time. Defaults to server time if omitted. |
| event_city | string | yes | City, warehouse, border point, or delivery node. |
| event_description | string | yes | User-facing timeline description. |
| source_type | string | yes | scan, system, or admin. |
| external_payload | object | no | Provider/device metadata when applicable. |

Success response fields:

| field | type | required | description |
|---|---|---|---|
| success | boolean | yes | Indicates event creation success. |
| tracking_event | object | yes | Created tracking event. |
| shipment | object | yes | Shipment after status aggregation. |

Error responses:

| status | meaning |
|---|---|
| 400 | Invalid event code or missing required field. |
| 401 | Authentication required. |
| 404 | Shipment not found. |
| 409 | Status transition is not allowed. |

## POST /batches

Purpose: create a cross-border shipment batch/manifest.

Authentication: required; admin or authorized operations role.

Request body fields:

| field | type | required | description |
|---|---|---|---|
| route_id | integer | yes | Route used by the batch. |
| origin_warehouse_id | integer | yes | Departure warehouse. |
| destination_warehouse_id | integer | no | Destination warehouse/branch. |
| driver_name | string | no | Driver name. |
| driver_phone | string | no | Driver phone. |
| vehicle_no | string | no | Truck or vehicle number. |
| shipment_ids | array | no | Initial shipment IDs to assign. |

Success response fields:

| field | type | required | description |
|---|---|---|---|
| success | boolean | yes | Indicates batch creation success. |
| batch | object | yes | Created batch. |
| shipments | array | yes | Assigned shipments. |

## POST /batches/{batch_id}/depart

Purpose: mark a batch as departed and create shipment tracking events for assigned shipments.

Authentication: required; admin or authorized operations role.

Path parameters:

| field | type | required | description |
|---|---|---|---|
| batch_id | integer | yes | Batch identifier. |

Request body fields:

| field | type | required | description |
|---|---|---|---|
| departed_at | timestamp | no | Departure time. Defaults to server time if omitted. |
| event_city | string | yes | Departure city or warehouse. |
| event_description | string | no | Timeline text. Defaults to China departure wording. |

Success response fields:

| field | type | required | description |
|---|---|---|---|
| success | boolean | yes | Indicates departure success. |
| batch | object | yes | Updated batch. |
| tracking_events_created | integer | yes | Number of shipment events created. |

Resulting event:

| event_code | resulting_status |
|---|---|
| CHINA_DEPART | CHINA_TRANSIT |

## POST /batches/{batch_id}/arrive

Purpose: mark a batch as arrived and create shipment tracking events for assigned shipments.

Authentication: required; admin or authorized operations role.

Path parameters:

| field | type | required | description |
|---|---|---|---|
| batch_id | integer | yes | Batch identifier. |

Request body fields:

| field | type | required | description |
|---|---|---|---|
| arrived_at | timestamp | no | Arrival time. Defaults to server time if omitted. |
| event_city | string | yes | Arrival city, branch, border node, or warehouse. |
| event_code | string | yes | BORDER_ARRIVE, CUSTOMS_CLEAR, or MYANMAR_ARRIVE depending on route stage. |
| event_description | string | no | Timeline text. |

Success response fields:

| field | type | required | description |
|---|---|---|---|
| success | boolean | yes | Indicates arrival success. |
| batch | object | yes | Updated batch. |
| tracking_events_created | integer | yes | Number of shipment events created. |

## GET /exceptions/open

Purpose: list unresolved logistics exceptions.

Authentication: required; admin or authorized operations role.

Query parameters:

| field | type | required | description |
|---|---|---|---|
| city | string | no | Filter by current city. |
| assigned_to | integer | no | Filter by assignee. |
| limit | integer | no | Page size. |
| cursor | string | no | Pagination cursor. |

Success response fields:

| field | type | required | description |
|---|---|---|---|
| success | boolean | yes | Indicates query success. |
| exceptions | array | yes | Open exception records. |
| next_cursor | string or null | yes | Pagination cursor. |

## Related Contracts

- `database_dictionary.md`
- `tracking_event_codes.md`
- `frontend_route_map.md`
- `GLOBAL_RULES.md`
