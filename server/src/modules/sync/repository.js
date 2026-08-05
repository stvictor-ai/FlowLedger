function toTimestampMap(rows) {
  return Object.fromEntries(rows.map(row => [
    row.id,
    Number(row.client_updated_at) || new Date(row.deleted_at).getTime()
  ]))
}

function syncRows(items, deletedIds) {
  const active = items.map(item => ({
    id: item.id,
    payload: item,
    client_updated_at: Number(item.updatedAt) || 0,
    deleted_at: null
  }))
  const deleted = Object.entries(deletedIds).map(([id, timestamp]) => ({
    id,
    payload: { id },
    client_updated_at: Number(timestamp) || 0,
    deleted_at: new Date(Number(timestamp) || 0).toISOString()
  }))
  return [...active, ...deleted]
}

async function insertRows(client, table, ledgerId, userId, rows) {
  if (!rows.length) return
  await client.query(`
    INSERT INTO ${table}(
      ledger_id, user_id, id, payload, client_updated_at, deleted_at
    )
    SELECT $1, $2, row.id, row.payload, row.client_updated_at, row.deleted_at
    FROM jsonb_to_recordset($3::jsonb) AS row(
      id TEXT,
      payload JSONB,
      client_updated_at BIGINT,
      deleted_at TIMESTAMPTZ
    )
  `, [ledgerId, userId, JSON.stringify(rows)])
}

export function createSyncRepository(pool) {
  return {
    async readSnapshot({ userId, ledgerId }) {
      const ledgerResult = await pool.query(`
        SELECT id, name, revision, updated_at
        FROM ledgers
        WHERE id = $1 AND user_id = $2
      `, [ledgerId, userId])
      const ledger = ledgerResult.rows[0]
      if (!ledger) return null

      const [entryResult, positionResult] = await Promise.all([
        pool.query(`
          SELECT id, payload, client_updated_at, deleted_at
          FROM entries
          WHERE ledger_id = $1 AND user_id = $2
          ORDER BY id
        `, [ledgerId, userId]),
        pool.query(`
          SELECT id, payload, client_updated_at, deleted_at
          FROM positions
          WHERE ledger_id = $1 AND user_id = $2
          ORDER BY id
        `, [ledgerId, userId])
      ])

      const activeEntries = entryResult.rows.filter(row => !row.deleted_at)
      const deletedEntries = entryResult.rows.filter(row => row.deleted_at)
      const activePositions = positionResult.rows.filter(row => !row.deleted_at)
      const deletedPositions = positionResult.rows.filter(row => row.deleted_at)

      return {
        ledger: {
          id: ledger.id,
          name: ledger.name,
          revision: Number(ledger.revision),
          updatedAt: ledger.updated_at
        },
        entries: activeEntries.map(row => row.payload),
        positions: activePositions.map(row => row.payload),
        deletedIds: toTimestampMap(deletedEntries),
        deletedPositionIds: toTimestampMap(deletedPositions)
      }
    },

    async writeSnapshot({ userId, ledgerId, baseRevision, snapshot }) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const ledgerResult = await client.query(`
          SELECT revision
          FROM ledgers
          WHERE id = $1 AND user_id = $2
          FOR UPDATE
        `, [ledgerId, userId])
        if (!ledgerResult.rows[0]) {
          await client.query('ROLLBACK')
          return { status: 'not_found' }
        }

        const currentRevision = Number(ledgerResult.rows[0].revision)
        if (currentRevision !== baseRevision) {
          await client.query('ROLLBACK')
          return { status: 'conflict', revision: currentRevision }
        }

        await client.query('DELETE FROM entries WHERE ledger_id = $1 AND user_id = $2', [ledgerId, userId])
        await client.query('DELETE FROM positions WHERE ledger_id = $1 AND user_id = $2', [ledgerId, userId])
        await insertRows(
          client,
          'entries',
          ledgerId,
          userId,
          syncRows(snapshot.entries, snapshot.deletedIds)
        )
        await insertRows(
          client,
          'positions',
          ledgerId,
          userId,
          syncRows(snapshot.positions, snapshot.deletedPositionIds)
        )

        const updateResult = await client.query(`
          UPDATE ledgers
          SET revision = revision + 1, updated_at = now()
          WHERE id = $1 AND user_id = $2
          RETURNING revision, updated_at
        `, [ledgerId, userId])
        await client.query('COMMIT')

        return {
          status: 'ok',
          revision: Number(updateResult.rows[0].revision),
          updatedAt: updateResult.rows[0].updated_at
        }
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
    }
  }
}
