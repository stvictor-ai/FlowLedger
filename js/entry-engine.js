(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.ToujiEntry = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  function number(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  function round(value, precision) {
    const factor = 10 ** precision
    return Math.round((number(value) + Number.EPSILON) * factor) / factor
  }

  function normalizeTime(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
    }
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
      const totalMinutes = Math.round(value * 24 * 60) % (24 * 60)
      return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
    }
    const text = String(value || '').trim()
    const match = text.match(/(?:T|\s|^)(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*$|[Z+\-])/)
    if (!match) return ''
    const hours = Number(match[1])
    const minutes = Number(match[2])
    if (hours > 23 || minutes > 59) return ''
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  }

  function momentKey(entry) {
    return `${String(entry && entry.date || '')}T${normalizeTime(entry && entry.time) || '00:00'}`
  }

  function compareEntriesDesc(a, b) {
    const byMoment = momentKey(b).localeCompare(momentKey(a))
    if (byMoment) return byMoment
    return number(b && b.updatedAt) - number(a && a.updatedAt)
  }

  function targetAmount(sourceAmount, cnyPerTarget, precision = 8) {
    const source = number(sourceAmount)
    const rate = number(cnyPerTarget)
    return source > 0 && rate > 0 ? round(source / rate, precision) : 0
  }

  function sourceAmount(target, cnyPerTarget, precision = 2) {
    const amount = number(target)
    const rate = number(cnyPerTarget)
    return amount > 0 && rate > 0 ? round(amount * rate, precision) : 0
  }

  function isFxEntry(entry) {
    if (!entry) return false
    const sourceCurrency = String(entry.sourceCurrency || '').toUpperCase()
    const targetCurrency = String(entry.targetCurrency || '').toUpperCase()
    return Boolean(sourceCurrency && targetCurrency && sourceCurrency !== targetCurrency &&
      (number(entry.sourceAmount) > 0 || number(entry.targetAmount || entry.amount) > 0 || number(entry.fxRate || entry.rate) > 0))
  }

  function amountCNY(entry) {
    if (!entry) return 0
    if (entry.type === '入金' && String(entry.sourceCurrency || '').toUpperCase() === 'CNY' && number(entry.sourceAmount) > 0) {
      return number(entry.sourceAmount)
    }
    if (entry.type === '出金' && String(entry.targetCurrency || '').toUpperCase() === 'CNY' && number(entry.targetAmount) > 0) {
      return number(entry.targetAmount)
    }
    const amount = number(entry.amount)
    const currency = String(entry.currency || 'CNY').toUpperCase()
    const rate = number(entry.rate)
    return currency === 'CNY' ? amount : (rate > 0 ? amount * rate : amount)
  }

  return {
    amountCNY,
    compareEntriesDesc,
    isFxEntry,
    momentKey,
    normalizeTime,
    sourceAmount,
    targetAmount
  }
})
