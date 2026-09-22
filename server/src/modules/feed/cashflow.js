/**
 * Cash-flow shaping for the read-only feed.
 *
 * amountCNY mirrors js/entry-engine.js exactly. The server image does not ship
 * the client bundle, so the rule lives in both places; test/feed.test.js loads
 * the client copy and asserts the two agree over a fixture set, which is what
 * keeps them from drifting apart.
 */

const CASH_TYPES = new Map([
  ['入金', 'in'],
  ['出金', 'out']
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

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Machine-readable first, with the original Chinese kept alongside. */
export function toCashflow(entry) {
  const direction = CASH_TYPES.get(entry.type) || TRADE_TYPES.get(entry.type) || 'other'
  return {
    id: String(entry.id || ''),
    date: String(entry.date || '').slice(0, 10),
    time: String(entry.time || '') || null,
    direction,
    type: String(entry.type || ''),
    amount: round2(number(entry.amount)),
    currency: String(entry.currency || 'CNY').toUpperCase(),
    amountCNY: round2(amountCNY(entry)),
    platform: String(entry.exchange || entry.platform || '') || null,
    assetType: String(entry.assetType || '') || null,
    note: String(entry.note || '') || null,
    tags: Array.isArray(entry.tags) ? entry.tags.map(String) : []
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
 * paid in minus taken out.
 */
export function summarise(rows) {
  let totalIn = 0
  let totalOut = 0
  for (const row of rows) {
    if (row.direction === 'in') totalIn += row.amountCNY
    else if (row.direction === 'out') totalOut += row.amountCNY
  }
  return {
    count: rows.length,
    totalIn: round2(totalIn),
    totalOut: round2(totalOut),
    net: round2(totalIn - totalOut)
  }
}

export function sortByMoment(rows) {
  return [...rows].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date)
    if (byDate) return byDate
    return String(a.time || '').localeCompare(String(b.time || ''))
  })
}
