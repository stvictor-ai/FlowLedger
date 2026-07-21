(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.ToujiReview = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const DEFAULT_RULES = {
    largeCashflow: 5000,
    denseBuyCount: 3,
    denseBuyDays: 7,
    concentrationPct: 60
  }

  function number(value) {
    const result = Number(value)
    return Number.isFinite(result) ? result : 0
  }

  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
  }

  function dateSerial(value) {
    if (!validDate(value)) return NaN
    const [year, month, day] = value.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }

  function daysBetween(start, end) {
    return Math.round((dateSerial(end) - dateSerial(start)) / 864e5)
  }

  function dateFromSerial(serial) {
    return new Date(serial).toISOString().slice(0, 10)
  }

  function formatNumber(value) {
    return number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  }

  function normalizeTags(value) {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
    return String(value || '').split(/[,，;；\s]+/).map(item => item.trim()).filter(Boolean)
  }

  function cleanEntries(entries) {
    return (Array.isArray(entries) ? entries : [])
      .filter(entry => entry && validDate(entry.date))
      .map((entry, index) => ({
        ...entry,
        id: String(entry.id || `entry-${index}`),
        amountCNY: Math.abs(number(entry.amountCNY)),
        tags: normalizeTags(entry.tags)
      }))
  }

  function createSignal(type, date, title, reason, severity, entryIds, extra) {
    const ids = Array.isArray(entryIds) ? entryIds.map(String) : []
    return {
      id: `${type}:${date}:${ids.join(',') || (extra && extra.key) || 'summary'}`,
      type,
      date,
      title,
      reason,
      severity,
      entryIds: ids,
      ...(extra || {})
    }
  }

  function buildSignals(entries, positions, ruleOverrides, today) {
    const rules = { ...DEFAULT_RULES, ...(ruleOverrides || {}) }
    const source = cleanEntries(entries)
    const sorted = [...source].sort((a, b) => a.date.localeCompare(b.date))
    const signals = []

    sorted.forEach(entry => {
      if (
        (entry.type === '入金' || entry.type === '出金') &&
        entry.amountCNY >= Math.max(0, number(rules.largeCashflow))
      ) {
        signals.push(createSignal(
          'large-cashflow',
          entry.date,
          '大额资金变动',
          `${entry.type} ${formatNumber(entry.amountCNY)} 元，达到设定阈值 ${formatNumber(rules.largeCashflow)} 元。`,
          'warn',
          [entry.id]
        ))
      }

      if (entry.tags.some(tag => tag.toUpperCase() === 'FOMO')) {
        signals.push(createSignal(
          'fomo',
          entry.date,
          '情绪交易标签',
          '这笔记录带有 FOMO 标签，建议核对是否属于计划外操作。',
          'danger',
          [entry.id]
        ))
      }

      if (entry.type === '卖出' && number(entry.realizedPL) < 0) {
        signals.push(createSignal(
          'loss-sell',
          entry.date,
          '亏损卖出',
          `这笔卖出已实现亏损 ${formatNumber(Math.abs(number(entry.realizedPL)))} 元，建议记录止损依据。`,
          'danger',
          [entry.id]
        ))
      }
    })

    const buys = sorted.filter(entry => entry.type === '买入')
    const denseCount = Math.max(2, Math.round(number(rules.denseBuyCount) || DEFAULT_RULES.denseBuyCount))
    const denseDays = Math.max(1, Math.round(number(rules.denseBuyDays) || DEFAULT_RULES.denseBuyDays))
    for (let index = 0; index < buys.length; index++) {
      const current = buys[index]
      const windowEntries = buys.filter(entry => (
        entry.date <= current.date &&
        daysBetween(entry.date, current.date) >= 0 &&
        daysBetween(entry.date, current.date) < denseDays
      ))
      if (windowEntries.length < denseCount) continue

      const previous = index > 0 ? buys[index - 1] : null
      const previousCount = previous
        ? buys.filter(entry => (
          entry.date <= previous.date &&
          daysBetween(entry.date, previous.date) >= 0 &&
          daysBetween(entry.date, previous.date) < denseDays
        )).length
        : 0
      if (previousCount >= denseCount) continue

      const involved = windowEntries.slice(-denseCount)
      signals.push(createSignal(
        'dense-buy',
        current.date,
        '短期密集买入',
        `${denseDays} 天内完成 ${involved.length} 次买入，达到设定的密集操作规则。`,
        'warn',
        involved.map(entry => entry.id)
      ))
    }

    const valuedPositions = (Array.isArray(positions) ? positions : [])
      .map(position => ({ ...position, value: Math.max(0, number(position && position.value)) }))
      .filter(position => position.value > 0)
    const totalValue = valuedPositions.reduce((sum, position) => sum + position.value, 0)
    if (totalValue > 0 && validDate(today)) {
      const largest = valuedPositions.reduce((current, position) => (
        !current || position.value > current.value ? position : current
      ), null)
      const ratio = largest.value / totalValue * 100
      const threshold = Math.max(1, number(rules.concentrationPct) || DEFAULT_RULES.concentrationPct)
      if (ratio >= threshold) {
        const label = largest.name || largest.symbol || '单一资产'
        signals.push(createSignal(
          'concentration',
          today,
          '持仓集中',
          `${label} 占当前持仓市值 ${ratio.toFixed(1)}%，达到设定阈值 ${threshold.toFixed(0)}%。`,
          ratio >= 80 ? 'danger' : 'warn',
          [],
          { key: String(largest.id || largest.symbol || label), positionId: largest.id || '' }
        ))
      }
    }

    return signals.sort((a, b) => (
      b.date.localeCompare(a.date) ||
      a.type.localeCompare(b.type)
    ))
  }

  function buildCalendarMonth(monthKey, entries, signals, noteDates, today) {
    const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/)
    if (!match) throw new Error('monthKey must use YYYY-MM format')
    const year = Number(match[1])
    const month = Number(match[2])
    if (month < 1 || month > 12) throw new Error('monthKey contains an invalid month')

    const firstSerial = Date.UTC(year, month - 1, 1)
    const leadingDays = new Date(firstSerial).getUTCDay()
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const cellCount = Math.ceil((leadingDays + daysInMonth) / 7) * 7
    const gridStart = firstSerial - leadingDays * 864e5
    const entryMap = new Map()
    const signalMap = new Map()
    const noteSet = new Set(Array.isArray(noteDates) ? noteDates : [])

    cleanEntries(entries).forEach(entry => {
      if (!entryMap.has(entry.date)) entryMap.set(entry.date, [])
      entryMap.get(entry.date).push(entry)
    })
    ;(Array.isArray(signals) ? signals : []).forEach(signal => {
      if (!signal || !validDate(signal.date)) return
      if (!signalMap.has(signal.date)) signalMap.set(signal.date, [])
      signalMap.get(signal.date).push({ ...signal, entryIds: [...(signal.entryIds || [])] })
    })

    const cells = Array.from({ length: cellCount }, (_, index) => {
      const date = dateFromSerial(gridStart + index * 864e5)
      const dayEntries = entryMap.get(date) || []
      const daySignals = signalMap.get(date) || []
      return {
        date,
        day: Number(date.slice(8, 10)),
        inMonth: date.slice(0, 7) === monthKey,
        isToday: date === today,
        hasNote: noteSet.has(date),
        entries: dayEntries.map(entry => ({ ...entry, tags: [...entry.tags] })),
        amountTotal: dayEntries.reduce((sum, entry) => sum + entry.amountCNY, 0),
        entryTypes: [...new Set(dayEntries.map(entry => entry.type).filter(Boolean))],
        signals: daySignals
      }
    })

    return {
      monthKey,
      label: `${year} 年 ${month} 月`,
      weekdays: ['日', '一', '二', '三', '四', '五', '六'],
      cells
    }
  }

  function buildTimeline(entries, signals, limit) {
    const maxItems = Math.max(1, Math.round(number(limit) || 10))
    const sourceSignals = Array.isArray(signals) ? signals : []
    return cleanEntries(entries)
      .sort((a, b) => (
        b.date.localeCompare(a.date) ||
        number(b.updatedAt) - number(a.updatedAt)
      ))
      .slice(0, maxItems)
      .map(entry => ({
        entry: { ...entry, tags: [...entry.tags] },
        signals: sourceSignals
          .filter(signal => Array.isArray(signal.entryIds) && signal.entryIds.includes(entry.id))
          .map(signal => ({ ...signal, entryIds: [...signal.entryIds] }))
      }))
  }

  return {
    DEFAULT_RULES,
    buildSignals,
    buildCalendarMonth,
    buildTimeline
  }
})
