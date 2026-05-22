# HX MM Security Audit

Audit date: 2026-05-22

Scope: backend productionization checks requested for the current Express/PostgreSQL/Vite monolith.

## CORS_ORIGIN

Status: fixed in source.

Before:

```js
const corsOrigin = process.env.CORS_ORIGIN || '*';
```

Risk:

- In production this could allow any browser origin if `CORS_ORIGIN` was missing.

After:

```js
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !process.env.CORS_ORIGIN) {
  throw new Error('CORS_ORIGIN is required in production');
}
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
```

Production requirement:

```env
NODE_ENV=production
CORS_ORIGIN=http://45.76.145.107
```

## JWT_SECRET

Status: warning added in source.

Behavior:

- `JWT_SECRET` is required.
- In `NODE_ENV=production`, weak values warn when:
  - length is under 32 characters
  - value contains `change-this`
  - value contains `local-dev`

Production requirement:

```env
JWT_SECRET=<long-random-secret-at-least-32-characters>
```

## Password Storage

Status: passed.

- Login verifies bcrypt hashes through `bcrypt.compare`.
- Operator create/reset/change hashes passwords with bcrypt cost 12.
- API responses do not return `password_hash`.
- Acceptance DB verification confirmed operator password hash prefix: `$2b`.

## Role Authorization

Status: passed.

Protected API:

- Shipment write APIs require `admin` or `operator`.
- Admin shipment list/logs require `admin` or `operator`.
- Operator management APIs require `admin`.

Middleware:

- `authenticateToken`
- `requireRole`

## Naked Auth Path Exposure

Status: application supports both naked and `/api` paths; Nginx config only proxies `/api`.

Backend mounted paths:

- `/auth/login`
- `/api/auth/login`

Public Nginx config:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:4000/;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

Result:

- Public HTTP should expose `/api/auth/login`, not `/auth/login`.
- This depends on port `4000` not being exposed to the public internet.

Production requirement:

```bash
sudo ufw deny 4000/tcp
sudo ufw allow 80/tcp
```

or equivalent Vultr firewall rules.

## Nginx

Config file in repo:

```text
deploy/nginx/hxmm.conf
```

Expected production path:

```text
/etc/nginx/sites-available/hxmm.conf
```

Required commands:

```bash
sudo cp deploy/nginx/hxmm.conf /etc/nginx/sites-available/hxmm.conf
sudo ln -s /etc/nginx/sites-available/hxmm.conf /etc/nginx/sites-enabled/hxmm.conf
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl status nginx
```

Current local audit limitation:

- This Codex session does not have SSH access to the Ubuntu server.
- Therefore `nginx -t` and `systemctl status nginx` were not executed on the server in this session.

## PM2

Required production commands:

```bash
cd /var/www/logistics-system/frontend-react-vite-backend-express-database
NODE_ENV=production pm2 start server/index.js --name hx-mm-api
pm2 save
pm2 startup systemd
pm2 status
```

Current local audit limitation:

- This Codex session does not have SSH access to the Ubuntu server.
- Therefore `pm2 status`, PM2 restart behavior, and boot persistence were not verified on the server in this session.

## Public API Verification

Expected:

```bash
curl http://45.76.145.107/api/health
```

Expected response:

```json
{"ok":true,"service":"HX MM","database":"ok"}
```

Current local audit limitation:

- Previous public request from this workspace could not connect to `45.76.145.107`.
- Server-side verification must be run from SSH or after firewall/Nginx is confirmed.

## Remaining Risks

- China logistics provider is still mock/stub unless real Kuaidi100/Kdniao integration is completed.
- Backend still supports naked routes internally; production safety depends on Nginx/firewall exposing only port 80 and `/api`.
- `seed-users.sql` can overwrite seeded admin/operator passwords if run in production.
- No rate limiting exists on login.
- No account lockout exists for repeated failed login.

