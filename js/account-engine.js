(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.ToujiAccounts = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  // 「到今天赚了还是亏了」不需要逐个录持仓：每个账户只要知道现在值多少。
  //   盈亏 = 各账户现在值之和 + 已取出 − 总投入
  // 账户现在值是用户自己填的一个数（kind:'balance' 的文档，和贷款存在同一个集合里一起同步）。
  // 没填的账户先按「还放在里面的本金」算，也就是不赚不亏，并标出来让人去填。

  const KIND = 'balance'
  const HISTORY_LIMIT = 120

  function round(value) {
    return Math.round((Number(value) || 0) * 100) / 100
  }

  function isBalance(item) {
    return !!item && item.kind === KIND && !!item.account
  }

  function balanceId(account) {
    return `balance:${String(account).trim().slice(0, 100)}`
  }

  function daysBetween(from, to) {
    const ms = date => Date.UTC(...String(date).split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))))
    const diff = Math.round((ms(to) - ms(from)) / 86400000)
    return Number.isFinite(diff) ? diff : 0
  }

  /**
   * 每个账户一行：投了多少、取了多少、账户之间转进转出多少、现在值多少。
   * net 是还放在这个账户里的本金；转移在这里要算，否则钱还显示在转出的账户上。
   */
  function accountRows(entries, docs, amountCNY, today) {
    const rows = new Map()
    const row = name => {
      const key = String(name || '').trim() || '未填账户'
      if (!rows.has(key)) rows.set(key, { name: key, invested: 0, withdrawn: 0, movedIn: 0, movedOut: 0, count: 0, lastDate: '' })
      return rows.get(key)
    }
    for (const entry of entries || []) {
      if (!entry) continue
      const amount = amountCNY(entry)
      if (entry.type === '入金') row(entry.exchange).invested += amount
      else if (entry.type === '出金') row(entry.exchange).withdrawn += amount
      else if (entry.type === '互转') {
        row(entry.exchange).movedOut += amount
        if (entry.toExchange) row(entry.toExchange).movedIn += amount
      } else continue
      const touched = [row(entry.exchange)]
      if (entry.type === '互转' && entry.toExchange) touched.push(row(entry.toExchange))
      for (const item of touched) {
        item.count += 1
        if (entry.date && entry.date > item.lastDate) item.lastDate = entry.date
      }
    }
    const balances = new Map((docs || []).filter(isBalance).map(doc => [String(doc.account).trim(), doc]))
    for (const account of balances.keys()) row(account)

    return [...rows.values()].map(item => {
      const net = round(item.invested - item.withdrawn + item.movedIn - item.movedOut)
      const doc = balances.get(item.name)
      const valued = !!doc && Number.isFinite(Number(doc.value))
      const value = valued ? round(doc.value) : null
      return {
        name: item.name,
        invested: round(item.invested),
        withdrawn: round(item.withdrawn),
        movedIn: round(item.movedIn),
        movedOut: round(item.movedOut),
        net,
        count: item.count,
        valued,
        value,
        // 没填现值时拿来凑总数的数：本金还在里面就按本金，已经全取走就按 0。
        assumed: valued ? value : Math.max(net, 0),
        profit: valued ? round(value - net) : null,
        asOf: valued ? doc.asOf || '' : '',
        staleDays: valued && doc.asOf && today ? Math.max(0, daysBetween(doc.asOf, today)) : null,
        lastDate: item.lastDate
      }
    }).sort((a, b) => b.assumed - a.assumed || b.invested - a.invested || a.name.localeCompare(b.name, 'zh'))
  }

  /** 首页最大的那个数。totalIn / totalOut 是全账本的投入和取出（转移不算）。 */
  function summary(rows, totalIn, totalOut) {
    const live = rows.filter(row => row.valued || row.net > 0.005)
    const currentValue = round(rows.reduce((sum, row) => sum + row.assumed, 0))
    const profit = round(currentValue + totalOut - totalIn)
    return {
      currentValue,
      profit,
      roi: totalIn > 0 ? profit / totalIn : 0,
      valuedCount: rows.filter(row => row.valued).length,
      // 里面还有本金、却没填现值的账户：这些是让盈亏不准的原因。
      unvalued: live.filter(row => !row.valued).map(row => row.name)
    }
  }

  /** 记下某个账户今天值多少。同一天再填是改正，不同天会留下一条历史。 */
  function setBalance(docs, { account, value, date, now }) {
    const name = String(account || '').trim()
    const amount = round(value)
    if (!name || !Number.isFinite(Number(value)) || amount < 0 || !date) return null
    const id = balanceId(name)
    const previous = (docs || []).find(doc => doc && doc.id === id)
    const history = (previous && Array.isArray(previous.history) ? previous.history : [])
      .filter(point => point && point.date && point.date !== date)
    history.push({ date, value: amount })
    history.sort((a, b) => (a.date < b.date ? -1 : 1))
    const latest = history[history.length - 1]
    return {
      id,
      kind: KIND,
      account: name,
      // 补填一个更早日期的现值不该盖掉更新的那个。
      value: latest.value,
      asOf: latest.date,
      history: history.slice(-HISTORY_LIMIT),
      updatedAt: now
    }
  }

  return { KIND, accountRows, balanceId, isBalance, setBalance, summary }
})
