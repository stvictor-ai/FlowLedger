import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { createApp } from '../src/app.js'
import { amountCNY, summarise, toCashflow } from '../src/modules/feed/cashflow.js'
import { createFeedService } from '../src/modules/feed/service.js'
import { createTokenService } from '../src/modules/tokens/service.js'
import { hashSecret } from '../src/modules/auth/tokens.js'

const require = createRequire(import.meta.url)
// The client copy, loaded straight from the repo. The server image does not
// ship it, which is exactly why this test exists.
const clientEngine = require('../../js/entry-engine.js')

const USER_ID = 'user-1'
const LEDGER_ID = '11111111-1111-4111-8111-111111111111'
const PEPPER = 'test-pepper'

function entry(overrides = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    type: '入金',
    amount: 1000,
    currency: 'CNY',
    date: '2026-05-01',
    time: '10:00',
    exchange: '欧易',
    assetType: '加密货币',
    note: '',
    tags: [],
    ...overrides
  }
}

function memoryTokenRepository(entries = []) {
  const tokens = new Map()
  return {
    tokens,
    repository: {
      async findActiveByHash(hash) {
        const found = [...tokens.values()].find(t => t.tokenHash === hash && !t.revokedAt)
        if (!found) return null
        return {
          id: found.id,
          userId: found.userId,
          ledgerId: found.ledgerId,
          scope: found.scope,
          name: found.name,
          ledger: { id: LEDGER_ID, name: '我的账本', revision: 40, updatedAt: new Date(0) }
        }
      },
      async touch() {},
      async list() { return [...tokens.values()] },
      async countActive() { return [...tokens.values()].filter(t => !t.revokedAt).length },
      async findLedger() { return { id: LEDGER_ID, name: '我的账本' } },
      async firstLedger() { return { id: LEDGER_ID, name: '我的账本' } },
      async create(record) {
        const row = { ...record, id: `tok-${tokens.size + 1}`, createdAt: new Date(), revokedAt: null }
        tokens.set(row.id, row)
        return row
      },
      async revoke({ id }) {
        const row = tokens.get(id)
        if (!row || row.revokedAt) return false
        row.revokedAt = new Date()
        return true
      }
    },
    feedRepository: {
      async readEntries() { return structuredClone(entries) }
    }
  }
}

async function startApp(entries) {
  const memory = memoryTokenRepository(entries)
  const tokenService = createTokenService({ repository: memory.repository, pepper: PEPPER })
  const feedService = createFeedService({ repository: memory.feedRepository })
  const app = createApp({
    feedService,
    tokenService,
    config: { appOrigin: 'http://127.0.0.1:8787', isProduction: false }
  })
  const server = app.listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const created = await tokenService.create({ userId: USER_ID, name: '交易台' })
  return { base, token: created.token, server, memory }
}

test('cash flow conversion matches the client engine', () => {
  const cases = [
    entry({ type: '入金', amount: 1000, currency: 'CNY' }),
    entry({ type: '出金', amount: 500, currency: 'CNY' }),
    entry({ type: '入金', amount: 100, currency: 'USD', rate: 7.25 }),
    entry({ type: '出金', amount: 80, currency: 'HKD', rate: 0.92 }),
    // No rate recorded: both sides must fall back the same way.
    entry({ type: '入金', amount: 200, currency: 'USD' }),
    // Foreign deposit paid in CNY — the source amount wins over amount * rate.
    entry({ type: '入金', amount: 100, currency: 'USDT', rate: 7.1, sourceCurrency: 'CNY', sourceAmount: 720 }),
    entry({ type: '出金', amount: 50, currency: 'USDT', rate: 7.1, targetCurrency: 'CNY', targetAmount: 360 }),
    entry({ type: '入金', amount: 0, currency: 'CNY' })
  ]

  for (const row of cases) {
    assert.equal(
      amountCNY(row),
      clientEngine.amountCNY(row),
      `diverged for ${JSON.stringify(row)}`
    )
  }
})

test('feed requires a bearer token', async () => {
  const { base, server } = await startApp([])
  try {
    const anonymous = await fetch(`${base}/api/v1/feed/cashflows`)
    assert.equal(anonymous.status, 401)
    assert.match(anonymous.headers.get('www-authenticate') || '', /Bearer/)

    const wrong = await fetch(`${base}/api/v1/feed/cashflows`, {
      headers: { authorization: 'Bearer tjk_not-a-real-token-value-at-all' }
    })
    assert.equal(wrong.status, 401)
    assert.equal((await wrong.json()).error, 'INVALID_TOKEN')
  } finally {
    server.close()
  }
})

test('feed returns cash flows with totals and no-store', async () => {
  const { base, token, server } = await startApp([
    entry({ type: '入金', amount: 30000, date: '2026-04-18' }),
    entry({ type: '出金', amount: 9000, date: '2026-05-20' }),
    entry({ type: '买入', amount: 5000, date: '2026-05-21' }),
    entry({ type: '入金', amount: 100, currency: 'USD', rate: 7.25, date: '2026-06-02' })
  ])
  try {
    const response = await fetch(`${base}/api/v1/feed/cashflows`, {
      headers: { authorization: `Bearer ${token}` }
    })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('cache-control') || '', /no-store/)

    const body = await response.json()
    // Trades stay out unless asked for.
    assert.equal(body.cashflows.length, 3)
    assert.deepEqual(body.cashflows.map(row => row.direction), ['in', 'out', 'in'])
    assert.equal(body.summary.totalIn, 30725)
    assert.equal(body.summary.totalOut, 9000)
    assert.equal(body.summary.net, 21725)
    assert.equal(body.ledger.id, LEDGER_ID)
    assert.equal(body.currency, 'CNY')
  } finally {
    server.close()
  }
})

test('feed filters by date and can include trades', async () => {
  const { base, token, server } = await startApp([
    entry({ type: '入金', amount: 1000, date: '2026-01-05' }),
    entry({ type: '入金', amount: 2000, date: '2026-06-05' }),
    entry({ type: '卖出', amount: 3000, date: '2026-06-06' })
  ])
  try {
    const filtered = await (await fetch(`${base}/api/v1/feed/cashflows?since=2026-06-01`, {
      headers: { authorization: `Bearer ${token}` }
    })).json()
    assert.equal(filtered.cashflows.length, 1)
    assert.equal(filtered.summary.totalIn, 2000)

    const withTrades = await (await fetch(`${base}/api/v1/feed/cashflows?since=2026-06-01&include=all`, {
      headers: { authorization: `Bearer ${token}` }
    })).json()
    assert.equal(withTrades.cashflows.length, 2)
    // A trade carries no direction, so it must not move the cash totals.
    assert.equal(withTrades.summary.totalIn, 2000)
    assert.equal(withTrades.summary.totalOut, 0)

    const bad = await fetch(`${base}/api/v1/feed/cashflows?since=2026-06-01&until=2026-01-01`, {
      headers: { authorization: `Bearer ${token}` }
    })
    assert.equal(bad.status, 400)
  } finally {
    server.close()
  }
})

test('a revoked token stops working', async () => {
  const { base, token, server, memory } = await startApp([entry()])
  try {
    const before = await fetch(`${base}/api/v1/feed/cashflows`, {
      headers: { authorization: `Bearer ${token}` }
    })
    assert.equal(before.status, 200)

    const [row] = [...memory.tokens.values()]
    row.revokedAt = new Date()

    const after = await fetch(`${base}/api/v1/feed/cashflows`, {
      headers: { authorization: `Bearer ${token}` }
    })
    assert.equal(after.status, 401)
  } finally {
    server.close()
  }
})

test('the token is stored only as a hash', async () => {
  const memory = memoryTokenRepository([])
  const tokenService = createTokenService({ repository: memory.repository, pepper: PEPPER })
  const created = await tokenService.create({ userId: USER_ID, name: '交易台' })

  const [stored] = [...memory.tokens.values()]
  assert.equal(stored.tokenHash, hashSecret(created.token, PEPPER))
  assert.notEqual(stored.tokenHash, created.token)
  assert.equal(JSON.stringify(stored).includes(created.token), false)
  // The prefix is for telling tokens apart in a list, not for guessing them.
  assert.ok(created.token.startsWith(stored.prefix))
  assert.ok(stored.prefix.length <= 12)
})

test('summary counts only what was returned', () => {
  const rows = [
    toCashflow(entry({ type: '入金', amount: 100 })),
    toCashflow(entry({ type: '出金', amount: 40 })),
    toCashflow(entry({ type: '买入', amount: 999 }))
  ]
  const summary = summarise(rows)
  assert.equal(summary.count, 3)
  assert.equal(summary.totalIn, 100)
  assert.equal(summary.totalOut, 40)
  assert.equal(summary.net, 60)
})
