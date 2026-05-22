import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from './db.js';

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is required');
  }
  if (
    process.env.NODE_ENV === 'production' &&
    (secret.length < 32 || secret.includes('change-this') || secret.includes('local-dev'))
  ) {
    console.warn('[HX MM security] JWT_SECRET is weak for production');
  }
  return secret;
}

export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name,
      operator_id: user.operator_id,
    },
    jwtSecret(),
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function authenticateToken(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Missing API token' });
    }

    const payload = jwt.verify(token, jwtSecret());
    const result = await query(
      `
        SELECT id, username, role, display_name, operator_id, is_active
        FROM users
        WHERE id = $1
      `,
      [payload.sub]
    );

    if (result.rowCount === 0 || !result.rows[0].is_active) {
      return res.status(401).json({ error: 'Invalid API token' });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'API token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid API token', code: 'TOKEN_INVALID' });
  }
}

export function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
