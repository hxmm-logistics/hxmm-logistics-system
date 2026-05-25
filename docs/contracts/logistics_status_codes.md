# Logistics Status Codes

This document freezes the official HX MM shipment lifecycle statuses.

Only the statuses listed here are valid. Future development must not invent or use additional shipment status codes without updating this contract first.

## Official Statuses

| code | display_name | description | allowed_previous_statuses | allowed_next_statuses |
|---|---|---|---|---|
| CREATED | 已创建 / Created | Shipment record has been created, but warehouse has not physically received the parcel yet. | None | WAREHOUSE_RECEIVED, EXCEPTION |
| WAREHOUSE_RECEIVED | 已入库 / Warehouse received | Parcel has been scanned and received by the China warehouse. | CREATED, EXCEPTION | CHINA_TRANSIT, EXCEPTION |
| CHINA_TRANSIT | 中国运输中 / China transit | Parcel has departed or is moving within China toward the border route. | WAREHOUSE_RECEIVED, EXCEPTION | AT_BORDER, EXCEPTION |
| AT_BORDER | 已到边境 / At border | Parcel has arrived at the China-Myanmar border node such as Ruili, Qingshuihe, Muse, or a configured border checkpoint. | CHINA_TRANSIT, EXCEPTION | CUSTOMS_CLEARANCE, EXCEPTION |
| CUSTOMS_CLEARANCE | 清关中 / Customs clearance | Parcel is in customs or cross-border clearance processing. | AT_BORDER, EXCEPTION | MYANMAR_TRANSIT, EXCEPTION |
| MYANMAR_TRANSIT | 缅典运输中 / Myanmar transit | Parcel has entered Myanmar logistics network and is moving toward a city, branch, or dispatch node. | CUSTOMS_CLEARANCE, EXCEPTION | OUT_FOR_DELIVERY, EXCEPTION |
| OUT_FOR_DELIVERY | 派送中 / Out for delivery | Parcel has been dispatched to the recipient or final delivery route. | MYANMAR_TRANSIT, EXCEPTION | DELIVERED, EXCEPTION |
| DELIVERED | 已签收 / Delivered | Parcel has been signed for or confirmed delivered. This is a terminal success status. | OUT_FOR_DELIVERY, EXCEPTION | None |
| EXCEPTION | 异常 / Exception | Parcel has a logistics exception such as loss, delay, damaged parcel, wrong address, customs issue, failed delivery, or manual hold. | CREATED, WAREHOUSE_RECEIVED, CHINA_TRANSIT, AT_BORDER, CUSTOMS_CLEARANCE, MYANMAR_TRANSIT, OUT_FOR_DELIVERY | CREATED, WAREHOUSE_RECEIVED, CHINA_TRANSIT, AT_BORDER, CUSTOMS_CLEARANCE, MYANMAR_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, RETURNED |
| RETURNED | 已退回 / Returned | Parcel has been returned to sender, warehouse, or designated return handling point. This is a terminal return status. | EXCEPTION | None |

## Contract Notes

- `DELIVERED` and `RETURNED` are terminal statuses.
- `EXCEPTION` is a controlled interruption status, not a normal route step.
- Recovery from `EXCEPTION` must be backed by a valid tracking event and operator/audit context.
- Public tracking must display user-facing names, not internal implementation details.
- `shipment.status` is an aggregated cache derived from tracking events, not a field that application code may freely mutate.

## Related Contracts

- `tracking_event_codes.md`
- `status_transition_rules.md`
- `workflow_lifecycle.md`
- `GLOBAL_RULES.md`
