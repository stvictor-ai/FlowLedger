const assert = require('node:assert/strict')
const test = require('node:test')
const Debt = require('../js/debt-engine.js')
const { amountCNY } = require('../js/entry-engine.js')

// 虚构的三笔一年期贷款：两笔按月付息、到期还本，一笔到期一次还本付息。
function loans() {
  return [
    { id: 'a', kind: 'loan', name: '信用贷 A', principal: 40000, annualRate: 0.036, repayType: 'interest_monthly', interestDay: 15, startDate: '2026-03-01', maturityDate: '2027-03-01', sortOrder: 1, repayments: [] },
    {
      id: 'b', kind: 'loan', name: '信用贷 B', principal: 60000, annualRate: 0.03, repayType: 'interest_monthly', interestDay: 15, startDate: '2026-01-20', maturityDate: '2027-01-20', sortOrder: 2,
      repayments: [{ id: 'r1', date: '2026-10-25', principal: 1500, interest: 0, source: 'salary' }]
    },
    { id: 'c', kind: 'loan', name: '经营贷 C', principal: 50000, annualRate: 0.032, repayType: 'bullet', startDate: '2026-02-10', maturityDate: '2027-02-10', sortOrder: 3, repayments: [] }
  ]
}
const plan = { id: 'debt-plan', kind: 'plan', paydayDom: 25, monthlyPlan: 3000 }

test('interest follows the bank convention: principal × rate / 360 × actual days', () => {
  const [a, b, c] = Debt.loanViews(loans(), { today: '2026-10-26' })
  assert.equal(a.nextInterestDate, '2026-11-15')
  assert.equal(a.nextInterestAmount, 124) // 40000 × 3.6% / 360 = 4.00/天 × 31 天
  assert.equal(b.remaining, 58500)
  assert.equal(b.nextInterestAmount, 151.13) // 58500 × 3% / 360 = 4.875/天 × 31 天
  assert.equal(c.monthlyInterest, 0)
  assert.equal(c.interestAtMaturity, 1622.22) // 365 天
  assert.equal(c.payoffAtMaturity, 51622.22)
})

test('a monthly-interest loan owes the stub interest with its principal at maturity', () => {
  const [a, b] = Debt.loanViews(loans(), { today: '2026-10-26' })
  // 最后一个付息日 02-15 到到期日 03-01 共 14 天
  assert.equal(a.events.find(e => e.kind === 'maturity').interest, 56)
  assert.equal(a.payoffAtMaturity, 40056)
  // 01-15 到 01-20 共 5 天
  assert.equal(b.payoffAtMaturity, 58524.38)
})

test('payday plan: every payday up to each maturity, today included', () => {
  const views = Debt.loanViews(loans(), { today: '2026-10-25' })
  const p = Debt.paydayPlan(views, Debt.findPlan([plan]), '2026-10-25')
  assert.equal(p.isPaydayToday, true)
  assert.deepEqual(p.steps.map(s => [s.loanId, s.paydays]), [['b', 3], ['c', 4], ['a', 5]])
  // 最紧的是最后一步：(58524.38 + 51622.22 + 40056) ÷ 5 = 30040.52，再加每月利息 124 + 151.13
  assert.equal(p.needPerPayday, 30315.65)
  assert.equal(p.paidThisPayday, 1500)
  assert.equal(p.steps[0].cumDue, 58524.38)
  assert.equal(p.steps[0].planGap, 49524.38) // 3 个发薪日 × 3000 = 9000
})

test('checking off an interest period rolls the schedule to the next one and back', () => {
  const today = '2026-10-26'
  let [a] = loans()
  const first = Debt.loanView(a, { today }).events[0]
  assert.equal(first.date, '2026-11-15')
  a = Debt.checkOff(a, first, { today, id: 'x' })
  const view = Debt.loanView(a, { today })
  assert.equal(view.nextInterestDate, '2026-12-15')
  assert.equal(view.events[0].paid, true)
  assert.equal(view.paidInterest, 124)
  // 到期前利息少了一期
  assert.ok(view.remainingInterest < Debt.loanView(loans()[0], { today }).remainingInterest)
  a = Debt.uncheck(a, first)
  assert.equal(Debt.loanView(a, { today }).nextInterestDate, '2026-11-15')
})

test('the last interest period and the maturity on the same day stay distinct', () => {
  const today = '2027-02-20'
  let a = { ...loans()[0], interestDay: 1 }
  const events = Debt.loanView(a, { today }).events
  const interest = events.find(e => e.kind === 'interest')
  const maturity = events.find(e => e.kind === 'maturity')
  assert.equal(interest.date, '2027-03-01')
  assert.equal(maturity.date, '2027-03-01')
  a = Debt.checkOff(a, interest, { today })
  const after = Debt.loanView(a, { today })
  assert.equal(after.events.find(e => e.kind === 'maturity').paid, false)
  assert.equal(after.remaining, 40000)
  a = Debt.checkOff(a, maturity, { today })
  assert.equal(Debt.loanView(a, { today }).closed, true)
  a = Debt.uncheck(a, maturity)
  assert.equal(Debt.loanView(a, { today }).remaining, 40000)
})

test('a withdrawal sent straight to a loan counts once, as both a withdrawal and a repayment', () => {
  const entries = [
    { id: 'w1', type: '出金', date: '2026-10-26', amount: 2000, currency: 'CNY', destination: 'repay', loanId: 'b' },
    { id: 'w2', type: '出金', date: '2026-10-26', amount: 150, currency: 'CNY', destination: 'interest', loanId: 'b' },
    { id: 'w3', type: '出金', date: '2026-10-26', amount: 500, currency: 'CNY', destination: 'card' }
  ]
  const [, b] = Debt.loanViews(loans(), { today: '2026-10-26', entries, amountCNY })
  assert.equal(b.repaidPrincipal, 3500)
  assert.equal(b.paidInterest, 150)
  assert.equal(b.remaining, 56500)
  assert.ok(b.repayments.some(r => r.entryId === 'w1' && r.source === 'ledger'))
})

test('summary totals principal plus the interest still to pay before maturity', () => {
  const views = Debt.loanViews(loans(), { today: '2026-10-26' })
  const s = Debt.summary(views, '2026-10-26')
  assert.equal(s.remaining, 148500)
  assert.equal(s.totalOwed, Math.round((s.remaining + s.remainingInterest) * 100) / 100)
  assert.equal(s.monthlyInterest, 275.13)
  // 两笔同一天付息，「下次要付」给当天合计
  assert.equal(s.nextEvent.date, '2026-11-15')
  assert.equal(s.nextEvent.count, 2)
  assert.equal(s.nextEvent.amount, 275.13)
  assert.equal(s.lastMaturity, '2027-03-01')
})

test('loan funding separates tagged loan money from everything since the first loan', () => {
  const entries = [
    { id: '1', type: '入金', date: '2025-12-01', amount: 900, currency: 'CNY' },
    { id: '2', type: '入金', date: '2026-02-01', amount: 5000, currency: 'CNY', fundSource: 'loan', loanId: 'b' },
    { id: '3', type: '入金', date: '2026-10-05', amount: 500, currency: 'CNY', fundSource: 'salary' },
    { id: '4', type: '出金', date: '2026-10-06', amount: 300, currency: 'CNY' },
    { id: '5', type: '互转', date: '2026-10-07', amount: 800, currency: 'CNY' }
  ]
  const views = Debt.loanViews(loans(), { today: '2026-10-26' })
  const f = Debt.loanFunding(entries, views, amountCNY, '2026-10-26')
  assert.equal(f.since, '2026-01-20')
  assert.equal(f.taggedLoan, 5000)
  assert.equal(f.sinceIn, 5500)
  assert.equal(f.sinceNet, 5200)
  assert.equal(f.monthCount, 1)
})

test('deposit warnings stay quiet without risk and escalate with debt and frequency', () => {
  const today = '2026-10-26'
  const quiet = Debt.depositWarnings({ entries: [], form: { date: today, amountCNY: 500 }, views: [], plan: null, today, amountCNY })
  assert.equal(quiet.level, null)

  const views = Debt.loanViews(loans(), { today })
  const entries = [{ id: 'd1', type: '入金', date: '2026-10-03', amount: 500, currency: 'CNY' }]
  const second = Debt.depositWarnings({ entries, form: { date: today, amountCNY: 500, fundSource: 'salary' }, views, plan: Debt.findPlan([plan]), today, amountCNY })
  assert.equal(second.level, 'danger')
  assert.equal(second.monthCount, 2)
  assert.equal(second.monthTotal, 1000)
  assert.ok(second.warnings.some(w => w.key === 'debt' && w.text.includes('2027-01-20')))

  const borrowed = Debt.depositWarnings({ entries: [], form: { date: today, amountCNY: 500, fundSource: 'loan' }, views: [], plan: null, today, amountCNY })
  assert.equal(borrowed.level, 'danger')
})

test('paydays clamp to month end and include today', () => {
  assert.deepEqual(Debt.paydaysBetween(31, '2026-02-01', '2026-04-30'), ['2026-02-28', '2026-03-31', '2026-04-30'])
  assert.equal(Debt.lastPayday(20, '2026-10-20'), '2026-10-20')
  assert.equal(Debt.lastPayday(20, '2026-10-19'), '2026-09-20')
  assert.equal(Debt.findPlan([]).paydayDom, 20)
})

test('a loan past its maturity stays at the top of the schedule, marked overdue', () => {
  const today = '2027-01-26'
  const views = Debt.loanViews(loans(), { today })
  const events = Debt.schedule(views, today, 6)
  assert.equal(events[0].loanId, 'b')
  assert.equal(events[0].kind, 'maturity')
  assert.equal(events[0].overdue, true)
  assert.equal(events[0].overdueDays, 6)
  assert.equal(Debt.summary(views, today).nextEvent.date, '2027-01-20')
  const risk = Debt.depositWarnings({ entries: [], form: { date: today, amountCNY: 500, fundSource: 'salary' }, views, plan: Debt.findPlan([plan]), today, amountCNY })
  assert.ok(risk.warnings.some(w => w.text.includes('已经逾期 6 天')))
})

test('ticking a maturity only repays what the ledger has not already repaid', () => {
  const today = '2027-01-18'
  const entries = [{ id: 'w1', type: '出金', date: '2026-12-01', amount: 10000, currency: 'CNY', destination: 'repay', loanId: 'b' }]
  const fromLedger = Debt.ledgerRepayments(entries, amountCNY)
  const [, b] = Debt.loanViews(loans(), { today, entries, amountCNY })
  assert.equal(b.remaining, 48500)
  const maturity = b.events.find(e => e.kind === 'maturity')
  const paid = Debt.checkOff(loans()[1], maturity, { today, ledgerRepayments: fromLedger })
  const after = Debt.loanView(paid, { today, ledgerRepayments: fromLedger })
  assert.equal(after.repaidPrincipal, 60000)
  assert.equal(after.closed, true)
})

test('a monthly cap warns anyone, with or without loans', () => {
  const today = '2026-10-26'
  const entries = [{ id: 'd1', type: '入金', date: '2026-10-03', amount: 3500, currency: 'CNY' }]
  const check = (amount, cap) => Debt.depositWarnings({ entries, form: { date: today, amountCNY: amount, fundSource: 'salary' }, views: [], plan: null, today, amountCNY, monthlyCap: cap })

  assert.equal(check(1000, 5000).warnings.some(w => w.key === 'cap'), false)
  const over = check(2000, 5000)
  assert.equal(over.level, 'warn')
  assert.ok(over.warnings.find(w => w.key === 'cap').text.includes('5,500'))
  // 没设上限就不提
  assert.equal(check(2000, 0).warnings.some(w => w.key === 'cap'), false)

  const already = Debt.depositWarnings({
    entries: [...entries, { id: 'd2', type: '入金', date: '2026-10-10', amount: 2000, currency: 'CNY' }],
    form: { date: today, amountCNY: 100, fundSource: 'salary' }, views: [], plan: null, today, amountCNY, monthlyCap: 5000
  })
  assert.equal(already.warnings.find(w => w.key === 'cap').level, 'danger')
})
