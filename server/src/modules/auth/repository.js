export class AuthRepositoryError extends Error {
  constructor(code) {
    super(code)
    this.name = 'AuthRepositoryError'
    this.code = code
  }
}

export function createAuthRepository(pool) {
  return {
    async registerUser({ email, passwordHash, inviteCodeHash, now }) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const inviteResult = await client.query(`
          SELECT id, role
          FROM invitation_codes
          WHERE code_hash = $1
            AND disabled_at IS NULL
            AND (expires_at IS NULL OR expires_at > $2)
            AND used_count < max_uses
          FOR UPDATE
        `, [inviteCodeHash, now])

        if (!inviteResult.rows[0]) {
          await client.query('ROLLBACK')
          return null
        }

        let userResult
        try {
          userResult = await client.query(`
            INSERT INTO users(email, password_hash, role)
            VALUES ($1, $2, $3)
            RETURNING id, email, role, status, created_at
          `, [email, passwordHash, inviteResult.rows[0].role])
        } catch (error) {
          if (error?.code === '23505') throw new AuthRepositoryError('EMAIL_TAKEN')
          throw error
        }

        const user = userResult.rows[0]
        const ledgerResult = await client.query(`
          INSERT INTO ledgers(user_id, name)
          VALUES ($1, '我的账本')
          RETURNING id, name, revision
        `, [user.id])
        await client.query(`
          UPDATE invitation_codes
          SET used_count = used_count + 1
          WHERE id = $1
        `, [inviteResult.rows[0].id])
        await client.query('COMMIT')

        return { user, ledger: ledgerResult.rows[0] }
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

    async findUserByEmail(email) {
      const result = await pool.query(`
        SELECT
          u.id,
          u.email,
          u.password_hash,
          u.role,
          u.status,
          u.created_at,
          l.id AS ledger_id,
          l.name AS ledger_name,
          l.revision
        FROM users u
        LEFT JOIN LATERAL (
          SELECT id, name, revision
          FROM ledgers
          WHERE user_id = u.id
          ORDER BY created_at ASC
          LIMIT 1
        ) l ON true
        WHERE u.email = $1
      `, [email])
      return result.rows[0] || null
    },

    async createSession({ userId, tokenHash, expiresAt, now }) {
      const result = await pool.query(`
        INSERT INTO sessions(user_id, token_hash, expires_at, last_seen_at)
        VALUES ($1, $2, $3, $4)
        RETURNING id, expires_at
      `, [userId, tokenHash, expiresAt, now])
      return result.rows[0]
    },

    async findSession({ tokenHash, now }) {
      const result = await pool.query(`
        SELECT
          u.id AS user_id,
          u.email,
          u.role,
          u.status,
          l.id AS ledger_id,
          l.name AS ledger_name,
          l.revision,
          s.expires_at
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN LATERAL (
          SELECT id, name, revision
          FROM ledgers
          WHERE user_id = u.id
          ORDER BY created_at ASC
          LIMIT 1
        ) l ON true
        WHERE s.token_hash = $1
          AND s.expires_at > $2
          AND u.status = 'active'
      `, [tokenHash, now])
      return result.rows[0] || null
    },

    async deleteSession(tokenHash) {
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])
    },

    async createInvitation({ codeHash, maxUses, expiresAt, createdBy, role = 'user' }) {
      const result = await pool.query(`
        INSERT INTO invitation_codes(code_hash, max_uses, expires_at, created_by, role)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, role, max_uses, expires_at, created_at
      `, [codeHash, maxUses, expiresAt, createdBy || null, role])
      return result.rows[0]
    }
  }
}
