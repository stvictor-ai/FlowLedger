(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.ToujiPositions = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  // 持仓的数量和成本是一笔笔买卖累出来的（加权平均成本）。
  // 删掉中间一笔买入时，不能拿现在的成本「倒着减」：这笔买入之后如果卖过，
  // 卖出已经按比例带走了一部分成本，倒减出来的数是错的。正确做法是把剩下的买卖重新走一遍。

  const EPS = 1e-6

  function num(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }

  function round(value, digits) {
    return Number(num(value).toFixed(digits))
  }

  function isTrade(entry) {
    return !!entry && (entry.type === '买入' || entry.type === '卖出') && num(entry.tradeQty) > 0 && num(entry.tradePrice) > 0
  }

  function momentKey(entry) {
    return `${String(entry.date || '')}T${String(entry.time || '00:00')}`
  }

  /** 发生时间从早到晚；同一分钟按记下的先后。 */
  function chronological(trades) {
    return [...trades].sort((a, b) => momentKey(a).localeCompare(momentKey(b)) || num(a.updatedAt) - num(b.updatedAt))
  }

  function near(a, b) {
    return Math.abs(num(a) - num(b)) <= EPS * Math.max(1, Math.abs(num(a)), Math.abs(num(b)))
  }

  /**
   * 从零开始把一组买卖走一遍。rateOf(entry) 给出这笔交易的币种对人民币汇率。
   * 返回最后的数量、平均成本、成本汇率，以及每笔卖出的已实现盈亏（人民币）。
   * 某笔卖出时手上不够卖，就停在那里并指出是哪一笔。
   */
  function replay(trades, rateOf) {
    let qty = 0
    let avgCost = null
    let costRate = 1
    const realized = {}
    for (const entry of chronological(trades.filter(isTrade))) {
      const q = num(entry.tradeQty)
      const price = num(entry.tradePrice)
      if (entry.type === '买入') {
        const next = qty + q
        avgCost = next ? (qty * (avgCost == null ? price : avgCost) + q * price) / next : price
        qty = next
        costRate = num(rateOf(entry)) || 1
      } else {
        if (q > qty + EPS) return { ok: false, shortEntryId: entry.id, qty: round(qty, 8) }
        realized[entry.id] = avgCost == null ? 0 : round((price * (num(rateOf(entry)) || 1) - avgCost * costRate) * q, 2)
        qty = Math.max(0, qty - q)
      }
    }
    return { ok: true, qty: round(qty, 8), avgCost: avgCost == null ? null : round(avgCost, 8), costRate, realized }
  }

  /**
   * 删掉一笔买入后，这个持仓应该变成什么样。
   * linked 是关联到这个持仓的全部买卖（包含要删的这笔）。
   *
   * - 持仓的数量和成本正好等于这些买卖走出来的结果：把剩下的重新走一遍（mode:'replay'），
   *   后面卖出的已实现盈亏也跟着重算。
   * - 对不上（持仓是手动建的，或者手动改过数量 / 成本）：账本里没有完整的来龙去脉。
   *   这笔买入之后没卖过时，倒减是准确的（mode:'arithmetic'）；卖过就拒绝，让人自己核对。
   */
  function removeBuy(position, linked, removed, rateOf) {
    const q = num(removed.tradeQty)
    const price = num(removed.tradePrice)
    const held = num(position.qty)
    const all = linked.filter(isTrade)
    const rest = all.filter(entry => entry.id !== removed.id)

    const full = replay(all, rateOf)
    const fromTradesOnly = full.ok && near(full.qty, held) && (full.avgCost == null || near(full.avgCost, position.avgCost))
    if (fromTradesOnly) {
      const next = replay(rest, rateOf)
      if (!next.ok) return { ok: false, reason: 'oversold', shortEntryId: next.shortEntryId }
      return { ok: true, mode: 'replay', qty: next.qty, avgCost: next.avgCost, costRate: next.costRate, realized: next.realized, empty: rest.length === 0 }
    }

    if (q > held + EPS) return { ok: false, reason: 'oversold' }
    const soldAfter = rest.some(entry => entry.type === '卖出' && momentKey(entry) >= momentKey(removed))
    if (soldAfter) return { ok: false, reason: 'manual' }
    const qty = round(held - q, 8)
    const avgCost = qty > 0 ? Math.max(0, round((held * num(position.avgCost) - q * price) / qty, 8)) : position.avgCost
    return { ok: true, mode: 'arithmetic', qty: Math.max(0, qty), avgCost, costRate: position.costRate, realized: {}, empty: rest.length === 0 }
  }

  return { isTrade, removeBuy, replay }
})
