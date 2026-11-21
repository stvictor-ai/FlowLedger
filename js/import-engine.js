(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.ToujiImport = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function countByKey(items, keyOf) {
    const counts = new Map()
    ;(Array.isArray(items) ? items : []).forEach(item => {
      const key = keyOf(item)
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return counts
  }

  function consume(counts, key) {
    const count = counts.get(key) || 0
    if (!count) return false
    if (count === 1) counts.delete(key)
    else counts.set(key, count - 1)
    return true
  }

  function classifyOccurrences(existingEntries, incomingEntries, options) {
    const source = options && options.source
    const keyOf = options && options.keyOf
    if (typeof keyOf !== 'function') throw new TypeError('keyOf must be a function')

    const existing = Array.isArray(existingEntries) ? existingEntries : []
    const incoming = Array.isArray(incomingEntries) ? incomingEntries : []
    const remainingByKey = countByKey(existing, keyOf)
    const existingById = new Map(existing.filter(entry => entry && entry.id).map(entry => [entry.id, entry]))

    return incoming.map(entry => {
      const key = keyOf(entry)
      const sameId = source === 'JSON' && entry && entry.id ? existingById.get(entry.id) : null

      if (sameId) {
        consume(remainingByKey, keyOf(sameId))
        if (keyOf(sameId) === key) return { entry, kind: 'duplicate' }
        return { entry, kind: 'update', isUpdate: true }
      }

      if (consume(remainingByKey, key)) return { entry, kind: 'duplicate' }
      return { entry, kind: 'new' }
    })
  }

  function textKey(value) {
    return String(value || '').trim().toLowerCase()
  }

  function numKey(value, scale) {
    const n = Number(String(value == null ? '' : value).replace(/,/g, ''))
    return String(Math.round((Number.isFinite(n) ? n : 0) * scale) / scale)
  }

  function tagsKey(tags) {
    const list = Array.isArray(tags) ? tags : String(tags || '').split(/[,\uFF0C\u3001;；\s]+/)
    return [...new Set(list.map(tag => String(tag || '').trim()).filter(Boolean))].slice(0, 8).join(',')
  }

  /**
   * 两条记录算不算「同一笔」。只用导出文件里带得回来的字段：
   * 标的名称、关联持仓、id 这些在 Excel 里走一圈可能丢，放进来会让导出再导入全变成新增。
   * 一笔买卖由日期、时间、标的代码、数量、单价就能认出来。
   */
  function entryKey(entry) {
    const e = entry || {}
    return [
      e.date, e.time || '', e.type, textKey(e.assetType), textKey(e.exchange),
      String(e.currency || 'CNY').toUpperCase(), numKey(e.amount, 100), numKey(e.rate, 10000),
      numKey(e.sourceAmount, 100), textKey(e.sourceCurrency),
      numKey(e.targetAmount, 100000000), textKey(e.targetCurrency), numKey(e.fxRate, 10000),
      textKey(e.note), tagsKey(e.tags),
      textKey(e.targetSymbol),
      numKey(e.tradeQty, 100000000), numKey(e.tradePrice, 100000000),
      numKey(e.realizedPL, 100)
    ].join('|')
  }

  return { classifyOccurrences, entryKey }
})
