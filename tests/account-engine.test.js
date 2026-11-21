const assert = require('node:assert/strict')
const test = require('node:test')
const Accounts = require('../js/account-engine.js')
const { amountCNY } = require('../js/entry-engine.js')

const TODAY = '2026-11-21'

function ledger() {
  return [
    { id: '1', type: '入金', date: '2026-10-02', amount: 8000, currency: 'CNY', exchange: '基金账户' },
    { id: '2', type: '入金', date: '2026-11-05', amount: 3000, currency: 'CNY', exchange: '券商甲' },
    { id: '3', type: '出金', date: '2026-11-12', amount: 2000, currency: 'CNY', exchange: '券商甲' },
    { id: '4', type: '入金', date: '2026-11-19', amount: 1500, currency: 'CNY', exchange: '平台乙' },
    { id: '5', type: '互转', date: '2026-11-20', amount: 500, currency: 'CNY', exchange: '平台乙', toExchange: '平台丙' },
    // 买卖发生在账户里面，不改变投入和取出
    { id: '6', type: '买入', date: '2026-11-20', amount: 900, currency: 'CNY', exchange: '券商甲' }
  ]
}

const balance = (account, value, asOf) => ({ id: Accounts.balanceId(account), kind: 'balance', account, value, asOf })

test('each account shows what is still in it, transfers included', () => {
  const rows = Accounts.accountRows(ledger(), [], amountCNY, TODAY)
  const byName = Object.fromEntries(rows.map(row => [row.name, row]))
  assert.equal(byName['基金账户'].net, 8000)
  assert.equal(byName['券商甲'].net, 1000)
  assert.equal(byName['平台乙'].net, 1000) // 1500 投入，转走 500
  assert.equal(byName['平台丙'].net, 500)
  assert.equal(byName['券商甲'].count, 2)
  assert.ok(rows.every(row => !row.valued && row.profit === null))
})

test('without any value filled in, nothing is called a gain or a loss', () => {
  const rows = Accounts.accountRows(ledger(), [], amountCNY, TODAY)
  const s = Accounts.summary(rows, 12500, 2000)
  assert.equal(s.currentValue, 10500)
  assert.equal(s.profit, 0)
  assert.deepEqual(s.unvalued.sort(), ['券商甲', '基金账户', '平台丙', '平台乙'].sort())
})

test('filling in what an account is worth turns into profit for it and for the whole', () => {
  const docs = [balance('基金账户', 8420, '2026-11-18'), balance('券商甲', 1860, TODAY)]
  const rows = Accounts.accountRows(ledger(), docs, amountCNY, TODAY)
  const byName = Object.fromEntries(rows.map(row => [row.name, row]))
  assert.equal(byName['基金账户'].profit, 420)
  assert.equal(byName['基金账户'].staleDays, 3)
  assert.equal(byName['券商甲'].profit, 860)
  assert.equal(byName['券商甲'].staleDays, 0)

  const s = Accounts.summary(rows, 12500, 2000)
  // 8420 + 1860 + 两个没填的按本金 1000 + 500
  assert.equal(s.currentValue, 11780)
  assert.equal(s.profit, 1280)
  assert.equal(Math.round(s.roi * 1000) / 1000, 0.102)
  assert.deepEqual(s.unvalued.sort(), ['平台丙', '平台乙'].sort())
})

test('an account emptied at a profit counts that profit without being asked for a value', () => {
  const entries = [
    { id: '1', type: '入金', date: '2026-09-01', amount: 1000, currency: 'CNY', exchange: '平台乙' },
    { id: '2', type: '出金', date: '2026-10-01', amount: 1500, currency: 'CNY', exchange: '平台乙' }
  ]
  const rows = Accounts.accountRows(entries, [], amountCNY, TODAY)
  assert.equal(rows[0].net, -500)
  assert.equal(rows[0].assumed, 0)
  const s = Accounts.summary(rows, 1000, 1500)
  assert.equal(s.profit, 500)
  assert.deepEqual(s.unvalued, [])
})

test('a value can be recorded for an account that has no entries yet', () => {
  const rows = Accounts.accountRows([], [balance('老账户', 3200, TODAY)], amountCNY, TODAY)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].value, 3200)
  assert.equal(rows[0].profit, 3200)
})

test('recording a value keeps a dated history and corrects same-day entries', () => {
  let doc = Accounts.setBalance([], { account: ' 基金账户 ', value: 8300, date: '2026-11-10', now: 1 })
  assert.equal(doc.id, 'balance:基金账户')
  assert.equal(doc.kind, 'balance')
  doc = Accounts.setBalance([doc], { account: '基金账户', value: 8400, date: '2026-11-18', now: 2 })
  doc = Accounts.setBalance([doc], { account: '基金账户', value: 8420, date: '2026-11-18', now: 3 })
  assert.deepEqual(doc.history, [{ date: '2026-11-10', value: 8300 }, { date: '2026-11-18', value: 8420 }])
  assert.equal(doc.value, 8420)
  assert.equal(doc.asOf, '2026-11-18')
  assert.equal(doc.updatedAt, 3)

  // 补填更早的一天：进历史，但不盖掉最新的现值
  doc = Accounts.setBalance([doc], { account: '基金账户', value: 8000, date: '2026-11-01', now: 4 })
  assert.equal(doc.value, 8420)
  assert.equal(doc.history.length, 3)
})

test('nonsense is refused rather than stored', () => {
  assert.equal(Accounts.setBalance([], { account: '', value: 100, date: TODAY, now: 1 }), null)
  assert.equal(Accounts.setBalance([], { account: '基金账户', value: -5, date: TODAY, now: 1 }), null)
  assert.equal(Accounts.setBalance([], { account: '基金账户', value: 'abc', date: TODAY, now: 1 }), null)
  assert.equal(Accounts.setBalance([], { account: '基金账户', value: 0, date: TODAY, now: 1 }).value, 0)
})
