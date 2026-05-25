# Global Rules

These rules are mandatory for all future HX MM development.

1. `tracking_events` is the single source of truth.
2. `shipment.status` is computed/aggregated only, never directly set.
3. Do NOT invent new shipment statuses outside `logistics_status_codes.md`.
4. Do NOT invent new tracking event codes outside `tracking_event_codes.md`.
5. All future APIs MUST follow `api_contracts.md`.
6. All future frontend routes MUST follow `frontend_route_map.md`.
7. No direct status mutation allowed. Forbidden examples: `shipment.status = DELIVERED`, button-based status update, fake timeline generation.
8. All logistics workflows must be event-driven.
9. Future development must reuse existing `tracking_events` module, status aggregation logic, and carrier detection logic.
10. Do NOT create giant single-page frontend architecture. Public query, PDA, and admin systems must remain isolated.
11. All future tasks must reference these contract documents before implementation.

## Contract Document Set

- `logistics_status_codes.md`
- `tracking_event_codes.md`
- `status_transition_rules.md`
- `database_dictionary.md`
- `api_contracts.md`
- `frontend_route_map.md`
- `workflow_lifecycle.md`

## Development Freeze Note

During Phase-0 contract freeze, no feature implementation should be performed. The contract documents are the source baseline for all future planning, acceptance criteria, migration work, and implementation.
