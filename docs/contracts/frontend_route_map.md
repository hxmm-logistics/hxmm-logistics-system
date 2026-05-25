# Frontend Route Map

This document freezes current HX MM frontend route ownership and authentication requirements.

Future frontend routes must be added here before implementation.

## Current Routes

| route | module | authentication | allowed users | purpose | forbidden content |
|---|---|---|---|---|---|
| /track | Public Tracking Site | no | public users | Consumer logistics tracking by public `tracking_no`. | Admin controls, scan workflow, shipment creation, direct status actions, HX internal logic. |
| /tracking | Public Tracking Site | no | public users | Alias for public tracking page. | Admin controls, scan workflow, shipment creation, direct status actions, HX internal logic. |
| / | Public Tracking Site | no | public users | Default public entry, must behave as tracking site. | Admin controls, scan workflow, shipment creation, direct status actions, HX internal logic. |
| /scan | Warehouse PDA | yes | operator, admin | Warehouse/PDA scan workflow for creating tracking events and operational scans. | Consumer tracking result page, admin reports, fake status buttons. |
| /admin | Admin Operations | yes | admin | Operations backend for shipments, batches, warehouses, routes, operators, reports, exceptions. | Public consumer tracking UI, PDA camera scanning as primary workflow. |
| /login | Authentication | no | unauthenticated users | Login page for internal users. | Public shipment tracking result, admin operations. |
| /shipment/:tracking_no | Admin Operations Detail | yes | operator, admin | Protected shipment detail and operational timeline view. | Public consumer tracking page behavior. |

## Module Boundaries

### Public Tracking Site

- Owns consumer tracking experience.
- Must query by public `tracking_no` only.
- Must not show login-only controls unless explicitly navigating to login.
- Must not expose HX internal numbers as primary identifiers.

### Warehouse PDA

- Owns warehouse scan and continuous scan interaction.
- Must create tracking events, not directly mutate shipment status.
- Must be mobile-first and scanner-friendly.

### Admin Operations

- Owns operations dashboards, exception management, batch management, operator management, and reports.
- Must not be the default public homepage.
- Must not reuse public page state.

## Route Guard Rules

- Public routes: `/`, `/track`, `/tracking`.
- Internal routes: `/scan`, `/admin`, `/shipment/:tracking_no`.
- Operator users must not access `/admin`.
- Admin users may access `/admin`, `/scan`, and shipment detail routes.
- Unauthenticated access to internal routes must redirect to `/login`.

## Related Contracts

- `api_contracts.md`
- `workflow_lifecycle.md`
- `GLOBAL_RULES.md`
