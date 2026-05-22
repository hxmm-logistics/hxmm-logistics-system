# HX MM

HX MM is a Myanmar-focused cross-border logistics tracking system.

This repository is the clean deployable version of the HX MM logistics MVP / pilot system. It keeps the existing stack:

- Frontend: React + Vite
- Backend: Express
- Database: PostgreSQL
- Architecture: single deployable Node.js application

## Project Structure

```text
logistics-system/
  frontend/           React + Vite frontend
  backend/            Express API server
  database/           PostgreSQL schema, migrations, seed data
  scripts/            Database and dev helper scripts
  deploy/             Nginx, PM2, backup, security references
  docs/               API audit, acceptance, scanner checklist
  package.json        Root scripts for install/build/start
  .env.example        Environment template
```

## Core Features

- JWT login for admin and operator users
- Role-based frontend navigation and protected API access
- Shipment creation and tracking number generation
- Shipment query by HX platform tracking number
- Logistics timeline and status history
- China logistics sync preparation through carrier + tracking number
- Myanmar scan/manual status update workflow
- Admin operator management APIs
- Mobile-first scan page for iPhone Safari/WebKit testing

## Requirements

- Node.js 22+
- PostgreSQL 16+
- npm

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and set a real `DATABASE_URL`, strong `JWT_SECRET`, and `CORS_ORIGIN`.

## Database

```bash
npm run db:create
npm run db:schema
npm run db:migrate
npm run db:migrate:auth
npm run db:seed
npm run db:seed:users
```

## Development

```bash
npm run dev
```

Frontend:

```text
http://localhost:5173
```

Backend health check:

```text
http://localhost:4000/api/health
```

Expected health response:

```json
{"ok":true,"service":"HX MM","database":"ok"}
```

## Production Build

```bash
npm run build
npm run start
```

The build output is generated in `dist/`.

## PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
```

## Nginx

See:

```text
deploy/nginx/hxmm.conf
```

Typical install path on Ubuntu:

```bash
sudo cp deploy/nginx/hxmm.conf /etc/nginx/sites-available/hxmm.conf
sudo ln -s /etc/nginx/sites-available/hxmm.conf /etc/nginx/sites-enabled/hxmm.conf
sudo nginx -t
sudo systemctl restart nginx
```

## Test Accounts

Seed users are defined in:

```text
database/seed-users.sql
```

Change seeded passwords before real production use.

## Notes

- Do not commit `.env`.
- Do not expose PostgreSQL to the public internet.
- Use HTTPS for real camera scanning on iPhone Safari and Telegram WebView.
- This export intentionally excludes `node_modules/`, `dist/`, browser cache profiles, screenshots, temporary logs, and local `.env` files.
