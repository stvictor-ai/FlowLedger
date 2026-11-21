const assert = require('node:assert/strict')
const test = require('node:test')
const EntryEngine = require('../js/entry-engine.js')

test('normalizes minute-level time without changing legacy blank values', () => {
  assert.equal(EntryEngine.normalizeTime('9:05'), '09:05')
  assert.equal(EntryEngine.normalizeTime('2026-08-09T18:42:30+08:00'), '18:42')
  assert.equal(EntryEngine.normalizeTime(''), '')
  assert.equal(EntryEngine.normalizeTime('25:00'), '')
})

test('sorts entries by date and time while treating legacy rows as midnight', () => {
  const rows = [
    { id: 'legacy', date: '2026-08-09' },
    { id: 'morning', date: '2026-08-09', time: '09:30' },
    { id: 'yesterday', date: '2026-08-08', time: '23:59' }
  ]

  assert.deepEqual(rows.sort(EntryEngine.compareEntriesDesc).map(row => row.id), [
    'morning',
    'legacy',
    'yesterday'
  ])
})

test('calculates target currency from the actual per-entry exchange rate', () => {
  assert.equal(EntryEngine.targetAmount(500, 6.74), 74.18397626)
  assert.equal(EntryEngine.targetAmount(500, 6.7), 74.62686567)
})

test('uses exact CNY paid amount for converted deposits', () => {
  const first = {
    type: '入金',
    amount: 74.18397626,
    currency: 'USDT',
    rate: 6.74,
    sourceAmount: 500,
    sourceCurrency: 'CNY',
    targetAmount: 74.18397626,
    targetCurrency: 'USDT'
  }
  const second = { ...first, amount: 74.62686567, targetAmount: 74.62686567, rate: 6.7 }

  assert.equal(EntryEngine.amountCNY(first), 500)
  assert.equal(EntryEngine.amountCNY(second), 500)
  assert.equal(EntryEngine.amountCNY(first) + EntryEngine.amountCNY(second), 1000)
  assert.equal(EntryEngine.isFxEntry(first), true)
})

test('keeps legacy foreign-currency valuation behavior', () => {
  assert.equal(EntryEngine.amountCNY({ amount: 100, currency: 'USD', rate: 7.2 }), 720)
  assert.equal(EntryEngine.amountCNY({ amount: 100, currency: 'CNY' }), 100)
})

test('a C2C sale is the mirror of a purchase: same three numbers, CNY on the receiving side', () => {
  const buy = { type: '入金', ...EntryEngine.fxFields('入金', { cny: 500, units: 74.85, unit: 'usdt', rate: 6.68 }) }
  const sell = { type: '出金', ...EntryEngine.fxFields('出金', { cny: 600, units: 89.55, unit: 'USDT', rate: 6.7 }) }

  assert.equal(buy.sourceCurrency, 'CNY')
  assert.equal(buy.amount, 74.85)
  assert.equal(EntryEngine.amountCNY(buy), 500)
  assert.equal(sell.targetCurrency, 'CNY')
  assert.equal(sell.sourceAmount, 89.55)
  assert.equal(EntryEngine.amountCNY(sell), 600)
  assert.deepEqual(EntryEngine.fxParts(sell), { cny: 600, units: 89.55, unit: 'USDT', rate: 6.7 })
  assert.deepEqual(EntryEngine.fxParts(buy), { cny: 500, units: 74.85, unit: 'USDT', rate: 6.68 })
  assert.equal(EntryEngine.fxParts({ type: '入金', amount: 500, currency: 'CNY' }), null)
})

test('any two of amount, price and quantity give the third', () => {
  assert.equal(EntryEngine.solveFx({ cny: 600, rate: 6.7 }, 'units'), 89.552239)
  assert.equal(EntryEngine.solveFx({ cny: 600, units: 89.55 }, 'rate'), 6.700168)
  assert.equal(EntryEngine.solveFx({ rate: 6.7, units: 89.55 }, 'cny'), 599.99)
  assert.equal(EntryEngine.solveFx({ cny: 600 }, 'units'), 0)
})

test('payment channels accept the key or the Chinese label', () => {
  assert.equal(EntryEngine.normalizeChannel('支付宝'), 'alipay')
  assert.equal(EntryEngine.normalizeChannel('bank'), 'bank')
  assert.equal(EntryEngine.normalizeChannel('现金'), '')
})
