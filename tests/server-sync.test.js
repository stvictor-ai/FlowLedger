const assert = require('node:assert/strict')
const test = require('node:test')
const {
  ServerSyncError,
  createAutoSyncCoordinator,
  createClient,
  hasSnapshotData,
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
      { type: '入金', amount: 100, currency: 'USD', rate: 7.2 },
      { type: '出金', amount: 200, currency: 'CNY' }
    ],
    positions: [{ id: 'position-1' }],
    deletedIds: { old: 1 },
    deletedPositionIds: { gone: 2 }
  })

  assert.deepEqual(summary, {
    entries: 2,
    positions: 1,
    totalIn: 720,
    totalOut: 200,
    deleted: 2
  })
  assert.equal(hasSnapshotData({ entries: [], positions: [] }), false)
  assert.equal(hasSnapshotData({ entries: [{ id: 'entry-1' }] }), true)
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
