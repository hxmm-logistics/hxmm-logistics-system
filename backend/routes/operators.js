import express from 'express';
import { pool, query } from '../db.js';
import { authenticateToken, hashPassword, requireRole, verifyPassword } from '../auth.js';

export const operatorsRouter = express.Router();

operatorsRouter.use('/admin/operators', authenticateToken, requireRole(['admin']));

function safeUser(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    display_name: row.display_name,
    operator_id: row.operator_id,
    is_active: row.is_active,
  };
}

function assertPassword(password) {
  if (!password || password.length < 8) {
    const error = new Error('password must be at least 8 characters');
    error.status = 400;
    throw error;
  }
}

async function logOperatorOperation(client, { userId, action, entityId, detail, ipAddress }) {
  await client.query(
    `
      INSERT INTO operation_logs (user_id, action, entity_type, entity_id, detail, ip_address)
      VALUES ($1, $2, 'operators', $3, $4, $5)
    `,
    [userId, action, entityId || null, JSON.stringify(detail || {}), ipAddress || null]
  );
}

async function syncOperatorSequences(client) {
  await client.query(`
    SELECT setval(
      pg_get_serial_sequence('operators', 'id'),
      GREATEST(COALESCE((SELECT MAX(id) FROM operators), 0), 1),
      true
    )
  `);
  await client.query(`
    SELECT setval(
      pg_get_serial_sequence('users', 'id'),
      GREATEST(COALESCE((SELECT MAX(id) FROM users), 0), 1),
      true
    )
  `);
}

async function findOperatorUser(client, { user_id, username }) {
  const result = await client.query(
    `
      SELECT id, username, password_hash, role, display_name, operator_id, is_active
      FROM users
      WHERE ($1::integer IS NOT NULL AND id = $1)
         OR ($2::text IS NOT NULL AND username = $2)
      LIMIT 1
    `,
    [user_id || null, username || null]
  );

  if (result.rowCount === 0 || result.rows[0].role !== 'operator') {
    const error = new Error('Operator user not found');
    error.status = 404;
    throw error;
  }

  return result.rows[0];
}

operatorsRouter.post('/admin/operators/create', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { username, password, name, phone, company_id, display_name } = req.body;

    if (!username || !password || !name) {
      return res.status(400).json({ error: 'username, password and name are required' });
    }
    assertPassword(password);

    await client.query('BEGIN');
    await syncOperatorSequences(client);
    const operatorResult = await client.query(
      `
        INSERT INTO operators (name, phone, company_id)
        VALUES ($1, $2, $3)
        RETURNING id, name, phone, company_id
      `,
      [name, phone || null, company_id || null]
    );
    const operator = operatorResult.rows[0];
    const passwordHash = await hashPassword(password);
    const userResult = await client.query(
      `
        INSERT INTO users (username, password_hash, role, display_name, operator_id, is_active)
        VALUES ($1, $2, 'operator', $3, $4, TRUE)
        RETURNING id, username, role, display_name, operator_id, is_active
      `,
      [username, passwordHash, display_name || name, operator.id]
    );

    await logOperatorOperation(client, {
      userId: req.user.id,
      action: 'OPERATOR_CREATE',
      entityId: operator.id,
      detail: { username, operator_id: operator.id },
      ipAddress: req.ip,
    });
    await client.query('COMMIT');

    res.status(201).json({ ok: true, operator, user: safeUser(userResult.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

operatorsRouter.post('/admin/operators/disable', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await findOperatorUser(client, req.body);
    const result = await client.query(
      `
        UPDATE users
        SET is_active = FALSE,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, username, role, display_name, operator_id, is_active
      `,
      [user.id]
    );
    await logOperatorOperation(client, {
      userId: req.user.id,
      action: 'OPERATOR_DISABLE',
      entityId: user.operator_id,
      detail: { username: user.username, user_id: user.id },
      ipAddress: req.ip,
    });
    await client.query('COMMIT');
    res.json({ ok: true, user: safeUser(result.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

operatorsRouter.post('/admin/operators/reset-password', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { new_password } = req.body;
    assertPassword(new_password);

    await client.query('BEGIN');
    const user = await findOperatorUser(client, req.body);
    const passwordHash = await hashPassword(new_password);
    const result = await client.query(
      `
        UPDATE users
        SET password_hash = $1,
            updated_at = NOW()
        WHERE id = $2
        RETURNING id, username, role, display_name, operator_id, is_active
      `,
      [passwordHash, user.id]
    );
    await logOperatorOperation(client, {
      userId: req.user.id,
      action: 'OPERATOR_RESET_PASSWORD',
      entityId: user.operator_id,
      detail: { username: user.username, user_id: user.id },
      ipAddress: req.ip,
    });
    await client.query('COMMIT');
    res.json({ ok: true, user: safeUser(result.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

operatorsRouter.post('/admin/operators/change-password', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { current_password, new_password } = req.body;
    if (!current_password) {
      return res.status(400).json({ error: 'current_password is required' });
    }
    assertPassword(new_password);

    await client.query('BEGIN');
    const userResult = await client.query(
      `
        SELECT id, username, password_hash, role, display_name, operator_id, is_active
        FROM users
        WHERE id = $1
      `,
      [req.user.id]
    );
    const user = userResult.rows[0];
    const ok = await verifyPassword(current_password, user.password_hash);
    if (!ok) {
      const error = new Error('current_password is invalid');
      error.status = 401;
      throw error;
    }

    const passwordHash = await hashPassword(new_password);
    const result = await client.query(
      `
        UPDATE users
        SET password_hash = $1,
            updated_at = NOW()
        WHERE id = $2
        RETURNING id, username, role, display_name, operator_id, is_active
      `,
      [passwordHash, user.id]
    );
    await logOperatorOperation(client, {
      userId: req.user.id,
      action: 'ADMIN_CHANGE_PASSWORD',
      entityId: user.operator_id,
      detail: { username: user.username, user_id: user.id },
      ipAddress: req.ip,
    });
    await client.query('COMMIT');
    res.json({ ok: true, user: safeUser(result.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});
