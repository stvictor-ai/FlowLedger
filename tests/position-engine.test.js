const assert = require('node:assert/strict')
const test = require('node:test')
const Positions = require('../js/position-engine.js')

const cny = () => 1
let stamp = 0
const trade = (id, type, date, qty, price, extra = {}) => ({ id, type, date, time: '10:00', tradeQty: qty, tradePrice: price, currency: 'CNY', updatedAt: ++stamp, ...extra })

test('replaying buys and sells gives the weighted average cost and each sale’s profit', () => {
  const result = Positions.replay([
    trade('b1', '买入', '2026-01-05', 100, 10),
    trade('b2', '买入', '2026-02-05', 100, 20),
    trade('s1', '卖出', '2026-03-05', 50, 30)
  ], cny)
  assert.equal(result.ok, true)
  assert.equal(result.qty, 150)
  assert.equal(result.avgCost, 15)
  assert.equal(result.realized.s1, 750)
})

test('deleting a buy that was followed by a sale rebuilds the cost instead of subtracting backwards', () => {
  const b1 = trade('b1', '买入', '2026-01-05', 100, 10)
  const b2 = trade('b2', '买入', '2026-02-05', 100, 20)
  const s1 = trade('s1', '卖出', '2026-03-05', 50, 30)
  const position = { qty: 150, avgCost: 15, costRate: 1 }
  const result = Positions.removeBuy(position, [b1, b2, s1], b2, cny)
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'replay')
  assert.equal(result.qty, 50)
  // 倒着减会得到 (150×15 − 100×20) / 50 = 5，真正的成本是剩下那笔买入的 10
  assert.equal(result.avgCost, 10)
  // 那笔卖出的盈亏也要跟着变：(30 − 10) × 50
  assert.equal(result.realized.s1, 1000)
})

test('a buy cannot be deleted when a later sale would have nothing left to sell', () => {
  const b1 = trade('b1', '买入', '2026-01-05', 100, 10)
  const s1 = trade('s1', '卖出', '2026-03-05', 80, 12)
  const result = Positions.removeBuy({ qty: 20, avgCost: 10, costRate: 1 }, [b1, s1], b1, cny)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'oversold')
  assert.equal(result.shortEntryId, 's1')
})

test('deleting the only buy leaves an empty position to clean up', () => {
  const b1 = trade('b1', '买入', '2026-01-05', 100, 10)
  const result = Positions.removeBuy({ qty: 100, avgCost: 10, costRate: 1 }, [b1], b1, cny)
  assert.equal(result.ok, true)
  assert.equal(result.qty, 0)
  assert.equal(result.empty, true)
})

test('a position that still has trades is kept at zero rather than removed', () => {
  const b1 = trade('b1', '买入', '2026-01-05', 100, 10)
  const b2 = trade('b2', '买入', '2026-01-06', 100, 20)
  const s1 = trade('s1', '卖出', '2026-03-05', 100, 30)
  const result = Positions.removeBuy({ qty: 100, avgCost: 15, costRate: 1 }, [b1, b2, s1], b2, cny)
  assert.equal(result.ok, true)
  assert.equal(result.qty, 0)
  assert.equal(result.empty, false)
  assert.equal(result.realized.s1, 2000)
})

test('a hand-made position: subtracting is exact when nothing was sold after the buy', () => {
  // 手动建的持仓 200 股成本 8，之后买入 100 股 @ 14 → 300 股成本 10
  const b1 = trade('b1', '买入', '2026-02-05', 100, 14)
  const result = Positions.removeBuy({ qty: 300, avgCost: 10, costRate: 1 }, [b1], b1, cny)
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'arithmetic')
  assert.equal(result.qty, 200)
  assert.equal(result.avgCost, 8)
})

test('a hand-made position with a sale after the buy is left for the owner to sort out', () => {
  const b1 = trade('b1', '买入', '2026-02-05', 100, 14)
  const s1 = trade('s1', '卖出', '2026-03-05', 50, 20)
  const result = Positions.removeBuy({ qty: 250, avgCost: 10, costRate: 1 }, [b1, s1], b1, cny)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'manual')
})

test('profit on a foreign-currency sale is counted in CNY at each trade’s own rate', () => {
  const rateOf = entry => entry.rate
  const result = Positions.replay([
    trade('b1', '买入', '2026-01-05', 10, 100, { currency: 'USD', rate: 7 }),
    trade('s1', '卖出', '2026-03-05', 10, 110, { currency: 'USD', rate: 7.2 })
  ], rateOf)
  // 卖出 110 × 7.2 − 成本 100 × 7，每股 92，共 10 股
  assert.equal(result.realized.s1, 920)
  assert.equal(result.qty, 0)
})
