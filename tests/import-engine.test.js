const test = require('node:test')
const assert = require('node:assert/strict')
const ImportEngine = require('../js/import-engine.js')

const keyOf = entry => [
  entry.date,
  entry.type,
  entry.exchange,
  entry.currency,
  entry.amount,
  entry.rate
].join('|')

const repeatedDeposit = {
  date: '2026-02-28',
  type: '入金',
  exchange: '欧易',
  currency: 'CNY',
  amount: 500,
  rate: 7.03
}

test('preserves two intentional identical rows when neither exists', () => {
  const incoming = [
    { ...repeatedDeposit, id: 'incoming-1' },
    { ...repeatedDeposit, id: 'incoming-2' }
  ]

  const result = ImportEngine.classifyOccurrences([], incoming, { source: 'Excel', keyOf })

  assert.deepEqual(result.map(row => row.kind), ['new', 'new'])
})

test('imports the missing occurrence when one of two identical rows exists', () => {
  const existing = [{ ...repeatedDeposit, id: 'existing-1' }]
  const incoming = [
    { ...repeatedDeposit, id: 'incoming-1' },
    { ...repeatedDeposit, id: 'incoming-2' }
  ]

  const result = ImportEngine.classifyOccurrences(existing, incoming, { source: 'Excel', keyOf })

  assert.deepEqual(result.map(row => row.kind), ['duplicate', 'new'])
})

test('skips both rows when both identical occurrences already exist', () => {
  const existing = [
    { ...repeatedDeposit, id: 'existing-1' },
    { ...repeatedDeposit, id: 'existing-2' }
  ]
  const incoming = [
    { ...repeatedDeposit, id: 'incoming-1' },
    { ...repeatedDeposit, id: 'incoming-2' }
  ]

  const result = ImportEngine.classifyOccurrences(existing, incoming, { source: 'Excel', keyOf })

  assert.deepEqual(result.map(row => row.kind), ['duplicate', 'duplicate'])
})

test('JSON rows still update by id when their content changed', () => {
  const existing = [{ ...repeatedDeposit, id: 'same-id' }]
  const incoming = [{ ...repeatedDeposit, id: 'same-id', amount: 600 }]

  const result = ImportEngine.classifyOccurrences(existing, incoming, { source: 'JSON', keyOf })

  assert.equal(result[0].kind, 'update')
  assert.equal(result[0].isUpdate, true)
})
