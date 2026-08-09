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
