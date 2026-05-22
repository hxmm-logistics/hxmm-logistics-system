# HX MM Backend API Audit

Audit date: 2026-05-22

Scope: `server/`, `database/`, `package.json`, `.env.example`

This document is based on the current source code only. It does not assume routes that are not present in code.

## Express Mounts

From `server/index.js`:

| Mount | Purpose |
| --- | --- |
| `app.use(cors({ origin: corsOrigin }))` | CORS middleware |
| `app.use(express.json())` | JSON body parser |
| `app.get('/health', healthCheck)` | Internal/plain health check |
| `app.get('/api/health', healthCheck)` | API-prefixed health check |
| `app.use(authRouter)` | Mount auth routes without prefix |
| `app.use(shipmentsRouter)` | Mount shipment/admin routes without prefix |
| `app.use('/api', authRouter)` | Mount auth routes with `/api` prefix |
| `app.use('/api', shipmentsRouter)` | Mount shipment/admin routes with `/api` prefix |
| `app.use((error, req, res, next) => ...)` | Error handler |

## Route Summary

Because routers are mounted both directly and under `/api`, each router route has two working paths.

| Method | Path | JWT | Role | Writes tables | Real DB write | Mock/stub |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/health` | No | No | None | No | No |
| GET | `/api/health` | No | No | None | No | No |
| POST | `/auth/login` | No | No | `operation_logs` | Yes | No |
| POST | `/api/auth/login` | No | No | `operation_logs` | Yes | No |
| GET | `/auth/me` | Yes | No | None | No | No |
| GET | `/api/auth/me` | Yes | No | None | No | No |
| POST | `/shipment/create` | Yes | `admin` or `operator` | `shipments`, `shipment_events`, `operation_logs`; may update `shipments` via china sync | Yes | China sync may be mock/stub |
| POST | `/api/shipment/create` | Yes | `admin` or `operator` | `shipments`, `shipment_events`, `operation_logs`; may update `shipments` via china sync | Yes | China sync may be mock/stub |
| GET | `/shipment/:tracking_no` | No | No | None | No | No |
| GET | `/api/shipment/:tracking_no` | No | No | None | No | No |
| POST | `/shipment/:tracking_no/event` | Yes | `admin` or `operator` | `shipment_events`, `shipment_status_logs`, `shipments`, `operation_logs` | Yes | No |
| POST | `/api/shipment/:tracking_no/event` | Yes | `admin` or `operator` | `shipment_events`, `shipment_status_logs`, `shipments`, `operation_logs` | Yes | No |
| POST | `/shipment/:tracking_no/scan-update` | Yes | `admin` or `operator` | `shipment_events`, `shipment_status_logs`, `shipments`, `operation_logs` | Yes | No |
| POST | `/api/shipment/:tracking_no/scan-update` | Yes | `admin` or `operator` | `shipment_events`, `shipment_status_logs`, `shipments`, `operation_logs` | Yes | No |
| GET | `/admin/shipments` | Yes | `admin` or `operator` | None | No | No |
| GET | `/api/admin/shipments` | Yes | `admin` or `operator` | None | No | No |
| GET | `/admin/shipments/:tracking_no/logs` | Yes | `admin` or `operator` | None | No | No |
| GET | `/api/admin/shipments/:tracking_no/logs` | Yes | `admin` or `operator` | None | No | No |
| POST | `/admin/operators/create` | Yes | `admin` | `operators`, `users`, `operation_logs` | Yes | No |
| POST | `/api/admin/operators/create` | Yes | `admin` | `operators`, `users`, `operation_logs` | Yes | No |
| POST | `/admin/operators/disable` | Yes | `admin` | `users`, `operation_logs` | Yes | No |
| POST | `/api/admin/operators/disable` | Yes | `admin` | `users`, `operation_logs` | Yes | No |
| POST | `/admin/operators/reset-password` | Yes | `admin` | `users`, `operation_logs` | Yes | No |
| POST | `/api/admin/operators/reset-password` | Yes | `admin` | `users`, `operation_logs` | Yes | No |
| POST | `/admin/operators/change-password` | Yes | `admin` | `users`, `operation_logs` | Yes | No |
| POST | `/api/admin/operators/change-password` | Yes | `admin` | `users`, `operation_logs` | Yes | No |

No `PUT`, `PATCH`, or `DELETE` routes exist in the current backend code.

## Detailed Routes

### GET `/health`

Also mounted as `GET /api/health`.

JWT: No

Role: No

Writes: None

Request body: None

Behavior:

- Runs `SELECT 1` through PostgreSQL.
- Returns HTTP 200 when DB is reachable.
- Returns HTTP 503 when DB check fails.

Example response:

```json
{
  "ok": true,
  "service": "HX MM",
  "database": "ok"
}
```

### POST `/auth/login`

Also mounted as `POST /api/auth/login`.

JWT: No

Role: No

Writes: `operation_logs`

Request body:

```json
{
  "username": "admin",
  "password": "Admin@12345"
}
```

Behavior:

- Reads `users` by `username`.
- Rejects inactive users.
- Verifies password with `bcrypt.compare`.
- Writes a `LOGIN` row into `operation_logs`.
- Returns JWT and safe user object.

Example response:

```json
{
  "service": "HX MM",
  "token": "<jwt>",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "display_name": "HX MM Admin",
    "operator_id": 3
  }
}
```

### GET `/auth/me`

Also mounted as `GET /api/auth/me`.

JWT: Yes

Role: No

Writes: None

Request body: None

Behavior:

- Requires `Authorization: Bearer <token>`.
- Verifies JWT.
- Loads user from `users` and checks `is_active`.

Example response:

```json
{
  "service": "HX MM",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "display_name": "HX MM Admin",
    "operator_id": 3,
    "is_active": true
  }
}
```

### POST `/shipment/create`

Also mounted as `POST /api/shipment/create`.

JWT: Yes

Role: `admin` or `operator`

Writes:

- `shipments`
- `shipment_events`
- `operation_logs`
- May write `shipment_events` and update `shipments` through `syncOneChinaShipment`

Request body:

```json
{
  "customer_name": "Production Test Customer",
  "customer_phone": "+95 977700000",
  "china_carrier_code": "SF",
  "china_carrier_name": "SF Express",
  "china_tracking_no": "SF123456789CN",
  "origin_country": "China",
  "destination_country": "Myanmar",
  "current_location": "中国卖家已创建",
  "created_by": 3
}
```

Required fields:

- `customer_name`
- `customer_phone`

Behavior:

- Generates `platform_tracking_no` using PostgreSQL sequence.
- Inserts shipment as `PENDING`.
- Inserts initial `shipment_events` row.
- If `china_carrier_code` and `china_tracking_no` exist, calls China sync.
- Writes `SHIPMENT_CREATE` to `operation_logs`.

Mock/stub:

- China sync uses `CHINA_LOGISTICS_PROVIDER`.
- Default provider is `mock`.
- `kuaidi100` and `kdniao` branches currently return stub data and do not call external HTTP APIs.

Example response:

```json
{
  "service": "HX MM",
  "platform_tracking_no": "HX202605220001",
  "tracking_no": "HX202605220001",
  "current_status": "IN_CHINA_TRANSIT",
  "events": []
}
```

### GET `/shipment/:tracking_no`

Also mounted as `GET /api/shipment/:tracking_no`.

JWT: No

Role: No

Writes: None

Request body: None

Behavior:

- Reads `shipments` by `platform_tracking_no`.
- Reads `shipment_events`.
- Returns shipment detail and timeline.

Example response:

```json
{
  "service": "HX MM",
  "tracking_no": "HX202605210001",
  "current_status": "IN_MYANMAR",
  "current_location": "木姐",
  "events": []
}
```

### POST `/shipment/:tracking_no/event`

Also mounted as `POST /api/shipment/:tracking_no/event`.

JWT: Yes

Role: `admin` or `operator`

Writes:

- `shipment_events`
- `shipment_status_logs`
- `shipments`
- `operation_logs`

Request body:

```json
{
  "event_type": "AT_BORDER",
  "location": "Ruili / Muse Border",
  "remark": "Arrived at border handoff",
  "source": "manual"
}
```

Required fields:

- `event_type`
- `location`

Behavior:

- Validates status enum.
- Validates source enum.
- Validates status transition.
- Locks shipment row with `FOR UPDATE`.
- Inserts event and status log.
- Updates shipment current status/location.
- Writes operation log.

Mock/stub: No

### POST `/shipment/:tracking_no/scan-update`

Also mounted as `POST /api/shipment/:tracking_no/scan-update`.

JWT: Yes

Role: `admin` or `operator`

Writes:

- `shipment_events`
- `shipment_status_logs`
- `shipments`
- `operation_logs`

Request body:

```json
{
  "action": "arrived_muse"
}
```

Supported actions:

- `arrived_muse`
- `arrived_mandalay`
- `out_for_delivery`
- `delivered`

Behavior:

- Maps scan action to status/location/remark.
- Applies same event append flow as manual event.
- Duplicate `DELIVERED -> DELIVERED` is idempotent and does not insert duplicate shipment event.

Mock/stub: No

### GET `/admin/shipments`

Also mounted as `GET /api/admin/shipments`.

JWT: Yes

Role: `admin` or `operator`

Writes: None

Query params:

- `search`
- `status`

Behavior:

- Searches platform tracking number, China tracking number, carrier code, or customer phone.
- Optional status filter.
- Returns max 100 rows.

Example response:

```json
[
  {
    "tracking_no": "HX202605210001",
    "current_status": "IN_MYANMAR"
  }
]
```

### GET `/admin/shipments/:tracking_no/logs`

Also mounted as `GET /api/admin/shipments/:tracking_no/logs`.

JWT: Yes

Role: `admin` or `operator`

Writes: None

Request body: None

Behavior:

- Reads `shipment_status_logs`.
- Reads `operation_logs`.

Example response:

```json
{
  "service": "HX MM",
  "platform_tracking_no": "HX202605210001",
  "status_logs": [],
  "operation_logs": []
}
```

### POST `/admin/operators/create`

Also mounted as `POST /api/admin/operators/create`.

JWT: Yes

Role: `admin`

Writes:

- `operators`
- `users`
- `operation_logs`

Request body:

```json
{
  "username": "operator_a",
  "password": "Operator@12345",
  "name": "Operator A",
  "phone": "+959000000",
  "company_id": 2,
  "display_name": "Operator A"
}
```

Required fields:

- `username`
- `password`
- `name`

Behavior:

- Password must be at least 8 characters.
- Password is stored as bcrypt hash.
- Uses existing `operators` and `users` tables.
- Synchronizes `operators` and `users` serial sequences before insert to tolerate explicit IDs from seed data.
- Writes `OPERATOR_CREATE` to `operation_logs`.

Example response:

```json
{
  "ok": true,
  "operator": {
    "id": 4,
    "name": "Operator A",
    "phone": "+959000000",
    "company_id": 2
  },
  "user": {
    "id": 3,
    "username": "operator_a",
    "role": "operator",
    "display_name": "Operator A",
    "operator_id": 4,
    "is_active": true
  }
}
```

### POST `/admin/operators/disable`

Also mounted as `POST /api/admin/operators/disable`.

JWT: Yes

Role: `admin`

Writes:

- `users`
- `operation_logs`

Request body:

```json
{
  "username": "operator_a"
}
```

Alternative:

```json
{
  "user_id": 3
}
```

Behavior:

- Finds a `users` row with role `operator`.
- Sets `is_active = FALSE`.
- Writes `OPERATOR_DISABLE` to `operation_logs`.

### POST `/admin/operators/reset-password`

Also mounted as `POST /api/admin/operators/reset-password`.

JWT: Yes

Role: `admin`

Writes:

- `users`
- `operation_logs`

Request body:

```json
{
  "username": "operator_a",
  "new_password": "Operator@67890"
}
```

Alternative identifier:

```json
{
  "user_id": 3,
  "new_password": "Operator@67890"
}
```

Behavior:

- Finds a `users` row with role `operator`.
- Hashes `new_password` using bcrypt.
- Updates `users.password_hash`.
- Writes `OPERATOR_RESET_PASSWORD` to `operation_logs`.

### POST `/admin/operators/change-password`

Also mounted as `POST /api/admin/operators/change-password`.

JWT: Yes

Role: `admin`

Writes:

- `users`
- `operation_logs`

Request body:

```json
{
  "current_password": "Admin@12345",
  "new_password": "Admin@67890"
}
```

Behavior:

- Changes the current authenticated admin user's password.
- Verifies `current_password` using bcrypt.
- Hashes `new_password` using bcrypt.
- Writes `ADMIN_CHANGE_PASSWORD` to `operation_logs`.

## Auth/Register/JWT/Middleware Checks

| Item | Status |
| --- | --- |
| `auth/register` | Not present |
| `auth/login` | Present |
| JWT signing | Present in `server/auth.js` |
| JWT verification middleware | Present: `authenticateToken` |
| Role auth middleware | Present: `requireRole` |
| Password hash verification | Present: `bcrypt.compare` |
| User table write endpoint | Not present |
| User seed write | Present in `database/seed-users.sql` |

## Mock / Stub Inventory

| Module | Function | Status |
| --- | --- | --- |
| `server/services/chinaLogistics.js` | `mockChinaTracking` | Mock by default when `CHINA_LOGISTICS_PROVIDER=mock` or unset |
| `server/services/chinaLogistics.js` | `fetchFromKuaidi100` | Stub; validates env but does not call Kuaidi100 HTTP API |
| `server/services/chinaLogistics.js` | `fetchFromKdniao` | Stub; validates env but does not call Kdniao HTTP API |

All auth, shipment create/query, manual event, scan update, admin list, and logs endpoints are backed by PostgreSQL queries.
