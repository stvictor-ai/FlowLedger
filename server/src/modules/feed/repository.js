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
    }
  }
}
