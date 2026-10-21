(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.ToujiDebt = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  // 负债口径。借来的钱记成入金会被当成本金，还款记成出金会被当成落袋 ——
  // 所以负债单独建账：贷款是一份 debts 记录，还款挂在它下面；从交易所取出来
  // 直接还贷的那笔出金（destination = repay / interest）也算作还款，但它仍是
  // 一笔出金，净值口径不变。这里全是纯函数，日期一律 'YYYY-MM-DD' 字符串。

  const FUND_SOURCES = [
    { key: 'salary', label: '工资' },
    { key: 'savings', label: '存款' },
    { key: 'loan', label: '借款' },
    { key: 'other', label: '其他' }
  ]
  const DESTINATIONS = [
    { key: 'card', label: '回到银行卡' },
    { key: 'repay', label: '还贷款本金' },
    { key: 'interest', label: '付贷款利息' },
    { key: 'other', label: '其他' }
  ]
  const REPAY_TYPES = [
    { key: 'interest_monthly', label: '按月付息，到期还本' },
    { key: 'bullet', label: '到期一次还本付息' },
    { key: 'other', label: '其他' }
  ]
  // 跳过冷静提醒时选的「这笔钱的打算」，存成标签，复盘时能按它切。
  const DEPOSIT_INTENTS = ['计划内', '补仓', '翻本', '抄底', 'FOMO']
  const PLAN_ID = 'debt-plan'

  function number(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  function round2(value) {
    return Math.round((number(value) + Number.EPSILON) * 100) / 100
  }

  // ─── 日期（UTC 计算，避免时区和夏令时让天数差一天） ──────────────────────
  function isDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  }

  function toUTC(value) {
    const [y, m, d] = value.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }

  function fromUTC(ms) {
    return new Date(ms).toISOString().slice(0, 10)
  }

  function daysBetween(a, b) {
    return Math.round((toUTC(b) - toUTC(a)) / 86400000)
  }

  function addDays(value, days) {
    return fromUTC(toUTC(value) + days * 86400000)
  }

  function monthEnd(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate()
  }

  // 某年某月的第 dom 号；这个月没有这一天（比如 31 号）就取月末。
  function domIn(y, m, dom) {
    const day = Math.min(Math.max(1, Math.floor(number(dom)) || 1), monthEnd(y, m))
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  // from（含）当天或之后的第一个 dom 号。
  function nextOnDom(dom, from) {
    const [y, m] = from.split('-').map(Number)
    const here = domIn(y, m, dom)
    if (here >= from) return here
    return m === 12 ? domIn(y + 1, 1, dom) : domIn(y, m + 1, dom)
  }

  // 付息日 date 的上一期（同一个号，往前一个月）。
  function prevOnDom(dom, date) {
    const [y, m] = date.split('-').map(Number)
    return m === 1 ? domIn(y - 1, 12, dom) : domIn(y, m - 1, dom)
  }

  function paydaysBetween(dom, start, end) {
    const out = []
    let d = nextOnDom(dom, start)
    while (d <= end && out.length < 600) {
      out.push(d)
      d = nextOnDom(dom, addDays(d, 1))
    }
    return out
  }

  // 最近一个发薪日（今天就是发薪日算今天）。
  function lastPayday(dom, today) {
    const [y, m] = today.split('-').map(Number)
    const here = domIn(y, m, dom)
    return here <= today ? here : prevOnDom(dom, here)
  }

  // ─── 贷款与还款 ────────────────────────────────────────────────────────
  function isLoan(item) {
    return !!item && item.kind === 'loan' && typeof item.id === 'string'
  }

  function findPlan(items) {
    const plan = (items || []).find(item => item && item.kind === 'plan')
    return {
      id: PLAN_ID,
      kind: 'plan',
      paydayDom: Math.min(31, Math.max(1, Math.floor(number(plan && plan.paydayDom)) || 20)),
      monthlyPlan: Math.max(0, number(plan && plan.monthlyPlan)),
      nudge: plan ? plan.nudge !== false : true,
      updatedAt: number(plan && plan.updatedAt)
    }
  }

  // 从交易所取出来直接还贷 / 付息的出金。它们仍然是出金（净值口径不变），
  // 同时算作这笔贷款的还款 —— 只记一次，改出金就等于改还款。
  function ledgerRepayments(entries, amountCNY) {
    const byLoan = {}
    for (const entry of entries || []) {
      if (!entry || entry.type !== '出金' || !entry.loanId) continue
      if (entry.destination !== 'repay' && entry.destination !== 'interest') continue
      const amount = round2(amountCNY(entry))
      if (amount <= 0) continue
      const row = {
        id: 'entry:' + entry.id,
        date: entry.date,
        principal: entry.destination === 'repay' ? amount : 0,
        interest: entry.destination === 'interest' ? amount : 0,
        dueDate: null,
        source: 'ledger',
        note: entry.note || '',
        entryId: entry.id
      }
      ;(byLoan[entry.loanId] = byLoan[entry.loanId] || []).push(row)
    }
    return byLoan
  }

  function cleanRepayment(row) {
    return {
      id: String(row.id || ''),
      date: isDate(row.date) ? row.date : '',
      principal: Math.max(0, round2(row.principal)),
      interest: Math.max(0, round2(row.interest)),
      dueDate: isDate(row.dueDate) ? row.dueDate : null,
      source: row.source || 'other',
      via: row.via || 'manual',
      note: row.note || '',
      entryId: row.entryId || null
    }
  }

  // 某一期是否已付：付息那行只有利息，到期那行一定带本金 —— 两者可能同一天到期，靠这个区分。
  function paidMark(repayments, date, kind) {
    return repayments.find(r => r.dueDate === date &&
      (kind === 'interest' ? r.interest > 0 && r.principal === 0 : r.principal > 0)) || null
  }

  // 单笔贷款的派生数。利息按国内银行惯例：日息 = 剩余本金 × 年化 / 360，
  // 当期利息 = 日息 × 实际天数（例：30000×3%/360 = 2.5/天，31 天 77.50，和银行账单一致）。
  function loanView(loan, options) {
    const opts = options || {}
    const today = opts.today
    const fromLedger = (opts.ledgerRepayments && opts.ledgerRepayments[loan.id]) || []
    const own = Array.isArray(loan.repayments) ? loan.repayments : []
    const repayments = [...own.map(cleanRepayment), ...fromLedger.map(cleanRepayment)]
      .filter(r => r.date)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    const principal = Math.max(0, round2(loan.principal))
    const repaidPrincipal = round2(repayments.reduce((s, r) => s + r.principal, 0))
    const paidInterest = round2(repayments.reduce((s, r) => s + r.interest, 0))
    const remaining = round2(Math.max(0, principal - repaidPrincipal))
    const rate = Math.max(0, number(loan.annualRate))
    const daily = remaining * rate / 360
    const maturity = isDate(loan.maturityDate) ? loan.maturityDate : null
    const start = isDate(loan.startDate) ? loan.startDate : null
    const closed = !!loan.closedAt || remaining <= 0
    const view = {
      ...loan,
      repayments,
      principal,
      repaidPrincipal,
      paidInterest,
      remaining,
      annualRate: rate,
      dailyInterest: round2(daily),
      closed,
      daysToMaturity: maturity && today ? daysBetween(today, maturity) : null,
      nextInterestDate: null,
      nextInterestAmount: 0,
      monthlyInterest: 0,
      monthlyAccrual: 0,
      accruedInterest: 0,
      interestAtMaturity: 0,
      payoffAtMaturity: remaining,
      remainingInterest: 0,
      totalOwed: remaining,
      events: []
    }
    if (closed || !maturity || !today) return view

    const maturityMark = paidMark(repayments, maturity, 'maturity')
    if (loan.repayType === 'bullet') {
      const totalDays = start ? Math.max(0, daysBetween(start, maturity)) : 0
      const accruedDays = start ? Math.max(0, daysBetween(start, today < maturity ? today : maturity)) : 0
      view.interestAtMaturity = round2(daily * totalDays)
      view.accruedInterest = round2(daily * accruedDays)
      view.monthlyAccrual = round2(daily * 30)
      view.payoffAtMaturity = round2(remaining + view.interestAtMaturity)
      view.remainingInterest = maturityMark ? 0 : view.interestAtMaturity
      view.events.push({
        date: maturity, kind: 'maturity', loanId: loan.id, loanName: loan.name || '',
        amount: maturityMark ? round2(maturityMark.principal + maturityMark.interest) : view.payoffAtMaturity,
        principal: remaining, interest: view.interestAtMaturity,
        paid: !!maturityMark, repaymentId: maturityMark ? maturityMark.id : null
      })
    } else if (loan.repayType === 'interest_monthly') {
      const dom = Math.min(31, Math.max(1, Math.floor(number(loan.interestDay)) || 10))
      // 第一期付息日：起息日之后（或今天之后）的第一个付息号。
      let cursor = nextOnDom(dom, today)
      let guard = 0
      // 已经提前勾掉的期往后滚：下一期才是「还没付的」。
      while (cursor <= maturity && paidMark(repayments, cursor, 'interest') && guard++ < 400) {
        cursor = nextOnDom(dom, addDays(cursor, 1))
      }
      const nextUnpaid = cursor <= maturity ? cursor : null
      const periodInterest = date => {
        const prev = prevOnDom(dom, date)
        const from = start && start > prev ? start : prev
        return round2(daily * Math.max(0, daysBetween(from, date)))
      }
      if (nextUnpaid) {
        view.nextInterestDate = nextUnpaid
        view.nextInterestAmount = periodInterest(nextUnpaid)
        view.monthlyInterest = view.nextInterestAmount
        // 过了付息日还没勾的那期，默认银行已经扣走 —— 只管「往后还要付多少」。
        const paidThrough = prevOnDom(dom, nextUnpaid)
        const from = start && start > paidThrough ? start : paidThrough
        view.remainingInterest = round2(daily * Math.max(0, daysBetween(from, maturity)))
      }
      // 日程：今天起到到期的每一期付息（含已勾的），再加到期还本。
      let d = nextOnDom(dom, today)
      guard = 0
      while (d <= maturity && guard++ < 400) {
        const mark = paidMark(repayments, d, 'interest')
        view.events.push({
          date: d, kind: 'interest', loanId: loan.id, loanName: loan.name || '',
          amount: mark ? round2(mark.interest) : periodInterest(d),
          principal: 0, interest: mark ? round2(mark.interest) : periodInterest(d),
          paid: !!mark, repaymentId: mark ? mark.id : null
        })
        d = nextOnDom(dom, addDays(d, 1))
      }
      // 到期那天还本，还要付最后一个付息日到到期日这几天的利息（到期日本身就是付息日则为 0）。
      const [my, mm] = maturity.split('-').map(Number)
      const lastInterest = domIn(my, mm, dom) <= maturity ? domIn(my, mm, dom) : prevOnDom(dom, maturity)
      const stubFrom = start && start > lastInterest ? start : lastInterest
      const stub = lastInterest === maturity ? 0 : round2(daily * Math.max(0, daysBetween(stubFrom, maturity)))
      view.payoffAtMaturity = round2(remaining + stub)
      view.events.push({
        date: maturity, kind: 'maturity', loanId: loan.id, loanName: loan.name || '',
        amount: maturityMark ? round2(maturityMark.principal + maturityMark.interest) : view.payoffAtMaturity,
        principal: remaining, interest: stub,
        paid: !!maturityMark, repaymentId: maturityMark ? maturityMark.id : null
      })
    } else {
      view.events.push({
        date: maturity, kind: 'maturity', loanId: loan.id, loanName: loan.name || '',
        amount: remaining, principal: remaining, interest: 0,
        paid: !!maturityMark, repaymentId: maturityMark ? maturityMark.id : null
      })
    }
    view.totalOwed = round2(remaining + view.remainingInterest)
    return view
  }

  function loanViews(items, options) {
    const opts = options || {}
    const fromLedger = opts.entries && opts.amountCNY ? ledgerRepayments(opts.entries, opts.amountCNY) : {}
    return (items || []).filter(isLoan)
      .map(loan => loanView(loan, { today: opts.today, ledgerRepayments: fromLedger }))
      .sort((a, b) => (number(a.sortOrder) - number(b.sortOrder)) ||
        String(a.maturityDate || '').localeCompare(String(b.maturityDate || '')))
  }

  // 待付日程：没付的最多列 limit 笔；已勾的不占名额（要显示划掉）。
  function schedule(views, today, limit) {
    const max = limit || 6
    const all = []
    for (const view of views) {
      for (const event of view.events) {
        if (event.date < today) continue
        if (!event.paid && event.amount <= 0) continue
        all.push(event)
      }
    }
    all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === 'interest' ? -1 : 1))
    const unpaid = all.filter(e => !e.paid).slice(0, max)
    const lastUnpaid = unpaid.length ? unpaid[unpaid.length - 1].date : ''
    const paid = all.filter(e => e.paid && (!lastUnpaid || e.date <= lastUnpaid))
    return [...paid, ...unpaid].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }

  function summary(views, today) {
    const open = views.filter(v => !v.closed)
    const sum = key => round2(views.reduce((s, v) => s + number(v[key]), 0))
    const remaining = sum('remaining')
    const repaidPrincipal = sum('repaidPrincipal')
    // 同一天可能好几笔都要付（两笔贷款同一天付息），「下次要付」给当天的合计。
    const upcoming = schedule(views, today, 50).filter(e => !e.paid)
    const nextDate = upcoming.length ? upcoming[0].date : null
    const sameDay = upcoming.filter(e => e.date === nextDate)
    const next = nextDate ? {
      date: nextDate,
      kind: sameDay.every(e => e.kind === 'interest') ? 'interest' : 'maturity',
      amount: round2(sameDay.reduce((s, e) => s + e.amount, 0)),
      count: sameDay.length,
      items: sameDay
    } : null
    return {
      count: views.length,
      openCount: open.length,
      principal: sum('principal'),
      remaining,
      repaidPrincipal,
      paidInterest: sum('paidInterest'),
      remainingInterest: sum('remainingInterest'),
      totalOwed: sum('totalOwed'),
      monthlyInterest: round2(open.reduce((s, v) => s + number(v.monthlyInterest), 0)),
      monthlyAccrual: round2(open.reduce((s, v) => s + number(v.monthlyAccrual), 0)),
      progressPct: repaidPrincipal + remaining > 0 ? round2(repaidPrincipal / (repaidPrincipal + remaining) * 100) : null,
      nextEvent: next,
      lastMaturity: open.map(v => v.maturityDate).filter(isDate).sort().pop() || null
    }
  }

  // 还债计划（和交易台同一口径）：
  // · 到期日 D 之前能用的发薪日 = 今天起到 D（含）的发薪日个数，今天就是发薪日也算一期；
  // · 全靠工资还清，每个发薪日至少要拿出 max(到第 i 个到期日的累计应还 ÷ 之前的发薪日数) + 每月要付的息；
  // · 填了「每月能拿出多少」就按它推到每个到期日能还多少、还差多少 —— 差的只能续贷或另找来源，这里只摆数字。
  function paydayPlan(views, plan, today) {
    const dom = plan.paydayDom
    const planAmount = number(plan.monthlyPlan)
    const open = views.filter(v => !v.closed && isDate(v.maturityDate))
      .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate))
    const monthlyInterest = round2(open.reduce((s, v) => s + number(v.monthlyInterest), 0))
    let cum = 0
    let need = 0
    const steps = open.map(v => {
      const paydays = paydaysBetween(dom, today, v.maturityDate).length
      cum += number(v.payoffAtMaturity)
      need = Math.max(need, paydays ? cum / paydays : cum)
      const cover = planAmount > 0 ? round2(planAmount * paydays) : null
      return {
        loanId: v.id,
        loanName: v.name || '',
        date: v.maturityDate,
        days: daysBetween(today, v.maturityDate),
        paydays,
        due: round2(v.payoffAtMaturity),
        cumDue: round2(cum),
        planCover: cover,
        planGap: cover === null ? null : round2(Math.max(0, cum - cover))
      }
    })
    const needPerPayday = open.length ? round2(need + monthlyInterest) : 0
    const last = lastPayday(dom, today)
    const paidThisPayday = round2(views.reduce((s, v) => s + v.repayments
      .filter(r => r.date >= last && r.date <= today)
      .reduce((t, r) => t + r.principal + r.interest, 0), 0))
    const target = planAmount > 0 ? planAmount : needPerPayday
    return {
      paydayDom: dom,
      lastPayday: last,
      nextPayday: nextOnDom(dom, today),
      isPaydayToday: last === today,
      monthlyPlan: planAmount,
      monthlyInterest,
      needPerPayday,
      target: round2(target),
      paidThisPayday,
      leftThisPayday: round2(Math.max(0, target - paidThisPayday)),
      steps,
      firstGap: steps.find(s => s.planGap) || null
    }
  }

  // 借来的钱往交易所流了多少。标了「借款」的入金是确定的；最早一笔贷款下来以后的
  // 全部出入金是上下文（没标来源的老记录只能这样看）。互转不算。
  function loanFunding(entries, views, amountCNY, today) {
    const starts = views.map(v => v.startDate).filter(isDate).sort()
    const since = starts[0] || null
    const month = today.slice(0, 7)
    let tagged = 0
    let taggedCount = 0
    let sinceIn = 0
    let sinceOut = 0
    let monthIn = 0
    let monthCount = 0
    for (const entry of entries || []) {
      if (!entry || (entry.type !== '入金' && entry.type !== '出金')) continue
      const amount = amountCNY(entry)
      if (entry.type === '入金' && entry.fundSource === 'loan') { tagged += amount; taggedCount++ }
      if (since && entry.date >= since) {
        if (entry.type === '入金') sinceIn += amount
        else sinceOut += amount
      }
      if (entry.type === '入金' && String(entry.date || '').slice(0, 7) === month) { monthIn += amount; monthCount++ }
    }
    return {
      since,
      taggedLoan: round2(tagged),
      taggedLoanCount: taggedCount,
      sinceIn: round2(sinceIn),
      sinceOut: round2(sinceOut),
      sinceNet: round2(sinceIn - sinceOut),
      monthIn: round2(monthIn),
      monthCount
    }
  }

  // 入金前的冷静提醒。原来每笔都弹 confirm，几乎每次都被点掉；现在只在真有风险时
  // 出现，并且带上下文：还欠多少、本月第几笔。level: info < warn < danger。
  function depositWarnings(input) {
    const { entries, form, views, plan, today, amountCNY } = input
    const out = []
    const amount = number(form.amountCNY)
    const owed = summary(views || [], today)
    const deposits = (entries || []).filter(e => e && e.type === '入金' && e.id !== form.id)
    const month = String(form.date || today).slice(0, 7)
    const monthDeposits = deposits.filter(e => String(e.date || '').slice(0, 7) === month)
    const monthTotal = round2(monthDeposits.reduce((s, e) => s + amountCNY(e), 0) + amount)
    const nth = monthDeposits.length + 1

    if (form.fundSource === 'loan') {
      out.push({ level: 'danger', key: 'loan', text: '这笔是借来的钱。借来的钱进交易所，亏掉的部分要用工资连本带息还。' })
    }
    if (owed.totalOwed > 0) {
      const step = plan ? paydayPlan(views, plan, today).steps[0] : null
      const due = owed.nextEvent && owed.nextEvent.kind === 'maturity' ? owed.nextEvent : null
      let text = `还欠 ¥${owed.totalOwed.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
      if (step) text += `，最近一笔 ${step.date} 到期（还有 ${step.days} 天）`
      if (step && step.planGap) text += `，按计划还差 ¥${step.planGap.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
      else if (due) text += `，${due.date} 要还 ¥${due.amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
      if (amount > 0) text += `。这 ¥${amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 本可以先还掉`
      out.push({ level: nth >= 2 ? 'danger' : 'warn', key: 'debt', text: text + '。' })
    }
    if (nth >= 2 && (owed.totalOwed > 0 || nth >= 4)) {
      out.push({ level: nth >= 4 ? 'danger' : 'warn', key: 'month', text: `本月第 ${nth} 笔入金，合计 ¥${monthTotal.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}。` })
    }
    const last = [...deposits].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]
    if (last && form.date && daysBetween(last.date, form.date) >= 0 && daysBetween(last.date, form.date) <= 1) {
      out.push({ level: 'warn', key: 'gap', text: `上一笔入金是 ${last.date}，不到 24 小时又要转。` })
    }
    const recent = [...deposits].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10)
    if (recent.length >= 3 && amount > 0) {
      const avg = recent.reduce((s, e) => s + amountCNY(e), 0) / recent.length
      if (avg > 0 && amount > avg * 2) {
        out.push({ level: 'warn', key: 'size', text: `这笔是近期均值的 ${(amount / avg).toFixed(1)} 倍。` })
      }
    }
    const rank = { info: 0, warn: 1, danger: 2 }
    const level = out.reduce((m, w) => (rank[w.level] > rank[m] ? w.level : m), 'info')
    return { level: out.length ? level : null, warnings: out, monthCount: nth, monthTotal }
  }

  // 勾选待付日程：付息只是一笔利息还款；到期还本把剩余本金（bullet 连同整笔利息）记成还款。
  // via = 'schedule' 让取消勾选时能精确撤回这一笔，不碰手动记的还款。
  function checkOff(loan, event, options) {
    const opts = options || {}
    const view = loanView(loan, { today: opts.today || event.date, ledgerRepayments: opts.ledgerRepayments })
    const id = opts.id || `rp-${event.kind}-${event.date}-${Math.random().toString(36).slice(2, 8)}`
    const row = event.kind === 'interest'
      ? { id, date: opts.paidOn || event.date, principal: 0, interest: round2(event.amount), dueDate: event.date, source: opts.source || 'salary', via: 'schedule', note: '' }
      : { id, date: opts.paidOn || event.date, principal: view.remaining, interest: round2(view.payoffAtMaturity - view.remaining), dueDate: event.date, source: opts.source || 'salary', via: 'schedule', note: '' }
    return { ...loan, repayments: [...(loan.repayments || []), row] }
  }

  function uncheck(loan, event) {
    return {
      ...loan,
      repayments: (loan.repayments || []).filter(r => !(r.via === 'schedule' && r.dueDate === event.date &&
        (event.kind === 'interest' ? number(r.interest) > 0 && number(r.principal) === 0 : number(r.principal) > 0)))
    }
  }

  return {
    DEPOSIT_INTENTS,
    DESTINATIONS,
    FUND_SOURCES,
    PLAN_ID,
    REPAY_TYPES,
    addDays,
    checkOff,
    daysBetween,
    depositWarnings,
    findPlan,
    isLoan,
    lastPayday,
    ledgerRepayments,
    loanFunding,
    loanView,
    loanViews,
    nextOnDom,
    paydayPlan,
    paydaysBetween,
    schedule,
    summary,
    uncheck
  }
})
