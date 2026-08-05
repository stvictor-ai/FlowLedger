export function createAdminRepository(pool) {
  return {
    async summary() {
      const result = await pool.query(`
        SELECT
          (SELECT count(*)::int FROM users) AS users_total,
          (SELECT count(*)::int FROM users WHERE status = 'active') AS users_active,
          (SELECT count(*)::int FROM invitation_codes
            WHERE role = 'user'
              AND disabled_at IS NULL
              AND used_count < max_uses
              AND (expires_at IS NULL OR expires_at > now())) AS invitations_available,
          (SELECT count(*)::int FROM entries WHERE deleted_at IS NULL) AS entries_total,
          (SELECT count(*)::int FROM positions WHERE deleted_at IS NULL) AS positions_total,
          (SELECT COALESCE(max(updated_at), now()) FROM ledgers) AS latest_ledger_update
      `)
      return result.rows[0]
    },

    async listUsers() {
      const result = await pool.query(`
        SELECT
          u.id,
          u.email,
          u.role,
          u.status,
          u.created_at,
          max(s.last_seen_at) AS last_seen_at,
          count(DISTINCT e.id)::int AS entries_count,
          count(DISTINCT p.id)::int AS positions_count
        FROM users u
        LEFT JOIN sessions s ON s.user_id = u.id
        LEFT JOIN ledgers l ON l.user_id = u.id
        LEFT JOIN entries e ON e.user_id = u.id AND e.ledger_id = l.id AND e.deleted_at IS NULL
        LEFT JOIN positions p ON p.user_id = u.id AND p.ledger_id = l.id AND p.deleted_at IS NULL
        GROUP BY u.id
        ORDER BY u.created_at DESC
      `)
      return result.rows
    },

    async updateUserStatus({ userId, status, now }) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await client.query(`
          UPDATE users
          SET status = $2, updated_at = $3
          WHERE id = $1 AND role = 'user'
          RETURNING id, email, role, status, created_at
        `, [userId, status, now])
        if (!result.rows[0]) {
          await client.query('ROLLBACK')
          return null
        }
        if (status === 'disabled') {
          await client.query('DELETE FROM sessions WHERE user_id = $1', [userId])
        }
        await client.query('COMMIT')
        return result.rows[0]
      } catch (error) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // Preserve the original database error.
        }
        throw error
      } finally {
        client.release()
      }
    },

    async listInvitations() {
      const result = await pool.query(`
        SELECT
          i.id,
          i.role,
          i.max_uses,
          i.used_count,
          i.expires_at,
          i.disabled_at,
          i.created_at,
          u.email AS created_by_email
        FROM invitation_codes i
        LEFT JOIN users u ON u.id = i.created_by
        WHERE i.role = 'user'
        ORDER BY i.created_at DESC
        LIMIT 100
      `)
      return result.rows
    },

    async createInvitation({ codeHash, maxUses, expiresAt, createdBy }) {
      const result = await pool.query(`
        INSERT INTO invitation_codes(code_hash, role, max_uses, expires_at, created_by)
        VALUES ($1, 'user', $2, $3, $4)
        RETURNING id, role, max_uses, used_count, expires_at, disabled_at, created_at
      `, [codeHash, maxUses, expiresAt, createdBy])
      return result.rows[0]
    },

    async revokeInvitation({ inviteId, now }) {
      const result = await pool.query(`
        UPDATE invitation_codes
        SET disabled_at = $2
        WHERE id = $1 AND role = 'user' AND disabled_at IS NULL
        RETURNING id, disabled_at
      `, [inviteId, now])
      return result.rows[0] || null
    }
  }
}

