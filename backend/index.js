import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { operatorsRouter } from './routes/operators.js';
import { shipmentsRouter } from './routes/shipments.js';
import { apiRateLimit, loginRateLimit, securityHeaders } from './security.js';
import { startChinaSyncJob } from './services/syncChina.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !process.env.CORS_ORIGIN) {
  throw new Error('CORS_ORIGIN is required in production');
}
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';

app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

async function healthCheck(req, res) {
  try {
    await import('./db.js').then(({ query }) => query('SELECT 1'));
    res.json({ ok: true, service: 'HX MM', database: 'ok' });
  } catch (error) {
    res.status(503).json({ ok: false, service: 'HX MM', database: 'error' });
  }
}

app.get('/health', healthCheck);
app.get('/api/health', healthCheck);
app.use(['/auth/login', '/api/auth/login'], loginRateLimit);
app.use(apiRateLimit);
app.use(authRouter);
app.use(shipmentsRouter);
app.use(operatorsRouter);
app.use('/api', authRouter);
app.use('/api', shipmentsRouter);
app.use('/api', operatorsRouter);

app.use((error, req, res, next) => {
  const status = error.status || 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : error.message,
  });
  if (status === 500) {
    console.error(error);
  }
});

app.listen(port, () => {
  console.log(`[HX MM API running] http://localhost:${port}`);
  startChinaSyncJob();
});
