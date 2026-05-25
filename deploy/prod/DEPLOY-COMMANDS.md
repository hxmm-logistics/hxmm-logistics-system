# HX MM Production Commands

## Local Build

```bash
npm ci
npm run build
```

## PM2 Production

```bash
cp .env.production.example .env.production
cp .env.production .env
npm ci
npm run build
npm run db:schema
npm run db:migrate
npm run db:migrate:auth
npm run db:migrate:tracking
npm run db:seed
npm run db:seed:users
pm2 start deploy/prod/ecosystem.prod.config.cjs --env production
pm2 save
curl -fsS http://127.0.0.1:4000/api/health
```

## Docker Compose Production

```bash
cp .env.production.example .env.production
nano .env.production
docker compose --env-file .env.production -f deploy/docker/docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f deploy/docker/docker-compose.prod.yml exec api npm run db:schema
docker compose --env-file .env.production -f deploy/docker/docker-compose.prod.yml exec api npm run db:migrate
docker compose --env-file .env.production -f deploy/docker/docker-compose.prod.yml exec api npm run db:migrate:auth
npm run db:migrate:tracking
docker compose --env-file .env.production -f deploy/docker/docker-compose.prod.yml exec api npm run db:seed
docker compose --env-file .env.production -f deploy/docker/docker-compose.prod.yml exec api npm run db:seed:users
curl -fsS http://127.0.0.1/api/health
```