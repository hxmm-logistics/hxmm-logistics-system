# Tracking Event Codes

This document freezes the official HX MM tracking event codes.

Only the tracking event codes listed here are valid. Future development must not invent random free-text event codes.

## Official Event Codes

| event_code | event_name | description | source_type | resulting_status |
|---|---|---|---|---|
| WAREHOUSE_RECEIVE | 仓库收货 / Warehouse receive | Warehouse staff scans or confirms that the parcel has been physically received in the China warehouse. | scan | WAREHOUSE_RECEIVED |
| CHINA_DEPART | 中国发车 / China depart | Parcel departs China warehouse or China transfer point toward the border route. | scan / system | CHINA_TRANSIT |
| BORDER_ARRIVE | 到达边境 / Border arrive | Parcel arrives at a border node such as Ruili, Qingshuihe, Muse, or configured checkpoint. | scan / system | AT_BORDER |
| CUSTOMS_CLEAR | 清关 / Customs clear | Parcel enters or completes customs/cross-border clearance processing. | scan / system / admin | CUSTOMS_CLEARANCE |
| MYANMAR_ARRIVE | 到达缅甸 / Myanmar arrive | Parcel is received by Myanmar-side logistics or arrives at a Myanmar branch/city node. | scan | MYANMAR_TRANSIT |
| DISPATCH | 派送 / Dispatch | Parcel is dispatched for last-mile delivery. | scan | OUT_FOR_DELIVERY |
| DELIVER | 签收 / Deliver | Parcel is delivered and signed for or otherwise confirmed as delivered. | scan | DELIVERED |
| EXCEPTION_REPORT | 异常上报 / Exception report | Operator, system, or admin reports a logistics exception. | scan / system / admin | EXCEPTION |

## Source Type Definitions

| source_type | meaning |
|---|---|
| scan | Event is created by warehouse/PDA/mobile scanning workflow. |
| system | Event is created by automated logistics synchronization or system process. |
| admin | Event is created by authorized operations/admin workflow. |

## Event-to-Status Mapping Rules

- Every tracking event must map to exactly one resulting shipment lifecycle status.
- `tracking_events.event_code` must be one of the official event codes above.
- `tracking_events.resulting_status` must be one of the official statuses in `logistics_status_codes.md`.
- Public timeline must display event descriptions and locations, not database log wording.
- An `EXCEPTION_REPORT` event moves the aggregated shipment status to `EXCEPTION`.

## Related Contracts

- `logistics_status_codes.md`
- `status_transition_rules.md`
- `workflow_lifecycle.md`
- `GLOBAL_RULES.md`
