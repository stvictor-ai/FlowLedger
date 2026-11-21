/**
 * Cash-flow shaping for the read-only feed.
 *
 * amountCNY mirrors js/entry-engine.js exactly. The server image does not ship
 * the client bundle, so the rule lives in both places; test/feed.test.js loads
 * the client copy and asserts the two agree over a fixture set, which is what
 * keeps them from drifting apart.
 */

// A transfer between two of the user's own platforms is cash moving, so the
// default view returns it, but it never enters or leaves the ledger — the
// totals below skip it.
const CASH_TYPES = new Map([
  ['入金', 'in'],
  ['出金', 'out'],
  ['互转', 'transfer']
])

const TRADE_TYPES = new Map([
  ['买入', 'buy'],
  ['卖出', 'sell']
])

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Keep in step with amountCNY in js/entry-engine.js. */
export function amountCNY(entry) {
  if (!entry) return 0
  if (entry.type === '入金' && String(entry.sourceCurrency || '').toUpperCase() === 'CNY' && number(entry.sourceAmount) > 0) {
    return number(entry.sourceAmount)
  }
  if (entry.type === '出金' && String(entry.targetCurrency || '').toUpperCase() === 'CNY' && number(entry.targetAmount) > 0) {
    return number(entry.targetAmount)
  }
  const amount = number(entry.amount)
  const currency = String(entry.currency || 'CNY').toUpperCase()
  const rate = number(entry.rate)
  return currency === 'CNY' ? amount : (rate > 0 ? amount * rate : amount)
}

export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

const FUND_SOURCES = new Set(['salary', 'savings', 'loan', 'other'])
const DESTINATIONS = new Set(['card', 'repay', 'interest', 'other'])
const LOAN_DESTINATIONS = new Set(['repay', 'interest'])

function enumValue(allowed, value) {
  return allowed.has(value) ? value : null
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Where the money came from or went, read only on the type it belongs to.
 * The client may leave a stale fundSource behind when a row is retyped; a
 * desk should not see a 出金 claiming to be paid from salary.
 */
function fundingOf(entry) {
  const fundSource = entry.type === '入金' ? enumValue(FUND_SOURCES, entry.fundSource) : null
  const destination = entry.type === '出金' ? enumValue(DESTINATIONS, entry.destination) : null
  const tiedToLoan = fundSource === 'loan' || LOAN_DESTINATIONS.has(destination)
  return {
    fundSource,
    destination,
    loanId: tiedToLoan ? text(entry.loanId) : null,
    toPlatform: entry.type === '互转' ? text(entry.toExchange) : null
  }
}

const CHANNELS = new Set(['alipay', 'wechat', 'bank', 'other'])

/**
 * How the money moved: the price actually paid per unit of a foreign
 * currency (a C2C USDT order has one, and a desk valuing the ledger at
 * today's rate gets a different answer), the payment channel, and who was on
 * the other side. Only cash in and out carry these.
 */
function settlementOf(entry, currency) {
  const isCash = entry.type === '入金' || entry.type === '出金'
  const units = number(entry.amount)
  const stated = number(entry.fxRate) || number(entry.rate)
  const implied = units > 0 ? amountCNY(entry) / units : 0
  const rate = stated > 0 ? stated : implied
  return {
    fxRate: isCash && currency !== 'CNY' && rate > 0 ? Math.round(rate * 1e6) / 1e6 : null,
    channel: isCash ? enumValue(CHANNELS, entry.channel) : null,
    counterparty: isCash ? text(entry.counterparty) : null
  }
}

/** Machine-readable first, with the original Chinese kept alongside. */
export function toCashflow(entry) {
  const direction = CASH_TYPES.get(entry.type) || TRADE_TYPES.get(entry.type) || 'other'
  const { fundSource, destination, loanId, toPlatform } = fundingOf(entry)
  const currency = String(entry.currency || 'CNY').toUpperCase()
  const { fxRate, channel, counterparty } = settlementOf(entry, currency)
  return {
    id: String(entry.id || ''),
    date: String(entry.date || '').slice(0, 10),
    time: String(entry.time || '') || null,
    direction,
    type: String(entry.type || ''),
    amount: round2(number(entry.amount)),
    currency,
    amountCNY: round2(amountCNY(entry)),
    fxRate,
    // For a transfer this is the platform the money left.
    platform: String(entry.exchange || entry.platform || '') || null,
    toPlatform,
    assetType: String(entry.assetType || '') || null,
    note: String(entry.note || '') || null,
    tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
    fundSource,
    destination,
    loanId,
    channel,
    counterparty
  }
}

export function isCashType(entry) {
  return CASH_TYPES.has(entry?.type)
}

export function isTradeType(entry) {
  return TRADE_TYPES.has(entry?.type)
}

/**
 * Totals over the rows actually returned, so a filtered request reports the
 * filtered window rather than the whole ledger. `net` is what is still in:
 * paid in minus taken out. Transfers only move money between the user's own
 * platforms, so they are counted but never summed.
 */
export function summarise(rows) {
  let totalIn = 0
  let totalOut = 0
  let transferCount = 0
  for (const row of rows) {
    if (row.direction === 'in') totalIn += row.amountCNY
    else if (row.direction === 'out') totalOut += row.amountCNY
    else if (row.direction === 'transfer') transferCount += 1
  }
  return {
    count: rows.length,
    totalIn: round2(totalIn),
    totalOut: round2(totalOut),
    net: round2(totalIn - totalOut),
    transferCount
  }
}

export function sortByMoment(rows) {
  return [...rows].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date)
    if (byDate) return byDate
    return String(a.time || '').localeCompare(String(b.time || ''))
  })
}
