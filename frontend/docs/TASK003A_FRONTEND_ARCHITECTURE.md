# TASK-003A Frontend Architecture Separation

## Goal
Separate HX MM frontend into independent production modules:

- Public Tracking Site: `/track`
- Warehouse PDA: `/scan`
- Admin Operations: `/admin`

## Route Architecture
- `/track`, `/tracking`, `/`: public consumer tracking only.
- `/scan`: protected warehouse PDA workflow.
- `/admin`: protected admin operations backend.
- `/shipment/:tracking_no`: protected operations detail view.
- `/dashboard`: compatibility redirect to `/admin`.

## Component Architecture
- `frontend/src/main.jsx`: route shell only.
- `frontend/src/pages/PublicTrackingPage.jsx`: consumer tracking page.
- `frontend/src/pages/WarehousePdaPage.jsx`: warehouse scanning workflow.
- `frontend/src/pages/AdminOperationsPage.jsx`: admin operations and shipment management.
- `frontend/src/pages/LoginPage.jsx`: login only.
- `frontend/src/pages/ShipmentDetailPage.jsx`: protected shipment details.
- `frontend/src/shared/ui.jsx`: shared formatting, timeline, status helpers.

## Acceptance Criteria
- Public page has no admin controls, scan controls, or shipment creation.
- Operator cannot enter `/admin`.
- Admin `/dashboard` is redirected to `/admin`.
- Page state is isolated by route module.
- Camera lifecycle is isolated inside Warehouse PDA module.
- Build passes.

## Test Commands
```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4181
curl -i http://127.0.0.1:4181/track
curl -i http://127.0.0.1:4181/scan
curl -i http://127.0.0.1:4181/admin
```

## Deployment Commands
```bash
npm run build
pm2 restart hx-mm-api --update-env
sudo nginx -t
sudo systemctl reload nginx
```

## Migration Notes
No database migration is required for TASK-003A.

## Technical Debt
- Admin module still contains current real admin capabilities only. Batches/routes/warehouses/reports require later backend modules before UI should expose them.
- TASK-004 still needs to retire legacy button-style status endpoints after Warehouse PDA event drawer workflow is complete.
