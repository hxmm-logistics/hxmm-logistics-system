# HX MM Production Deployment

This guide prepares HX MM for a single-server production deployment on Ubuntu 24.04 with Node 22, PostgreSQL 16, Nginx, and PM2. Docker Compose is also provided for teams that want a containerized single-server deployment.

## 1. Server Requirements

```bash
sudo apt update
sudo apt install -y nodejs npm postgresql-16 nginx git curl rsync
sudo npm install -g pm2
```

Use Node 22. If the Ubuntu package is older, install Node 22 from NodeSource before running the app.

## 2. Clone Repository

```bash
sudo mkdir -p /var/www
sudo chown -R $USER:$USER /var/www
git clone https://github.com/hxmm-logistics/hxmm-logistics-system.git /var/www/logistics-system
cd /var/www/logistics-system
```

## 3. Environment

```bash
cp .env.production.example .env.production
cp .env.production .env
nano .env.production
nano .env
```

Set strong values for `POSTGRES_PASSWORD`, `DATABASE_URL`, `JWT_SECRET`, and `CORS_ORIGIN`.

## 4. PostgreSQL

```bash
sudo -u postgres psql
```

```sql
CREATE USER hxmm WITH PASSWORD 'replace-with-strong-postgres-password';
CREATE DATABASE hx_mm_logistics OWNER hxmm;
GRANT ALL PRIVILEGES ON DATABASE hx_mm_logistics TO hxmm;
\q
```

```bash
npm ci
npm run db:schema
npm run db:migrate
npm run db:migrate:auth
npm run db:migrate:tracking
npm run db:seed
npm run db:seed:users
```

## 5. Build

```bash
npm run build
```

## 6. PM2

```bash
pm2 start deploy/prod/ecosystem.prod.config.cjs --env production
pm2 save
pm2 status
pm2 startup systemd
```

Run the command printed by `pm2 startup`.

## 7. Nginx Reverse Proxy

```bash
sudo cp deploy/nginx/hxmm.conf /etc/nginx/sites-available/hxmm.conf
sudo ln -sf /etc/nginx/sites-available/hxmm.conf /etc/nginx/sites-enabled/hxmm.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 8. HTTPS Prepare

If you have a domain:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
sudo systemctl reload nginx
```

For Docker Compose, place certificates in:

```text
deploy/nginx/certs/fullchain.pem
deploy/nginx/certs/privkey.pem
```

Then replace `deploy/nginx/hxmm.prod.conf` with `deploy/nginx/hxmm.https.conf` in the Nginx image or compose config, and update `server_name`.

## 9. Backups

```bash
sudo mkdir -p /var/backups/hxmm-postgres
sudo chown -R $USER:$USER /var/backups/hxmm-postgres
chmod +x deploy/backup/postgres-backup-prod.sh
crontab deploy/backup/hxmm-backup.cron
```

Manual backup test:

```bash
set -a
source .env.production
set +a
bash deploy/backup/postgres-backup-prod.sh
```

## 10. Docker Compose Deployment

```bash
cp .env.production.example .env.production
nano .env.production
docker compose --env-file .env.production -f deploy/docker/docker-compose.prod.yml up -d --build
```

Check services:

```bash
docker compose --env-file .env.production -f deploy/docker/docker-compose.prod.yml ps
curl -fsS http://127.0.0.1/api/health
```

Run migrations inside the API container:

```bash
docker compose --env-file .env.production -f deploy/docker/docker-compose.prod.yml exec api npm run db:schema
docker compose --env-file .env.production -f deploy/docker/docker-compose.prod.yml exec api npm run db:migrate
docker compose --env-file .env.production -f deploy/docker/docker-compose.prod.yml exec api npm run db:migrate:auth
npm run db:migrate:tracking
docker compose --env-file .env.production -f deploy/docker/docker-compose.prod.yml exec api npm run db:seed
docker compose --env-file .env.production -f deploy/docker/docker-compose.prod.yml exec api npm run db:seed:users
```

## 11. GitHub Actions Auto Deploy

Workflow file:

```text
.github/workflows/deploy-production.yml
```

Required repository secrets:

- `PROD_HOST`
- `PROD_USER`
- `PROD_SSH_KEY`
- `PROD_SSH_PORT`

The server must already have the repository cloned at:

```text
/var/www/logistics-system
```

## 12. Health Checks

```bash
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1/api/health
pm2 status
sudo nginx -t
sudo systemctl status nginx --no-pager
```