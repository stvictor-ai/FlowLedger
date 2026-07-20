const test = require('node:test')
const assert = require('node:assert/strict')
const ReviewEngine = require('../js/review-engine.js')

const entries = [
  { id: 'cash-1', date: '2026-07-01', type: '入金', amountCNY: 12000, exchange: '示例证券', tags: [] },
  { id: 'buy-1', date: '2026-07-02', type: '买入', amountCNY: 1000, targetName: '示例资产 A', tags: ['FOMO'] },
  { id: 'buy-2', date: '2026-07-05', type: '买入', amountCNY: 1500, targetName: '示例资产 A', tags: [] },
  { id: 'buy-3', date: '2026-07-07', type: '买入', amountCNY: 2000, targetName: '示例资产 B', tags: [] },
  { id: 'sell-1', date: '2026-07-08', type: '卖出', amountCNY: 1800, realizedPL: -500, targetName: '示例资产 A', tags: ['止损'] }
]

const positions = [
  { id: 'position-a', symbol: 'AAA', name: '示例资产 A', value: 7000 },
  { id: 'position-b', symbol: 'BBB', name: '示例资产 B', value: 3000 }
]

const rules = {
  largeCashflow: 5000,
  denseBuyCount: 3,
  denseBuyDays: 7,
  concentrationPct: 60
}

test('buildSignals returns explainable local rule signals', () => {
  const signals = ReviewEngine.buildSignals(entries, positions, rules, '2026-07-20')
  const types = signals.map(signal => signal.type)

  assert.ok(types.includes('large-cashflow'))
  assert.ok(types.includes('fomo'))
  assert.ok(types.includes('dense-buy'))
  assert.ok(types.includes('loss-sell'))
  assert.ok(types.includes('concentration'))

  const dense = signals.find(signal => signal.type === 'dense-buy')
  assert.equal(dense.date, '2026-07-07')
  assert.deepEqual(dense.entryIds, ['buy-1', 'buy-2', 'buy-3'])
  assert.match(dense.reason, /7 天内完成 3 次买入/)

  const concentration = signals.find(signal => signal.type === 'concentration')
  assert.equal(concentration.date, '2026-07-20')
  assert.match(concentration.reason, /70\.0%/)
})

test('buildCalendarMonth creates a Sunday-first month grid', () => {
  const signals = ReviewEngine.buildSignals(entries, positions, rules, '2026-07-20')
  const calendar = ReviewEngine.buildCalendarMonth(
    '2026-07',
    entries,
    signals,
    ['2026-07-08'],
    '2026-07-20'
  )

  assert.equal(calendar.monthKey, '2026-07')
  assert.equal(calendar.cells.length, 35)
  assert.equal(calendar.cells[3].date, '2026-07-01')
  assert.equal(calendar.cells[3].inMonth, true)
  assert.equal(calendar.cells[10].date, '2026-07-08')
  assert.equal(calendar.cells[10].hasNote, true)
  assert.equal(calendar.cells[22].date, '2026-07-20')
  assert.equal(calendar.cells[22].isToday, true)
})

test('calendar cells contain entry types and attached rule signals', () => {
  const signals = ReviewEngine.buildSignals(entries, positions, rules, '2026-07-20')
  const calendar = ReviewEngine.buildCalendarMonth('2026-07', entries, signals, [], '2026-07-20')
  const sellDay = calendar.cells.find(cell => cell.date === '2026-07-08')
  const denseDay = calendar.cells.find(cell => cell.date === '2026-07-07')

  assert.deepEqual(sellDay.entryTypes, ['卖出'])
  assert.ok(sellDay.signals.some(signal => signal.type === 'loss-sell'))
  assert.ok(denseDay.signals.some(signal => signal.type === 'dense-buy'))
})

test('buildTimeline sorts entries newest first and attaches signals', () => {
  const signals = ReviewEngine.buildSignals(entries, positions, rules, '2026-07-20')
  const timeline = ReviewEngine.buildTimeline(entries, signals, 3)

  assert.equal(timeline.length, 3)
  assert.equal(timeline[0].entry.id, 'sell-1')
  assert.ok(timeline[0].signals.some(signal => signal.type === 'loss-sell'))
  assert.equal(timeline[1].entry.id, 'buy-3')
  assert.ok(timeline[1].signals.some(signal => signal.type === 'dense-buy'))
})

test('buildSignals does not mutate source entries or positions', () => {
  const entryCopy = structuredClone(entries)
  const positionCopy = structuredClone(positions)

  ReviewEngine.buildSignals(entries, positions, rules, '2026-07-20')

  assert.deepEqual(entries, entryCopy)
  assert.deepEqual(positions, positionCopy)
})
