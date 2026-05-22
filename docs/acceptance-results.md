# HX MM Backend Acceptance Results

Acceptance date: 2026-05-22

Server used for test:

```bash
PORT=4012 node server/index.js
```

Actual server log:

```text
[HX MM API running] http://localhost:4012
```

Raw machine output:

```text
artifacts/acceptance-raw.json
```

## 1. Health Check

Curl:

```bash
curl.exe -sS http://127.0.0.1:4012/api/health
```

Actual response:

```json
{"ok":true,"service":"HX MM","database":"ok"}
```

Result: passed

## 2. Login

Curl:

```bash
curl.exe -sS -X POST http://127.0.0.1:4012/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"Admin@12345\"}"
```

Actual response redacted:

```json
{
  "service": "HX MM",
  "token": "present",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "display_name": "HX MM Admin",
    "operator_id": 3
  }
}
```

Result: passed

Database write: `operation_logs` receives `LOGIN`.

## 3. Auth Me

Curl:

```bash
curl.exe -sS http://127.0.0.1:4012/api/auth/me \
  -H "Authorization: Bearer <token>"
```

Actual response:

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

Result: passed

## 4. Create Shipment

Curl:

```bash
curl.exe -sS -X POST http://127.0.0.1:4012/api/shipment/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d "{\"customer_name\":\"Acceptance Customer\",\"customer_phone\":\"+9598800405393\",\"china_carrier_code\":\"SF\",\"china_carrier_name\":\"SF Express\",\"china_tracking_no\":\"ACC-CN-405393\",\"current_location\":\"China warehouse\"}"
```

Actual response summary:

```json
{
  "id": 80,
  "platform_tracking_no": "HX202605220075",
  "tracking_no": "HX202605220075",
  "china_carrier_code": "SF",
  "china_tracking_no": "ACC-CN-405393",
  "current_status": "IN_CHINA_TRANSIT",
  "current_location": "中国",
  "service": "HX MM"
}
```

Result: passed

Notes:

- `shipments` was written.
- Initial `shipment_events` row was written as `PENDING`.
- China sync mock wrote `IN_CHINA_TRANSIT` event because `CHINA_LOGISTICS_PROVIDER` defaulted to mock.
- `operation_logs` received `SHIPMENT_CREATE`.

Generated tracking number:

```text
HX202605220075
```

## 5. Query Shipment

Curl:

```bash
curl.exe -sS http://127.0.0.1:4012/api/shipment/HX202605220075
```

Actual response summary:

```json
{
  "tracking_no": "HX202605220075",
  "current_status": "IN_CHINA_TRANSIT",
  "current_location": "中国",
  "events": [
    { "event_type": "IN_CHINA_TRANSIT", "source": "china_api" },
    { "event_type": "PENDING", "source": "system" }
  ]
}
```

Result: passed

## 6. Add Logistics Event

Curl:

```bash
curl.exe -sS -X POST http://127.0.0.1:4012/api/shipment/HX202605220075/event \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d "{\"event_type\":\"AT_BORDER\",\"location\":\"Ruili / Muse Border\",\"remark\":\"Acceptance border handoff\",\"source\":\"manual\"}"
```

Actual response summary:

```json
{
  "tracking_no": "HX202605220075",
  "current_status": "AT_BORDER",
  "current_location": "Ruili / Muse Border",
  "events": [
    { "event_type": "AT_BORDER", "source": "manual" },
    { "event_type": "IN_CHINA_TRANSIT", "source": "china_api" },
    { "event_type": "PENDING", "source": "system" }
  ]
}
```

Result: passed

## 7. Query Timeline Again

Curl:

```bash
curl.exe -sS http://127.0.0.1:4012/api/shipment/HX202605220075
```

Actual response summary:

```json
{
  "tracking_no": "HX202605220075",
  "current_status": "AT_BORDER",
  "events": [
    { "event_type": "AT_BORDER", "location": "Ruili / Muse Border" },
    { "event_type": "IN_CHINA_TRANSIT", "location": "中国" },
    { "event_type": "PENDING", "location": "China warehouse" }
  ]
}
```

Result: passed

## 8. Admin Logs API

Curl:

```bash
curl.exe -sS http://127.0.0.1:4012/api/admin/shipments/HX202605220075/logs \
  -H "Authorization: Bearer <token>"
```

Actual response summary:

```json
{
  "service": "HX MM",
  "platform_tracking_no": "HX202605220075",
  "status_logs": [
    {
      "from_status": "IN_CHINA_TRANSIT",
      "to_status": "AT_BORDER",
      "source": "manual",
      "username": "admin"
    }
  ],
  "operation_logs": [
    { "action": "SHIPMENT_STATUS_UPDATE" },
    { "action": "SHIPMENT_CREATE" }
  ]
}
```

Result: passed

## 9. Database Verification SQL

Shipment:

```sql
SELECT id, platform_tracking_no, current_status, current_location
FROM shipments
WHERE platform_tracking_no = 'HX202605220075';
```

Result:

```json
{
  "id": 80,
  "platform_tracking_no": "HX202605220075",
  "current_status": "AT_BORDER",
  "current_location": "Ruili / Muse Border"
}
```

Shipment events:

```sql
SELECT event_type, location, source
FROM shipment_events
WHERE shipment_id = 80
ORDER BY id;
```

Result:

```json
[
  { "event_type": "PENDING", "location": "China warehouse", "source": "system" },
  { "event_type": "IN_CHINA_TRANSIT", "location": "中国", "source": "china_api" },
  { "event_type": "AT_BORDER", "location": "Ruili / Muse Border", "source": "manual" }
]
```

Shipment status logs:

```sql
SELECT from_status, to_status, source, changed_by IS NOT NULL AS has_user
FROM shipment_status_logs
WHERE shipment_id = 80
ORDER BY id;
```

Result:

```json
[
  {
    "from_status": "IN_CHINA_TRANSIT",
    "to_status": "AT_BORDER",
    "source": "manual",
    "has_user": true
  }
]
```

Operation logs:

```sql
SELECT action, entity_type, platform_tracking_no, user_id IS NOT NULL AS has_user
FROM operation_logs
WHERE platform_tracking_no = 'HX202605220075'
ORDER BY id;
```

Result:

```json
[
  {
    "action": "SHIPMENT_CREATE",
    "entity_type": "shipments",
    "platform_tracking_no": "HX202605220075",
    "has_user": true
  },
  {
    "action": "SHIPMENT_STATUS_UPDATE",
    "entity_type": "shipments",
    "platform_tracking_no": "HX202605220075",
    "has_user": true
  }
]
```

## Failures

No API step failed in this acceptance run.

## Risks Found During Acceptance

- `shipment/create` triggered China sync mock because the local provider is mock/default.
- `shipment_events` receives the China mock event as a real database row; this is acceptable for local testing but must be replaced with a real provider in production.
- Test dependency issue was found before acceptance: `node_modules` was missing `dotenv`; `npm install` restored dependencies.

## Operator Management Acceptance

Raw machine output:

```text
artifacts/operator-acceptance-raw.json
```

### Login For Operator Tests

Curl:

```bash
curl.exe -sS -X POST http://127.0.0.1:4017/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"Admin@12345\"}"
```

Actual response redacted:

```json
{
  "service": "HX MM",
  "token": "present",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "display_name": "HX MM Admin",
    "operator_id": 3
  }
}
```

### Create Operator

Curl:

```bash
curl.exe -sS -X POST http://127.0.0.1:4017/api/admin/operators/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d "{\"username\":\"op_accept_85649\",\"password\":\"Operator@12345\",\"name\":\"Acceptance Operator 85649\",\"phone\":\"+95985649\"}"
```

Actual response:

```json
{
  "ok": true,
  "operator": {
    "id": 4,
    "name": "Acceptance Operator 85649",
    "phone": "+95985649",
    "company_id": null
  },
  "user": {
    "id": 3,
    "username": "op_accept_85649",
    "role": "operator",
    "display_name": "Acceptance Operator 85649",
    "operator_id": 4,
    "is_active": true
  }
}
```

Result: passed

### Reset Operator Password

Curl:

```bash
curl.exe -sS -X POST http://127.0.0.1:4017/api/admin/operators/reset-password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d "{\"username\":\"op_accept_85649\",\"new_password\":\"Operator@67890\"}"
```

Actual response:

```json
{
  "ok": true,
  "user": {
    "id": 3,
    "username": "op_accept_85649",
    "role": "operator",
    "display_name": "Acceptance Operator 85649",
    "operator_id": 4,
    "is_active": true
  }
}
```

Result: passed

### Disable Operator

Curl:

```bash
curl.exe -sS -X POST http://127.0.0.1:4017/api/admin/operators/disable \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d "{\"username\":\"op_accept_85649\"}"
```

Actual response:

```json
{
  "ok": true,
  "user": {
    "id": 3,
    "username": "op_accept_85649",
    "role": "operator",
    "display_name": "Acceptance Operator 85649",
    "operator_id": 4,
    "is_active": false
  }
}
```

Result: passed

### Change Password Negative Test

Curl:

```bash
curl.exe -sS -X POST http://127.0.0.1:4017/api/admin/operators/change-password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d "{\"current_password\":\"wrong-password\",\"new_password\":\"Admin@67890\"}"
```

Actual response:

```json
{
  "error": "current_password is invalid"
}
```

Result: passed as a negative test; existing admin password was not changed.

### Operator Database Verification SQL

```sql
SELECT id, username, role, substring(password_hash from 1 for 3) AS hash_prefix, operator_id, is_active
FROM users
WHERE username = 'op_accept_85649';
```

Result:

```json
{
  "id": 3,
  "username": "op_accept_85649",
  "role": "operator",
  "hash_prefix": "$2b",
  "operator_id": 4,
  "is_active": false
}
```

```sql
SELECT action, entity_type, user_id IS NOT NULL AS has_user
FROM operation_logs
WHERE detail::text ILIKE '%op_accept_85649%'
ORDER BY id;
```

Result:

```json
[
  { "action": "OPERATOR_CREATE", "entity_type": "operators", "has_user": true },
  { "action": "OPERATOR_RESET_PASSWORD", "entity_type": "operators", "has_user": true },
  { "action": "OPERATOR_DISABLE", "entity_type": "operators", "has_user": true }
]
```

### Operator Acceptance Issues Found And Fixed

- Initial operator router mount intercepted `/api/auth/login`; fixed by scoping auth middleware to `/admin/operators`.
- Initial operator create hit `operators_pkey` sequence drift because seed data uses explicit IDs; fixed by synchronizing `operators` and `users` sequences before operator creation.
