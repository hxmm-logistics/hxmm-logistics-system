# Database Dictionary

This document freezes HX MM core data tables for the event-driven logistics lifecycle baseline.

The tables below define the production contract. Do not add demo fields. Future schema changes must update this document first.

## Table: shipments

Purpose: one parcel/shipment tracked by public `tracking_no` and internally linked to operational records.

| field | type | nullable | purpose | index requirement |
|---|---|---|---|---|
| id | integer | no | Primary internal identifier. | Primary key |
| hx_no | string | no | HX MM internal shipment number for operations/accounting. Not public query key. | Unique or indexed |
| tracking_no | string | no | Public carrier tracking number. Public tracking key. | Unique index |
| carrier_code | string | yes | Detected or selected carrier code. | Indexed when used for filtering |
| carrier_name | string | yes | Carrier display name. | None |
| status | string | no | Aggregated cache computed from latest valid tracking event. | Indexed |
| current_city | string | yes | Aggregated display city/node from latest tracking event. | None |
| latest_event_id | integer | yes | Latest tracking event used for status aggregation. | Foreign key/index |
| batch_id | integer | yes | Current shipment batch membership. | Indexed |
| warehouse_id | integer | yes | Current or receiving warehouse. | Indexed |
| sender_address | text | yes | Sender detailed address. | None |
| receiver_address | text | yes | Receiver detailed address. | None |
| receiver_phone | string | yes | Receiver phone number. | None |
| estimated_delivery | timestamp | yes | Estimated delivery time or date when available. | None |
| inbound_at | timestamp | yes | Warehouse receive time. | Indexed when used for operations dashboard |
| delivered_at | timestamp | yes | Delivery confirmation time. | Indexed when used for reporting |
| created_at | timestamp | no | Record creation time. | Indexed |
| updated_at | timestamp | no | Last cache or record update time. | Indexed |

## Table: tracking_events

Purpose: source of truth for all logistics lifecycle movement and public timeline.

| field | type | nullable | purpose | index requirement |
|---|---|---|---|---|
| id | integer | no | Primary event identifier. | Primary key |
| shipment_id | integer | no | Shipment receiving the event. | Foreign key; composite index with event_time |
| event_code | string | no | Official event code from `tracking_event_codes.md`. | Indexed |
| resulting_status | string | no | Official status produced by this event. | Indexed |
| event_time | timestamp | no | Real logistics event time. | Composite index with shipment_id |
| event_city | string | no | City, warehouse, border point, or delivery node. | Indexed when used for operations reports |
| event_description | text | no | Human-readable logistics timeline text. | None |
| operator_id | integer | yes | User/operator who created the event, when applicable. | Foreign key/index |
| source_type | string | no | One of scan, system, admin. | Indexed |
| external_payload | json | yes | Raw provider payload or device metadata when needed. | None or JSON index if later required |
| created_at | timestamp | no | Database creation time. | Indexed when used for audit |

## Table: batches

Purpose: batch/manifest container for cross-border trucking or transfer operations.

| field | type | nullable | purpose | index requirement |
|---|---|---|---|---|
| id | integer | no | Primary batch identifier. | Primary key |
| batch_no | string | no | Human-readable batch/manifest number. | Unique index |
| route_id | integer | no | Route used by this batch. | Foreign key/index |
| origin_warehouse_id | integer | no | Departure warehouse. | Foreign key/index |
| destination_warehouse_id | integer | yes | Destination warehouse or branch. | Foreign key/index |
| driver_name | string | yes | Driver name. | None |
| driver_phone | string | yes | Driver phone. | None |
| vehicle_no | string | yes | Truck or vehicle plate number. | Indexed when searched |
| status | string | no | Batch operational status. | Indexed |
| departed_at | timestamp | yes | Batch departure time. | Indexed |
| arrived_at | timestamp | yes | Batch arrival time. | Indexed |
| created_by | integer | no | Admin/operator who created batch. | Foreign key/index |
| created_at | timestamp | no | Batch creation time. | Indexed |
| updated_at | timestamp | no | Last update time. | Indexed |

## Table: batch_shipments

Purpose: join table between batches and shipments.

| field | type | nullable | purpose | index requirement |
|---|---|---|---|---|
| id | integer | no | Primary join record identifier. | Primary key |
| batch_id | integer | no | Batch identifier. | Foreign key; composite unique with shipment_id |
| shipment_id | integer | no | Shipment identifier. | Foreign key; composite unique with batch_id |
| scanned_by | integer | yes | Operator who assigned/scanned the shipment into the batch. | Foreign key/index |
| scanned_at | timestamp | no | Assignment scan time. | Indexed |
| removed_at | timestamp | yes | Removal time if shipment is removed from batch. | Indexed when used |

## Table: warehouses

Purpose: warehouse, branch, or logistics node configuration.

| field | type | nullable | purpose | index requirement |
|---|---|---|---|---|
| id | integer | no | Primary warehouse identifier. | Primary key |
| warehouse_code | string | no | Unique warehouse code. | Unique index |
| warehouse_name | string | no | Display name. | Indexed |
| country | string | no | China or Myanmar. | Indexed |
| state | string | yes | State/region. | Indexed if used for filtering |
| city | string | no | City. | Indexed |
| township | string | yes | Township. | Indexed if used for filtering |
| address | text | yes | Detailed address. | None |
| contact_phone | string | yes | Contact phone. | None |
| is_active | boolean | no | Whether warehouse is usable. | Indexed |
| created_at | timestamp | no | Creation time. | None |

## Table: routes

Purpose: logistics route configuration, especially China to Myanmar lanes.

| field | type | nullable | purpose | index requirement |
|---|---|---|---|---|
| id | integer | no | Primary route identifier. | Primary key |
| route_code | string | no | Unique route code. | Unique index |
| route_name | string | no | Display route name. | Indexed |
| origin_city | string | no | Route origin city. | Indexed |
| border_city | string | yes | Border node or city. | Indexed |
| destination_city | string | no | Route destination city. | Indexed |
| estimated_days | integer | yes | Expected transit days. | None |
| is_active | boolean | no | Whether route is active. | Indexed |
| created_at | timestamp | no | Creation time. | None |

## Table: exceptions

Purpose: structured exception queue for unresolved logistics problems.

| field | type | nullable | purpose | index requirement |
|---|---|---|---|---|
| id | integer | no | Primary exception identifier. | Primary key |
| shipment_id | integer | no | Related shipment. | Foreign key/index |
| tracking_event_id | integer | yes | Event that caused the exception. | Foreign key/index |
| exception_type | string | no | Controlled exception category. | Indexed |
| description | text | no | Operator/system explanation. | None |
| status | string | no | Open, processing, resolved, returned. | Indexed |
| assigned_to | integer | yes | User responsible for resolution. | Foreign key/index |
| resolved_at | timestamp | yes | Resolution time. | Indexed when used for reporting |
| created_at | timestamp | no | Creation time. | Indexed |
| updated_at | timestamp | no | Last update time. | Indexed |

## Table: users

Purpose: authenticated internal users for admin and warehouse/PDA operations.

| field | type | nullable | purpose | index requirement |
|---|---|---|---|---|
| id | integer | no | Primary user identifier. | Primary key |
| username | string | no | Login name. | Unique index |
| password_hash | string | no | Hashed password only. Never plaintext. | None |
| role | string | no | User role such as admin or operator. | Indexed |
| display_name | string | no | Human-readable name. | None |
| operator_id | integer | yes | Linked operator profile if present. | Foreign key/index |
| is_active | boolean | no | Whether login is allowed. | Indexed |
| last_login_at | timestamp | yes | Last successful login time. | None |
| created_at | timestamp | no | Creation time. | None |
| updated_at | timestamp | no | Last update time. | None |

## Contract Notes

- Public query must use `shipments.tracking_no`, not `hx_no`.
- `tracking_events` is the source of truth for logistics lifecycle.
- `shipments.status` is an aggregated cache.
- Batch and manifest features must use `batches` and `batch_shipments`, not ad hoc fields.
- Address structure must support Myanmar nationwide regions through warehouse/route/address fields.

## Related Contracts

- `logistics_status_codes.md`
- `tracking_event_codes.md`
- `api_contracts.md`
- `workflow_lifecycle.md`
- `GLOBAL_RULES.md`
