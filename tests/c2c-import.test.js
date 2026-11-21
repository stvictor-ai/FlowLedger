const assert = require('node:assert/strict')
const test = require('node:test')
const C2C = require('../js/c2c-import.js')
const Entry = require('../js/entry-engine.js')

// 版式照着交易所 C2C 订单列表，商家名和数字都是虚构的。
// 本地 OCR 的输出：一行里左右两栏挤在一起，头像和徽章变成乱码。
const OCR_TEXT = `
12:18                                  0 全 到
《                           订单                     企 Q
未完成 ”已结束                                        Y
全部     已完成     已取消
出售 USDT                                          交易完成 》
2026/09/12 12:11
价格 6.9 CNY                                            690 CNY
数量 100 USDT
青山不老88 Wo 墨江结贴付                                     区
购买 USDT                                          交易完成 》
2026/09/10 22:31
价格 6.85 CNY                                           800 CNY
数量 116.78 USDT
海上生明月 侈 韦 ”新手友好                           加|
购买 USDT                                          已取消 》
2026/09/09 08:00
价格 6.84 CNY                                           300 CNY
数量 43.85 USDT
一叶知秋、W                                                   四
购买和”~”                           5 >
价格 2            Se            E             _NY
数量 74.62 USDT
`

// 手机「复制截图中的文字」粘贴进来：每段文字各占一行，金额跑到价格后面。
const PASTED_TEXT = `出售 USDT
交易完成
2026/09/12 12:11
价格
6.9 CNY
690 CNY
数量 100 USDT
青山不老88
冻结赔付
购买 USDT
交易完成
2026/09/10 22:31
价格 6.85 CNY
800 CNY
数量 116.78 USDT
海上生明月
新手友好`

test('reads orders out of OCR text, noise and all', () => {
  const { orders, incomplete } = C2C.parseOrders(OCR_TEXT)
  assert.equal(incomplete, 0)
  assert.deepEqual(orders.map(o => [o.side, o.coin, o.date, o.time, o.price, o.quantity, o.total, o.counterparty, o.status]), [
    ['sell', 'USDT', '2026-09-12', '12:11', 6.9, 100, 690, '青山不老88', 'done'],
    ['buy', 'USDT', '2026-09-10', '22:31', 6.85, 116.78, 800, '海上生明月', 'done'],
    ['buy', 'USDT', '2026-09-09', '08:00', 6.84, 43.85, 300, '一叶知秋', 'cancelled']
  ])
  assert.ok(orders.every(o => o.issues.length === 0))
})

test('reads the same orders from pasted text, where every fragment is its own line', () => {
  const { orders } = C2C.parseOrders(PASTED_TEXT)
  assert.deepEqual(orders.map(o => [o.side, o.price, o.quantity, o.total, o.counterparty]), [
    ['sell', 6.9, 100, 690, '青山不老88'],
    ['buy', 6.85, 116.78, 800, '海上生明月']
  ])
})

test('a dropped decimal point is put back when the other two numbers pin it down', () => {
  const { orders } = C2C.parseOrders('出 售 UsDT 交 易 完 成\n2026/09/12 12:11\n价 格 69 CNY 690 CNY\n数 量 100 USDT')
  assert.equal(orders[0].price, 6.9)
  assert.equal(orders[0].coin, 'USDT')
  assert.deepEqual(orders[0].issues, ['price-corrected'])
})

test('numbers that cannot be reconciled are flagged, and a missing one is computed', () => {
  const bad = C2C.parseOrders('购买 USDT 交易完成\n2026/09/12 12:11\n价格 6.9 CNY 500 CNY\n数量 100 USDT').orders[0]
  assert.deepEqual(bad.issues, ['mismatch'])
  const partial = C2C.parseOrders('购买 USDT 交易完成\n2026/09/12 12:11\n价格 6.9 CNY\n数量 100 USDT').orders[0]
  assert.equal(partial.total, 690)
  assert.deepEqual(partial.issues, ['total-computed'])
})

test('an order cut off by the edge of the screenshot is counted, not guessed', () => {
  const result = C2C.parseOrders('购买 USDT 交易完成\n数量 74.62 USDT')
  assert.equal(result.orders.length, 0)
  assert.equal(result.incomplete, 1)
})

test('overlapping screenshots do not import the same order twice', () => {
  const { orders } = C2C.parseOrders(PASTED_TEXT + '\n' + PASTED_TEXT)
  assert.equal(orders.length, 2)
})

test('thousands separators and a comma read as a decimal point', () => {
  assert.equal(C2C.parseNumber('1,200.50'), 1200.5)
  assert.equal(C2C.parseNumber('12,000'), 12000)
  assert.equal(C2C.parseNumber('6,85'), 6.85)
})

test('orders fill in existing CNY-only records instead of duplicating them', () => {
  const { orders } = C2C.parseOrders(PASTED_TEXT + `
购买 USDT 交易完成
2026/09/08 01:54
价格 6.8 CNY 500 CNY
数量 73.53 USDT
购买 USDT 交易完成
2026/09/01 10:00
价格 6.8 CNY 400 CNY
数量 58.82 USDT`)
  const entries = [
    // 只记了人民币的老记录：同类型、同金额、同一天 → 补全
    { id: 'old-sell', type: '出金', date: '2026-09-12', amount: 690, currency: 'CNY' },
    // 已经带数量的 → 重复
    { id: 'done', type: '入金', date: '2026-09-10', time: '22:31', ...Entry.fxFields('入金', { cny: 800, units: 116.78, unit: 'USDT', rate: 6.85 }) },
    // 凌晨的订单被记在了前一天 → 放宽一天，并标出来
    { id: 'late', type: '入金', date: '2026-09-07', amount: 500, currency: 'CNY' },
    // 金额相同但类型不对，不能配
    { id: 'wrong-type', type: '出金', date: '2026-09-01', amount: 400, currency: 'CNY' }
  ]
  const matches = C2C.matchOrders(orders, entries, Entry)
  assert.deepEqual(matches.map(m => [m.kind, m.entryId, m.nearDate]), [
    ['enrich', 'old-sell', false],
    ['duplicate', 'done', false],
    ['enrich', 'late', true],
    ['new', null, false]
  ])
})

test('two same-day orders of the same amount pair with two records, never the same one', () => {
  const text = ['09:00', '21:00'].map(t => `购买 USDT 交易完成\n2026/09/05 ${t}\n价格 6.8 CNY 500 CNY\n数量 73.53 USDT`).join('\n')
  const entries = [
    { id: 'evening', type: '入金', date: '2026-09-05', time: '21:00', amount: 500, currency: 'CNY' },
    { id: 'untimed', type: '入金', date: '2026-09-05', amount: 500, currency: 'CNY' }
  ]
  const matches = C2C.matchOrders(C2C.parseOrders(text).orders, entries, Entry)
  assert.deepEqual(matches.map(m => m.entryId), ['untimed', 'evening'])
})
