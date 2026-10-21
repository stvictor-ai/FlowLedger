export function createFeedRepository(pool) {
  return {
    /** Active rows only — a deleted entry must disappear from the feed too. */
    async readEntries({ userId, ledgerId }) {
      const result = await pool.query(`
        SELECT payload
        FROM entries
        WHERE ledger_id = $1 AND user_id = $2 AND deleted_at IS NULL
      `, [ledgerId, userId])
      return result.rows.map(row => row.payload)
    },

    /** Loans and the plan, tombstones excluded for the same reason. */
    async readDebts({ userId, ledgerId }) {
      const result = await pool.query(`
        SELECT payload
        FROM debts
        WHERE ledger_id = $1 AND user_id = $2 AND deleted_at IS NULL
      `, [ledgerId, userId])
      return result.rows.map(row => row.payload)
    }
  }
}
