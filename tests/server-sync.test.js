const assert = require('node:assert/strict')
const test = require('node:test')
const {
  ServerSyncError,
  createAutoSyncCoordinator,
  createClient,
  hasSnapshotData,
  mergeRecord,
  SCHEMA_VERSION,
  summarizeSnapshot
} = require('../js/server-sync.js')

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => name === 'content-type' ? 'application/json' : null },
    json: async () => body
  }
}

test('server client always includes cookie credentials', async () => {
  const calls = []
  const client = createClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return jsonResponse(200, { user: { id: 'user-1' } })
    }
  })

  await client.login({ email: 'owner@example.com', password: 'password-value' })

  assert.equal(calls[0].url, '/api/v1/auth/login')
  assert.equal(calls[0].options.credentials, 'include')
  assert.equal(calls[0].options.method, 'POST')
})

test('server client preserves revision conflict details', async () => {
  const client = createClient({
    fetchImpl: async () => jsonResponse(409, {
      error: 'REVISION_CONFLICT',
      details: { revision: 3 }
    })
  })

  await assert.rejects(
    () => client.writeSnapshot('ledger-1', { baseRevision: 2 }),
    error => error instanceof ServerSyncError &&
      error.code === 'REVISION_CONFLICT' &&
      error.details.revision === 3
  )
})

test('admin client uses role-protected management endpoints', async () => {
  const calls = []
  const client = createClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return jsonResponse(options.method === 'POST' ? 201 : 200, {})
    }
  })

  await client.adminSummary()
  await client.createInvitation({ maxUses: 1, expiresDays: 14 })
  await client.updateUserStatus('user-1', 'disabled')

  assert.deepEqual(calls.map(call => [call.url, call.options.method]), [
    ['/api/v1/admin/summary', 'GET'],
    ['/api/v1/admin/invitations', 'POST'],
    ['/api/v1/admin/users/user-1/status', 'PATCH']
  ])
  assert.equal(calls.every(call => call.options.credentials === 'include'), true)
})

test('snapshot summary converts foreign currencies and counts tombstones', () => {
  const summary = summarizeSnapshot({
    entries: [
      {
        type: '入金', amount: 74.18397626, currency: 'USDT', rate: 6.74,
        sourceAmount: 500, sourceCurrency: 'CNY',
        targetAmount: 74.18397626, targetCurrency: 'USDT'
      },
      { type: '出金', amount: 200, currency: 'CNY' }
    ],
    positions: [{ id: 'position-1' }],
    debts: [{ id: 'loan-1', kind: 'loan' }, { id: 'balance:甲', kind: 'balance' }, { id: 'prefs:theme', kind: 'prefs' }],
    deletedIds: { old: 1 },
    deletedPositionIds: { gone: 2 },
    deletedDebtIds: { paid: 3 }
  })

  assert.deepEqual(summary, {
    entries: 2,
    positions: 1,
    debts: 1,
    extras: 1,
    totalIn: 500,
    totalOut: 200,
    deleted: 3
  })
  assert.equal(hasSnapshotData({ entries: [], positions: [] }), false)
  assert.equal(hasSnapshotData({ entries: [{ id: 'entry-1' }] }), true)
  // 只登记了贷款的账本也算有数据，首次同步不能被当成空账本直接覆盖。
  assert.equal(hasSnapshotData({ entries: [], positions: [], debts: [{ id: 'loan-1', kind: 'loan' }] }), true)
  // 账户现值和复盘笔记是账本内容；只换过外观的设备仍算空的，登录时可以直接取回账号里的账本。
  assert.equal(hasSnapshotData({ debts: [{ id: 'note:day:2026-11-20', kind: 'note' }] }), true)
  assert.equal(hasSnapshotData({ debts: [{ id: 'prefs:theme', kind: 'prefs' }] }), false)
})

test('auto sync coordinator debounces changes into one flush', async () => {
  const timers = new Map()
  let nextTimer = 1
  let runs = 0
  const coordinator = createAutoSyncCoordinator({
    delay: 1200,
    run: async () => { runs++ },
    setTimer(fn) { const id = nextTimer++; timers.set(id, fn); return id },
    clearTimer(id) { timers.delete(id) }
  })

  coordinator.schedule()
  coordinator.schedule()
  assert.equal(timers.size, 1)
  const callback = [...timers.values()][0]
  await callback()
  assert.equal(runs, 1)
})

test('auto sync coordinator retries a failed flush', async () => {
  const timers = []
  let runs = 0
  const coordinator = createAutoSyncCoordinator({
    delay: 0,
    retryDelay: 30,
    run: async () => {
      runs++
      if (runs === 1) throw new Error('offline')
    },
    setTimer(fn, delay) { timers.push({ fn, delay }); return timers.length },
    clearTimer() {}
  })

  const first = coordinator.flush()
  await first
  assert.equal(runs, 1)
  assert.equal(timers.some(timer => timer.delay === 30), true)
})

test('writing the ledger states the client schema, and stays JSON', async () => {
  const calls = []
  const client = createClient({
    fetchImpl: async (url, options) => {
      calls.push(options)
      return jsonResponse(200, { status: 'ok', revision: 3 })
    }
  })

  await client.writeSnapshot('ledger-1', { baseRevision: 2, entries: [] })
  await client.readSnapshot('ledger-1')

  assert.equal(calls[0].method, 'PUT')
  assert.equal(calls[0].headers['X-Touji-Schema'], String(SCHEMA_VERSION))
  assert.equal(calls[0].headers['Content-Type'], 'application/json')
  assert.equal(calls[0].credentials, 'include')
  assert.equal(calls[1].headers['X-Touji-Schema'], undefined)
})

test('the newer copy of a record wins; at the same moment missing fields are filled in', () => {
  const full = { id: 'e1', amount: 500, channel: 'alipay', counterparty: '海上生明月', updatedAt: 10 }
  // what an old page left in local storage: same save, fields it never knew stripped
  const stripped = { id: 'e1', amount: 500, updatedAt: 10 }

  assert.deepEqual(mergeRecord(stripped, full), full)
  assert.deepEqual(mergeRecord(full, stripped), full)
  // a real edit carries a newer timestamp and is taken as it is, cleared fields included
  const edited = { id: 'e1', amount: 600, updatedAt: 11 }
  assert.equal(mergeRecord(edited, full), edited)
  assert.equal(mergeRecord(full, edited), edited)
  assert.equal(mergeRecord(null, full), full)
  assert.equal(mergeRecord(full, undefined), full)
})

test('being sent to a login page counts as signed out, not as a network failure', async () => {
  const seen = []
  const redirected = createClient({
    fetchImpl: async (url, options) => {
      seen.push(options.redirect)
      return { ok: false, status: 0, type: 'opaqueredirect', headers: { get: () => null } }
    }
  })
  await assert.rejects(() => redirected.me(), error => error.code === 'UNAUTHENTICATED' && error.status === 401)
  assert.deepEqual(seen, ['manual'])

  const found = createClient({ fetchImpl: async () => ({ ok: false, status: 302, headers: { get: () => null } }) })
  await assert.rejects(() => found.readSnapshot('ledger-1'), error => error.code === 'UNAUTHENTICATED')
})

test('a session check that hangs gives up, and is not mistaken for being signed out', async () => {
  const hanging = createClient({
    fetchImpl: (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')))
    })
  })
  await assert.rejects(() => hanging.me({ timeoutMs: 20 }), error => error.code === 'SERVER_TIMEOUT' && error.code !== 'UNAUTHENTICATED')
})
