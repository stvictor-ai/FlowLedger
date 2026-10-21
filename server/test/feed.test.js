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

function memoryTokenRepository(entries = [], debts = []) {
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
      async readEntries() { return structuredClone(entries) },
      async readDebts() { return structuredClone(debts) }
    }
  }
}

async function startApp(entries, { debts = [], scopes } = {}) {
  const memory = memoryTokenRepository(entries, debts)
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
  const created = await tokenService.create({ userId: USER_ID, name: '交易台', scopes })
  const get = path => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${created.token}` } })
  return { base, token: created.token, server, memory, get }
}

const DEBTS_SCOPES = ['cashflows:read', 'debts:read']

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
    entry({ type: '入金', amount: 0, currency: 'CNY' }),
    entry({ type: '互转', amount: 300, currency: 'USDT', rate: 7.1, exchange: '欧易', toExchange: '币安' }),
    entry({ type: '出金', amount: 3000, currency: 'CNY', destination: 'repay', loanId: 'loan-a' })
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

test('cash flow rows carry funding fields, and transfers are counted but not summed', async () => {
  const { get, server } = await startApp([
    entry({ id: 'salary', type: '入金', amount: 30000, date: '2026-04-01', fundSource: 'salary' }),
    entry({ id: 'borrowed', type: '入金', amount: 50000, date: '2026-04-02', fundSource: 'loan', loanId: 'loan-a' }),
    entry({ id: 'repaid', type: '出金', amount: 3000, date: '2026-04-10', destination: 'repay', loanId: 'loan-a' }),
    // A loan id only means something on a repayment or interest payment.
    entry({ id: 'spent', type: '出金', amount: 2000, date: '2026-04-11', destination: 'card', loanId: 'loan-a' }),
    entry({ id: 'moved', type: '互转', amount: 10000, date: '2026-04-12', exchange: '欧易', toExchange: '币安' }),
    // Unknown enum values, and a destination left over on a 入金, read as null.
    entry({ id: 'odd', type: '入金', amount: 100, date: '2026-04-13', fundSource: 'lottery', destination: 'repay' }),
    entry({ id: 'bought', type: '买入', amount: 5000, date: '2026-04-14', fundSource: 'salary' })
  ])
  try {
    const body = await (await get('/api/v1/feed/cashflows')).json()
    const byId = Object.fromEntries(body.cashflows.map(row => [row.id, row]))

    assert.deepEqual(body.cashflows.map(row => row.direction), ['in', 'in', 'out', 'out', 'transfer', 'in'])
    assert.deepEqual(body.summary, {
      count: 6,
      totalIn: 80100,
      totalOut: 5000,
      net: 75100,
      transferCount: 1
    })

    const pick = row => [row.fundSource, row.destination, row.loanId, row.toPlatform]
    assert.deepEqual(pick(byId.salary), ['salary', null, null, null])
    assert.deepEqual(pick(byId.borrowed), ['loan', null, 'loan-a', null])
    assert.deepEqual(pick(byId.repaid), [null, 'repay', 'loan-a', null])
    assert.deepEqual(pick(byId.spent), [null, 'card', null, null])
    assert.deepEqual(pick(byId.moved), [null, null, null, '币安'])
    assert.deepEqual(pick(byId.odd), [null, null, null, null])
    assert.equal(byId.moved.platform, '欧易')
    assert.equal(byId.moved.type, '互转')

    const all = await (await get('/api/v1/feed/cashflows?include=all')).json()
    assert.equal(all.cashflows.at(-1).direction, 'buy')
    assert.equal(all.cashflows.at(-1).fundSource, null)
    assert.equal(all.summary.totalIn, 80100)
    assert.equal(all.summary.transferCount, 1)
  } finally {
    server.close()
  }
})

test('summary skips transfers in the totals', () => {
  const summary = summarise([
    toCashflow(entry({ type: '入金', amount: 100 })),
    toCashflow(entry({ type: '互转', amount: 70 })),
    toCashflow(entry({ type: '出金', amount: 40 }))
  ])
  assert.deepEqual(summary, { count: 3, totalIn: 100, totalOut: 40, net: 60, transferCount: 1 })
})

test('debts need the debts:read scope', async () => {
  const { get, server } = await startApp([entry()])
  try {
    const denied = await get('/api/v1/feed/debts')
    assert.equal(denied.status, 403)
    assert.deepEqual(await denied.json(), { error: 'INSUFFICIENT_SCOPE', required: 'debts:read' })
    assert.match(denied.headers.get('www-authenticate') || '', /insufficient_scope/)

    // The same token still reads cash flows exactly as before.
    assert.equal((await get('/api/v1/feed/cashflows')).status, 200)
  } finally {
    server.close()
  }
})

test('debts merge ledger repayments into each loan and report what is left', async () => {
  const debts = [
    { id: 'debt-plan', kind: 'plan', paydayDom: 10, monthlyPlan: 4000, nudge: true, updatedAt: 1 },
    {
      id: 'loan-b', kind: 'loan', name: '车贷', lender: '银行', principal: 20000, annualRate: 0.045,
      repayType: 'bullet', interestDay: null, startDate: '2026-01-01', maturityDate: '2027-01-01',
      closedAt: null, note: '', sortOrder: 2, repayments: [], updatedAt: 1
    },
    {
      id: 'loan-a', kind: 'loan', name: '消费贷', lender: '招行', principal: 50000, annualRate: 0.03,
      repayType: 'interest_monthly', interestDay: 20, startDate: '2026-03-01', maturityDate: '2027-03-01',
      closedAt: null, note: '装修', sortOrder: 1, updatedAt: 1,
      repayments: [
        { id: 'r1', date: '2026-05-20', principal: 0, interest: 125, dueDate: '2026-05-20', source: 'salary', note: '' },
        { id: 'r2', date: '2026-03-20', principal: 1000, interest: 125, dueDate: null, source: 'savings', note: '提前还一点' }
      ]
    },
    {
      // Garbage in every field, and overpaid: must not crash or go negative.
      id: 'loan-c', kind: 'loan', name: '朋友', principal: '1000', annualRate: 'abc', repayType: 'weird',
      interestDay: 45, maturityDate: 'soon', closedAt: 'yesterday',
      repayments: [{ id: 'r3', date: '2026-02-01', principal: 1500, interest: 'x', source: 'lottery' }, 'junk', null]
    },
    { id: 'mystery', kind: 'mystery', principal: 99999 },
    { kind: 'loan', principal: 99999 },
    'not-an-object'
  ]
  const entries = [
    entry({ id: 'e-principal', type: '出金', amount: 3000, date: '2026-04-20', destination: 'repay', loanId: 'loan-a', note: '还本' }),
    // Foreign currency goes through the same amountCNY rule as the cash flows.
    entry({ id: 'e-interest', type: '出金', amount: 100, currency: 'USD', rate: 7, date: '2026-04-20', destination: 'interest', loanId: 'loan-a' }),
    entry({ id: 'e-card', type: '出金', amount: 50, date: '2026-06-01', destination: 'card', loanId: 'loan-a' }),
    entry({ id: 'e-unknown', type: '出金', amount: 999, date: '2026-06-02', destination: 'repay', loanId: 'loan-zzz' }),
    entry({ id: 'e-borrow', type: '入金', amount: 50000, date: '2026-03-01', fundSource: 'loan', loanId: 'loan-a' }),
    entry({ id: 'e-dateless', type: '出金', amount: 200, date: '', destination: 'repay', loanId: 'loan-a' })
  ]
  const { get, server } = await startApp(entries, { debts, scopes: DEBTS_SCOPES })
  try {
    const response = await get('/api/v1/feed/debts')
    assert.equal(response.status, 200)
    assert.match(response.headers.get('cache-control') || '', /no-store/)

    const body = await response.json()
    assert.equal(body.ledger.id, LEDGER_ID)
    assert.equal(body.currency, 'CNY')
    assert.deepEqual(body.plan, { paydayDom: 10, monthlyPlan: 4000 })
    // sortOrder first; a loan without one goes last.
    assert.deepEqual(body.loans.map(loan => loan.id), ['loan-a', 'loan-b', 'loan-c'])

    const [loanA, loanB, loanC] = body.loans
    assert.deepEqual(Object.keys(loanA), [
      'id', 'name', 'lender', 'principal', 'annualRate', 'repayType', 'interestDay', 'startDate',
      'maturityDate', 'closedAt', 'note', 'repaidPrincipal', 'paidInterest', 'remainingPrincipal', 'repayments'
    ])
    assert.deepEqual(loanA.repayments.map(row => row.id), ['r2', 'entry:e-principal', 'entry:e-interest', 'r1'])
    assert.deepEqual(loanA.repayments[0], {
      id: 'r2', date: '2026-03-20', principal: 1000, interest: 125, dueDate: null,
      source: 'savings', note: '提前还一点', entryId: null
    })
    assert.deepEqual(loanA.repayments[1], {
      id: 'entry:e-principal', date: '2026-04-20', principal: 3000, interest: 0, dueDate: null,
      source: 'ledger', note: '还本', entryId: 'e-principal'
    })
    assert.equal(loanA.repayments[2].interest, 700)
    assert.equal(loanA.repaidPrincipal, 4000)
    assert.equal(loanA.paidInterest, 950)
    assert.equal(loanA.remainingPrincipal, 46000)
    assert.equal(loanA.annualRate, 0.03)
    assert.equal(loanA.interestDay, 20)

    assert.equal(loanB.remainingPrincipal, 20000)
    assert.deepEqual(loanB.repayments, [])

    assert.equal(loanC.principal, 1000)
    assert.equal(loanC.repaidPrincipal, 1500)
    assert.equal(loanC.remainingPrincipal, 0)
    assert.equal(loanC.annualRate, 0)
    assert.equal(loanC.repayType, null)
    assert.equal(loanC.interestDay, null)
    assert.equal(loanC.maturityDate, null)
    assert.equal(loanC.closedAt, null)
    assert.deepEqual(loanC.repayments.map(row => [row.id, row.interest, row.source]), [['r3', 0, null]])

    assert.deepEqual(body.summary, {
      count: 3,
      principal: 71000,
      repaidPrincipal: 5500,
      paidInterest: 950,
      remainingPrincipal: 66000
    })

    const bad = await get('/api/v1/feed/debts?since=2026-01-01')
    assert.equal(bad.status, 400)
    assert.equal((await bad.json()).error, 'INVALID_QUERY')
  } finally {
    server.close()
  }
})

test('debts on a ledger without any are empty, not an error', async () => {
  const { get, server } = await startApp([], { scopes: DEBTS_SCOPES })
  try {
    const body = await (await get('/api/v1/feed/debts')).json()
    assert.equal(body.plan, null)
    assert.deepEqual(body.loans, [])
    assert.deepEqual(body.summary, { count: 0, principal: 0, repaidPrincipal: 0, paidInterest: 0, remainingPrincipal: 0 })
  } finally {
    server.close()
  }
})

test('feed index lists only what the token may call', async () => {
  const plain = await startApp([])
  const wide = await startApp([], { scopes: DEBTS_SCOPES })
  try {
    const plainIndex = await (await plain.get('/api/v1/feed')).json()
    assert.equal(plainIndex.scope, 'cashflows:read')
    assert.deepEqual(plainIndex.endpoints.map(endpoint => endpoint.path), ['/api/v1/feed/cashflows'])

    const wideIndex = await (await wide.get('/api/v1/feed')).json()
    assert.equal(wideIndex.scope, 'cashflows:read debts:read')
    assert.deepEqual(wideIndex.endpoints.map(endpoint => endpoint.path), [
      '/api/v1/feed/cashflows',
      '/api/v1/feed/debts'
    ])
  } finally {
    plain.server.close()
    wide.server.close()
  }
})

test('token service grants debts only on request, and never without cash flows', async () => {
  const memory = memoryTokenRepository([])
  const tokenService = createTokenService({ repository: memory.repository, pepper: PEPPER })

  const plain = await tokenService.create({ userId: USER_ID, name: '交易台' })
  assert.equal(plain.scope, 'cashflows:read')
  assert.deepEqual(plain.scopes, ['cashflows:read'])

  // Order and repeats do not matter; what is stored matches the CHECK.
  const wide = await tokenService.create({
    userId: USER_ID,
    name: 'agent',
    scopes: ['debts:read', 'cashflows:read', 'debts:read']
  })
  assert.equal(wide.scope, 'cashflows:read debts:read')
  assert.deepEqual(wide.scopes, ['cashflows:read', 'debts:read'])
  assert.equal(memory.tokens.get(wide.id).scope, 'cashflows:read debts:read')

  for (const scopes of [['debts:read'], ['cashflows:read', 'entries:write'], []]) {
    await assert.rejects(
      () => tokenService.create({ userId: USER_ID, name: 'x', scopes }),
      error => error.code === 'INVALID_SCOPE' && error.status === 400
    )
  }

  const listed = await tokenService.list(USER_ID)
  assert.deepEqual(listed.map(token => token.scopes), [['cashflows:read'], ['cashflows:read', 'debts:read']])
})

test('token routes accept scopes and report them', async () => {
  const memory = memoryTokenRepository([])
  const tokenService = createTokenService({ repository: memory.repository, pepper: PEPPER })
  const authService = {
    getSession: async token => token === 'valid-session' ? { id: USER_ID, email: 'owner@example.com' } : null
  }
  const app = createApp({
    authService,
    tokenService,
    config: { appOrigin: 'http://127.0.0.1:8787', isProduction: false }
  })
  const server = app.listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const headers = { 'Content-Type': 'application/json', Cookie: 'touji_session=valid-session' }
  const create = body => fetch(`${base}/api/v1/tokens`, { method: 'POST', headers, body: JSON.stringify(body) })
  try {
    const created = await create({ name: 'agent', scopes: ['cashflows:read', 'debts:read'] })
    assert.equal(created.status, 201)
    const body = await created.json()
    assert.equal(body.scope, 'cashflows:read debts:read')
    assert.deepEqual(body.scopes, ['cashflows:read', 'debts:read'])
    assert.ok(body.token.startsWith('tjk_'))

    const legacy = await (await create({ name: '旧面板' })).json()
    assert.deepEqual(legacy.scopes, ['cashflows:read'])

    assert.equal((await create({ name: 'x', scopes: ['debts:read'] })).status, 400)
    assert.equal((await create({ name: 'x', scopes: ['cashflows:write'] })).status, 400)
    assert.equal((await create({ name: 'x', scopes: 'cashflows:read' })).status, 400)

    const { tokens } = await (await fetch(`${base}/api/v1/tokens`, { headers })).json()
    assert.deepEqual(tokens.map(token => token.scope), ['cashflows:read debts:read', 'cashflows:read'])
    assert.ok(tokens.every(token => Array.isArray(token.scopes)))
  } finally {
    server.close()
  }
})
