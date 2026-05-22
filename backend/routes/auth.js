import express from 'express';
import { query } from '../db.js';
import { signToken, verifyPassword, authenticateToken } from '../auth.js';

export const authRouter = express.Router();

authRouter.post('/auth/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const result = await query(
      `
        SELECT id, username, password_hash, role, display_name, operator_id, is_active
        FROM users
        WHERE username = $1
      `,
      [username]
    );

    if (result.rowCount === 0 || !result.rows[0].is_active) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = result.rows[0];
    const ok = await verifyPassword(password, user.password_hash);

    if (!ok) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    await query(
      `
        INSERT INTO operation_logs (user_id, action, entity_type, detail, ip_address)
        VALUES ($1, 'LOGIN', 'users', $2, $3)
      `,
      [user.id, JSON.stringify({ username: user.username, role: user.role }), req.ip]
    );

    const safeUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name,
      operator_id: user.operator_id,
    };

    res.json({
      service: 'HX MM',
      token: signToken(user),
      user: safeUser,
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/auth/me', authenticateToken, (req, res) => {
  res.json({ service: 'HX MM', user: req.user });
});
