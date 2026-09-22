export function createTokenRepository(pool) {
  return {
    async findActiveByHash(tokenHash) {
      const result = await pool.query(`
        SELECT t.id, t.user_id, t.ledger_id, t.scope, t.name,
               l.name AS ledger_name, l.revision, l.updated_at
        FROM api_tokens t
        JOIN ledgers l ON l.id = t.ledger_id AND l.user_id = t.user_id
        WHERE t.token_hash = $1 AND t.revoked_at IS NULL
      `, [tokenHash])
      const row = result.rows[0]
      if (!row) return null
      return {
        id: row.id,
        userId: row.user_id,
        ledgerId: row.ledger_id,
        scope: row.scope,
        name: row.name,
        ledger: {
          id: row.ledger_id,
          name: row.ledger_name,
          revision: Number(row.revision),
          updatedAt: row.updated_at
        }
      }
    },

    /** Fire-and-forget: a failed touch must never fail the read it belongs to. */
    async touch(id) {
      await pool.query('UPDATE api_tokens SET last_used_at = now() WHERE id = $1', [id])
    },

    async list(userId) {
      const result = await pool.query(`
        SELECT id, name, prefix, scope, ledger_id, created_at, last_used_at, revoked_at
        FROM api_tokens
        WHERE user_id = $1
        ORDER BY created_at DESC
      `, [userId])
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        scope: row.scope,
        ledgerId: row.ledger_id,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at
      }))
    },

    async countActive(userId) {
      const result = await pool.query(
        'SELECT count(*)::int AS total FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL',
        [userId]
      )
      return result.rows[0].total
    },

    async findLedger({ userId, ledgerId }) {
      const result = await pool.query(
        'SELECT id, name FROM ledgers WHERE user_id = $1 AND id = $2',
        [userId, ledgerId]
      )
      return result.rows[0] || null
    },

    async firstLedger(userId) {
      const result = await pool.query(
        'SELECT id, name FROM ledgers WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [userId]
      )
      return result.rows[0] || null
    },

    async create({ userId, ledgerId, name, prefix, tokenHash, scope }) {
      const result = await pool.query(`
        INSERT INTO api_tokens(user_id, ledger_id, name, prefix, token_hash, scope)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, name, prefix, scope, ledger_id, created_at
      `, [userId, ledgerId, name, prefix, tokenHash, scope])
      const row = result.rows[0]
      return {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        scope: row.scope,
        ledgerId: row.ledger_id,
        createdAt: row.created_at,
        lastUsedAt: null,
        revokedAt: null
      }
    },

    async revoke({ userId, id }) {
      const result = await pool.query(`
        UPDATE api_tokens
        SET revoked_at = now()
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
        RETURNING id
      `, [id, userId])
      return Boolean(result.rows[0])
    }
  }
}
