import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { createApp } from '../src/app.js'
import { createSyncRepository } from '../src/modules/sync/repository.js'
import { createSyncService, SyncError } from '../src/modules/sync/service.js'

const USER_ID = 'user-1'
const LEDGER_ID = '11111111-1111-4111-8111-111111111111'

function emptySnapshot() {
  return {
    entries: [],
    positions: [],
    deletedIds: {},
    deletedPositionIds: {}
  }
}

function memorySyncRepository() {
  const state = {
    revision: 0,
    snapshot: emptySnapshot()
  }
  return {
    state,
    repository: {
      async readSnapshot({ userId, ledgerId }) {
        if (userId !== USER_ID || ledgerId !== LEDGER_ID) return null
        return {
          ledger: { id: LEDGER_ID, name: '我的账本', revision: state.revision },
          ...structuredClone(state.snapshot)
        }
      },
      async writeSnapshot({ userId, ledgerId, baseRevision, snapshot }) {
        if (userId !== USER_ID || ledgerId !== LEDGER_ID) return { status: 'not_found' }
        if (baseRevision !== state.revision) return { status: 'conflict', revision: state.revision }
        state.snapshot = structuredClone(snapshot)
        state.revision += 1
        return { status: 'ok', revision: state.revision, updatedAt: new Date() }
      }
    }
  }
}

async function startApp(options) {
  const app = createApp(options)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
}

test('sync accepts the current revision and rejects a stale writer', async () => {
  const memory = memorySyncRepository()
  const service = createSyncService({ repository: memory.repository })
  const snapshot = {
    ...emptySnapshot(),
    entries: [{ id: 'entry-1', amount: 500, updatedAt: 1 }]
  }

  const first = await service.writeSnapshot({
    userId: USER_ID,
    ledgerId: LEDGER_ID,
    baseRevision: 0,
    snapshot
  })
  assert.equal(first.revision, 1)

  await assert.rejects(
    () => service.writeSnapshot({
      userId: USER_ID,
      ledgerId: LEDGER_ID,
      baseRevision: 0,
      snapshot
    }),
    error => error instanceof SyncError && error.code === 'REVISION_CONFLICT' && error.status === 409
  )
})

test('sync rejects duplicate and active/deleted IDs before persistence', async () => {
  const memory = memorySyncRepository()
  const service = createSyncService({ repository: memory.repository })

  await assert.rejects(
    () => service.writeSnapshot({
      userId: USER_ID,
      ledgerId: LEDGER_ID,
      baseRevision: 0,
      snapshot: {
        ...emptySnapshot(),
        entries: [{ id: 'same' }, { id: 'same' }]
      }
    }),
    error => error instanceof SyncError && error.code === 'DUPLICATE_ID'
  )

  await assert.rejects(
    () => service.writeSnapshot({
      userId: USER_ID,
      ledgerId: LEDGER_ID,
      baseRevision: 0,
      snapshot: {
        ...emptySnapshot(),
        positions: [{ id: 'position-1' }],
        deletedPositionIds: { 'position-1': 1 }
      }
    }),
    error => error instanceof SyncError && error.code === 'ACTIVE_DELETED_COLLISION'
  )
})

test('sync service hides ledgers owned by another user', async () => {
  const memory = memorySyncRepository()
  const service = createSyncService({ repository: memory.repository })

  await assert.rejects(
    () => service.readSnapshot({ userId: 'other-user', ledgerId: LEDGER_ID }),
    error => error instanceof SyncError && error.code === 'LEDGER_NOT_FOUND' && error.status === 404
  )
})

test('sync HTTP route requires a valid session and returns revision conflicts', async t => {
  const memory = memorySyncRepository()
  memory.state.revision = 2
  const syncService = createSyncService({ repository: memory.repository })
  const authService = {
    getSession: async token => token === 'valid-session'
      ? { id: USER_ID, email: 'owner@example.com', ledger: { id: LEDGER_ID } }
      : null,
    register: async () => {},
    login: async () => {},
    logout: async () => {}
  }
  const running = await startApp({ authService, syncService })
  t.after(running.close)

  const unauthenticated = await fetch(`${running.baseUrl}/api/v1/ledgers/${LEDGER_ID}/sync`)
  assert.equal(unauthenticated.status, 401)

  const conflict = await fetch(`${running.baseUrl}/api/v1/ledgers/${LEDGER_ID}/sync`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'touji_session=valid-session'
    },
    body: JSON.stringify({ baseRevision: 1, ...emptySnapshot() })
  })
  assert.equal(conflict.status, 409)
  assert.deepEqual(await conflict.json(), {
    error: 'REVISION_CONFLICT',
    details: { revision: 2 }
  })
})

test('repository conflict rolls back before deleting ledger records', async () => {
  const calls = []
  const client = {
    async query(sql) {
      const text = String(sql)
      calls.push(text)
      if (text.includes('SELECT revision')) return { rows: [{ revision: '4' }] }
      return { rows: [] }
    },
    release() {}
  }
  const repository = createSyncRepository({ connect: async () => client })

  const result = await repository.writeSnapshot({
    userId: USER_ID,
    ledgerId: LEDGER_ID,
    baseRevision: 3,
    snapshot: emptySnapshot()
  })

  assert.deepEqual(result, { status: 'conflict', revision: 4 })
  assert.equal(calls.includes('ROLLBACK'), true)
  assert.equal(calls.some(sql => sql.includes('DELETE FROM entries')), false)
  assert.equal(calls.some(sql => sql.includes('DELETE FROM positions')), false)
})
