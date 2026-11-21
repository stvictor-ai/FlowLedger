import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { createApp } from '../src/app.js'
import { createSyncRepository } from '../src/modules/sync/repository.js'
import { createSyncService, protectFromOutdatedClient, SYNC_SCHEMA, SyncError } from '../src/modules/sync/service.js'

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
    snapshot: { ...emptySnapshot(), debts: [], deletedDebtIds: {} }
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
      async writeSnapshot({ userId, ledgerId, baseRevision, snapshot, reconcile = null }) {
        if (userId !== USER_ID || ledgerId !== LEDGER_ID) return { status: 'not_found' }
        if (baseRevision !== state.revision) return { status: 'conflict', revision: state.revision }
        // Mirrors the Postgres repository: the stored rows are handed over
        // inside the write, after the revision check.
        const next = structuredClone(reconcile
          ? reconcile({ entries: structuredClone(state.snapshot.entries), debts: structuredClone(state.snapshot.debts) })
          : snapshot)
        // Mirrors the Postgres repository: no debts key leaves debts alone.
        if (!Array.isArray(next.debts)) {
          next.debts = state.snapshot.debts
          next.deletedDebtIds = state.snapshot.deletedDebtIds
        }
        state.snapshot = next
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

const authService = {
  getSession: async token => token === 'valid-session'
    ? { id: USER_ID, email: 'owner@example.com', ledger: { id: LEDGER_ID } }
    : null,
  register: async () => {},
  login: async () => {},
  logout: async () => {}
}

function syncClient(baseUrl) {
  const url = `${baseUrl}/api/v1/ledgers/${LEDGER_ID}/sync`
  const headers = { 'Content-Type': 'application/json', Cookie: 'touji_session=valid-session' }
  return {
    read: async () => (await fetch(url, { headers })).json(),
    write: (body, extra = {}) => fetch(url, { method: 'PUT', headers: { ...headers, ...extra }, body: JSON.stringify(body) })
  }
}

/** Records every statement so a test can see what touched which table. */
function recordingPool({ revision = 0, rows = () => [] } = {}) {
  const calls = []
  const query = async (sql, params) => {
    const text = String(sql)
    calls.push({ text, params })
    if (text.includes('SELECT revision')) return { rows: [{ revision: String(revision) }] }
    if (text.includes('RETURNING revision')) return { rows: [{ revision: String(revision + 1), updated_at: new Date(0) }] }
    return { rows: rows(text) }
  }
  return {
    calls,
    pool: { query, connect: async () => ({ query, release() {} }) }
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

test('an old client that sends no debts leaves stored debts alone', async t => {
  const memory = memorySyncRepository()
  const syncService = createSyncService({ repository: memory.repository })
  const running = await startApp({ authService, syncService })
  t.after(running.close)
  const client = syncClient(running.baseUrl)

  const loan = { id: 'loan-1', kind: 'loan', principal: 50000, updatedAt: 10 }
  const first = await client.write({ baseRevision: 0, ...emptySnapshot(), debts: [loan], deletedDebtIds: {} })
  assert.equal(first.status, 200)
  assert.equal((await first.json()).revision, 1)

  // A cached PWA from before debts: the exact body it has always sent.
  const old = await client.write({
    baseRevision: 1,
    ...emptySnapshot(),
    entries: [{ id: 'entry-1', type: '入金', amount: 100, updatedAt: 11 }]
  })
  assert.equal(old.status, 200)
  assert.equal((await old.json()).revision, 2)

  const snapshot = await client.read()
  assert.deepEqual(snapshot.debts, [loan])
  assert.deepEqual(snapshot.deletedDebtIds, {})
  assert.equal(snapshot.entries.length, 1)
})

test('sent debts replace stored debts and tombstones round-trip', async t => {
  const memory = memorySyncRepository()
  const syncService = createSyncService({ repository: memory.repository })
  const running = await startApp({ authService, syncService })
  t.after(running.close)
  const client = syncClient(running.baseUrl)

  await client.write({
    baseRevision: 0,
    ...emptySnapshot(),
    debts: [{ id: 'loan-1', kind: 'loan' }, { id: 'loan-2', kind: 'loan' }]
  })
  const second = await client.write({
    baseRevision: 1,
    ...emptySnapshot(),
    debts: [{ id: 'loan-2', kind: 'loan', name: '改名了' }],
    deletedDebtIds: { 'loan-1': 1700000000000 }
  })
  assert.equal((await second.json()).revision, 2)

  const snapshot = await client.read()
  assert.deepEqual(snapshot.debts, [{ id: 'loan-2', kind: 'loan', name: '改名了' }])
  assert.deepEqual(snapshot.deletedDebtIds, { 'loan-1': 1700000000000 })
})

test('sync rejects duplicate, colliding and excess debts', async () => {
  const memory = memorySyncRepository()
  const service = createSyncService({ repository: memory.repository })
  const write = snapshot => service.writeSnapshot({
    userId: USER_ID,
    ledgerId: LEDGER_ID,
    baseRevision: 0,
    snapshot: { ...emptySnapshot(), ...snapshot }
  })

  await assert.rejects(
    () => write({ debts: [{ id: 'loan-1' }, { id: 'loan-1' }] }),
    error => error instanceof SyncError && error.code === 'DUPLICATE_ID' && error.details.collection === 'debts'
  )
  await assert.rejects(
    () => write({ debts: [{ id: 'loan-1' }], deletedDebtIds: { 'loan-1': 1 } }),
    error => error instanceof SyncError && error.code === 'ACTIVE_DELETED_COLLISION'
  )
  // Tombstones count towards the limit, as they do for entries.
  const debts = Array.from({ length: 1500 }, (_, index) => ({ id: `loan-${index}` }))
  const deletedDebtIds = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`gone-${index}`, 1]))
  await assert.rejects(
    () => write({ debts, deletedDebtIds }),
    error => error instanceof SyncError && error.code === 'TOO_MANY_DEBTS' && error.status === 413
  )
  assert.equal(memory.state.revision, 0)
})

test('repository never touches debts when the client sends none', async () => {
  const recorded = recordingPool({ revision: 3 })
  const repository = createSyncRepository(recorded.pool)

  const result = await repository.writeSnapshot({
    userId: USER_ID,
    ledgerId: LEDGER_ID,
    baseRevision: 3,
    snapshot: { ...emptySnapshot(), entries: [{ id: 'entry-1', updatedAt: 1 }] }
  })

  assert.equal(result.status, 'ok')
  assert.equal(recorded.calls.some(call => /\bdebts\b/.test(call.text)), false)
  assert.equal(recorded.calls.some(call => call.text.includes('DELETE FROM entries')), true)
  assert.equal(recorded.calls.at(-1).text, 'COMMIT')
})

test('repository replaces debts inside the same transaction when sent', async () => {
  const recorded = recordingPool({ revision: 3 })
  const repository = createSyncRepository(recorded.pool)

  await repository.writeSnapshot({
    userId: USER_ID,
    ledgerId: LEDGER_ID,
    baseRevision: 3,
    snapshot: {
      ...emptySnapshot(),
      debts: [{ id: 'loan-1', kind: 'loan', updatedAt: 5 }],
      deletedDebtIds: { 'loan-2': 9 }
    }
  })

  const texts = recorded.calls.map(call => call.text)
  const deleteAt = texts.findIndex(text => text.includes('DELETE FROM debts'))
  const insertAt = texts.findIndex(text => text.includes('INSERT INTO debts'))
  const bumpAt = texts.findIndex(text => text.includes('SET revision = revision + 1'))
  assert.ok(texts.indexOf('BEGIN') < deleteAt && deleteAt < insertAt && insertAt < bumpAt)
  assert.equal(texts.filter(text => text.includes('SET revision = revision + 1')).length, 1)
  assert.equal(texts.at(-1), 'COMMIT')

  const rows = JSON.parse(recorded.calls[insertAt].params[2])
  assert.deepEqual(rows.map(row => [row.id, row.client_updated_at, Boolean(row.deleted_at)]), [
    ['loan-1', 5, false],
    ['loan-2', 9, true]
  ])
})

test('repository reads debts and their tombstones', async () => {
  const recorded = recordingPool({
    rows: text => {
      if (text.includes('FROM ledgers')) return [{ id: LEDGER_ID, name: '我的账本', revision: '7', updated_at: new Date(0) }]
      if (text.includes('FROM debts')) {
        return [
          { id: 'debt-plan', payload: { id: 'debt-plan', kind: 'plan' }, client_updated_at: '4', deleted_at: null },
          { id: 'loan-1', payload: { id: 'loan-1', kind: 'loan' }, client_updated_at: '5', deleted_at: null },
          { id: 'loan-2', payload: { id: 'loan-2' }, client_updated_at: '9', deleted_at: new Date(9) }
        ]
      }
      return []
    }
  })
  const repository = createSyncRepository(recorded.pool)

  const snapshot = await repository.readSnapshot({ userId: USER_ID, ledgerId: LEDGER_ID })
  assert.deepEqual(snapshot.debts, [{ id: 'debt-plan', kind: 'plan' }, { id: 'loan-1', kind: 'loan' }])
  assert.deepEqual(snapshot.deletedDebtIds, { 'loan-2': 9 })
  assert.deepEqual(snapshot.positions, [])
})

// A ledger as the current client wrote it, then the same ledger as two older
// generations of the client would send it back.
function currentLedger() {
  return [
    { id: 'in-1', type: '入金', date: '2026-09-10', amount: 116.78, currency: 'USDT', fundSource: 'salary', channel: 'alipay', counterparty: '海上生明月', updatedAt: 100 },
    { id: 'out-1', type: '出金', date: '2026-09-12', amount: 690, currency: 'CNY', destination: 'repay', loanId: 'loan-1', channel: 'bank', updatedAt: 100 },
    { id: 'move-1', type: '互转', date: '2026-09-13', amount: 200, currency: 'CNY', toExchange: '平台乙', updatedAt: 100 }
  ]
}
const CURRENT = { 'X-Touji-Schema': String(SYNC_SCHEMA) }

test('a page from before the new fields cannot strip them from the ledger', async t => {
  const memory = memorySyncRepository()
  const syncService = createSyncService({ repository: memory.repository })
  const running = await startApp({ authService, syncService })
  t.after(running.close)
  const client = syncClient(running.baseUrl)

  const seeded = await client.write({ baseRevision: 0, ...emptySnapshot(), entries: currentLedger(), debts: [], deletedDebtIds: {} }, CURRENT)
  assert.equal((await seeded.json()).clientOutdated, undefined)

  // The oldest generation: no header, no debts, never heard of 互转 (so that
  // record is gone from its list) nor of any field added since.
  const old = await client.write({
    baseRevision: 1,
    ...emptySnapshot(),
    entries: [
      { id: 'in-1', type: '入金', date: '2026-09-10', amount: 116.78, currency: 'USDT', updatedAt: 100 },
      // edited on the old page: a new note and a newer timestamp
      { id: 'out-1', type: '出金', date: '2026-09-12', amount: 690, currency: 'CNY', note: '还款', updatedAt: 200 },
      { id: 'new-1', type: '入金', date: '2026-09-14', amount: 300, currency: 'CNY', updatedAt: 210 }
    ]
  })
  assert.equal(old.status, 200)
  assert.equal((await old.json()).clientOutdated, true)

  const byId = Object.fromEntries((await client.read()).entries.map(e => [e.id, e]))
  assert.deepEqual(byId['in-1'], currentLedger()[0])
  assert.deepEqual(byId['out-1'], { ...currentLedger()[1], note: '还款', updatedAt: 200 })
  assert.deepEqual(byId['move-1'], currentLedger()[2])
  assert.equal(byId['new-1'].amount, 300)
})

test('the release before this one keeps what it knows and only the newest fields are carried', () => {
  const stored = currentLedger()
  const sent = {
    ...emptySnapshot(),
    entries: [
      // it cleared the fund source on purpose; it has never seen a channel
      { id: 'in-1', type: '入金', date: '2026-09-10', amount: 116.78, currency: 'USDT', updatedAt: 300 },
      { id: 'move-1', type: '互转', date: '2026-09-13', amount: 200, currency: 'CNY', toExchange: '平台乙', updatedAt: 100 }
    ],
    deletedIds: { 'out-1': 310 }
  }
  const result = protectFromOutdatedClient(sent, stored, 2)
  const kept = result.entries.find(e => e.id === 'in-1')
  assert.equal('fundSource' in kept, false)
  assert.equal(kept.channel, 'alipay')
  assert.equal(kept.counterparty, '海上生明月')
  // a deletion made on the old page is still a deletion
  assert.deepEqual(result.entries.map(e => e.id), ['in-1', 'move-1'])
})

test('a current client replaces the ledger exactly as sent', async t => {
  const memory = memorySyncRepository()
  const syncService = createSyncService({ repository: memory.repository })
  const running = await startApp({ authService, syncService })
  t.after(running.close)
  const client = syncClient(running.baseUrl)

  await client.write({ baseRevision: 0, ...emptySnapshot(), entries: currentLedger() }, CURRENT)
  const cleared = { id: 'in-1', type: '入金', date: '2026-09-10', amount: 116.78, currency: 'USDT', updatedAt: 100 }
  const second = await client.write({ baseRevision: 1, ...emptySnapshot(), entries: [cleared] }, CURRENT)
  assert.equal(second.status, 200)
  assert.deepEqual((await client.read()).entries, [cleared])
})

test('repository reads the stored entries inside the write only when asked to reconcile', async () => {
  const calls = []
  const client = {
    async query(sql, params) {
      const text = String(sql)
      calls.push({ text, params })
      if (text.includes('SELECT revision')) return { rows: [{ revision: '0' }] }
      if (text.includes('SELECT payload')) return { rows: [{ payload: { id: 'kept', updatedAt: 5 } }] }
      if (text.includes('UPDATE ledgers')) return { rows: [{ revision: '1', updated_at: new Date() }] }
      return { rows: [] }
    },
    release() {}
  }
  const repository = createSyncRepository({ connect: async () => client })

  await repository.writeSnapshot({ userId: USER_ID, ledgerId: LEDGER_ID, baseRevision: 0, snapshot: emptySnapshot() })
  assert.equal(calls.some(call => call.text.includes('SELECT payload')), false)

  calls.length = 0
  await repository.writeSnapshot({
    userId: USER_ID,
    ledgerId: LEDGER_ID,
    baseRevision: 0,
    snapshot: emptySnapshot(),
    reconcile: stored => ({ ...emptySnapshot(), entries: stored.entries })
  })
  const order = calls.map(call => call.text)
  const read = order.findIndex(text => text.includes('SELECT payload'))
  const wipe = order.findIndex(text => text.includes('DELETE FROM entries'))
  assert.ok(read > order.findIndex(text => text.includes('SELECT revision')) && read < wipe)
  const inserted = calls.find(call => call.text.includes('INSERT INTO entries'))
  assert.deepEqual(JSON.parse(inserted.params[2]).map(row => row.id), ['kept'])
})

test('a page from before account values cannot drop them along with its debts', async t => {
  const memory = memorySyncRepository()
  const syncService = createSyncService({ repository: memory.repository })
  const running = await startApp({ authService, syncService })
  t.after(running.close)
  const client = syncClient(running.baseUrl)

  const loan = { id: 'loan-1', kind: 'loan', principal: 50000, updatedAt: 10 }
  const worth = { id: 'balance:基金账户', kind: 'balance', account: '基金账户', value: 8420, asOf: '2026-11-18', updatedAt: 20 }
  const removed = { id: 'balance:旧账户', kind: 'balance', account: '旧账户', value: 10, asOf: '2026-11-01', updatedAt: 5 }
  await client.write({ baseRevision: 0, ...emptySnapshot(), debts: [loan, worth, removed], deletedDebtIds: {} }, CURRENT)

  // The previous release: it sends debts (so it is schema 2 or 3), but read the
  // collection through a filter that only lets loans and the plan through.
  const older = await client.write({
    baseRevision: 1,
    ...emptySnapshot(),
    debts: [{ ...loan, principal: 48000, updatedAt: 30 }],
    deletedDebtIds: {}
  }, { 'X-Touji-Schema': '3' })
  assert.equal(older.status, 200)
  assert.equal((await older.json()).clientOutdated, true)
  let debts = (await client.read()).debts
  assert.deepEqual(debts.map(item => item.id).sort(), ['balance:基金账户', 'balance:旧账户', 'loan-1'].sort())
  assert.equal(debts.find(item => item.id === 'loan-1').principal, 48000)

  // A current client deleting a value is believed.
  const current = await client.write({
    baseRevision: 2,
    ...emptySnapshot(),
    debts: [{ ...loan, principal: 48000, updatedAt: 30 }, worth],
    deletedDebtIds: { 'balance:旧账户': 40 }
  }, CURRENT)
  assert.equal(current.status, 200)
  debts = (await client.read()).debts
  assert.deepEqual(debts.map(item => item.id).sort(), ['balance:基金账户', 'loan-1'].sort())
})
