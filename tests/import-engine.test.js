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

test('a trade is recognised as the same entry after a trip through Excel', () => {
  const { entryKey } = require('../js/import-engine.js')
  const stored = {
    id: 'a6', type: '买入', date: '2026-10-05', time: '10:00', amount: 1000, currency: 'CNY', exchange: '券商甲',
    assetType: '沪深市', note: '买入 示例股份 (600000)', tags: ['买入', '持仓:600000', '600000'],
    tradeQty: 100, tradePrice: 10, targetSymbol: '600000', targetName: '示例股份', targetMarket: '沪深市', positionId: 'P1'
  }
  // 旧版导出的文件里没有标的名称，也没有 id 和关联持仓
  const fromOldExport = { ...stored, id: 'new-id', targetName: '', targetMarket: '', positionId: '', tags: '买入，持仓:600000，600000' }
  assert.equal(entryKey(fromOldExport), entryKey(stored))
  // 数量不同就是另一笔
  assert.notEqual(entryKey({ ...stored, tradeQty: 200 }), entryKey(stored))
  assert.notEqual(entryKey({ ...stored, targetSymbol: '600001' }), entryKey(stored))
})

test('amounts that differ only in formatting are the same entry', () => {
  const { entryKey } = require('../js/import-engine.js')
  const a = { type: '入金', date: '2026-11-20', time: '10:01', amount: 3000, currency: 'CNY', exchange: '基金账户', note: '', tags: [] }
  assert.equal(entryKey({ ...a, amount: '3,000.00', rate: '', exchange: ' 基金账户 ' }), entryKey(a))
  assert.notEqual(entryKey({ ...a, amount: 3000.01 }), entryKey(a))
})
