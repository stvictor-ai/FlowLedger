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

  // 人民币 ↔ 外币（C2C 买卖 USDT 最典型）。入金是付人民币、到账外币；出金反过来，
  // 卖出外币、到账人民币。两个方向都拆成同一组数：人民币金额、外币数量、单价。
  function fxParts(entry) {
    if (!isFxEntry(entry)) return null
    const source = String(entry.sourceCurrency || '').toUpperCase()
    const target = String(entry.targetCurrency || '').toUpperCase()
    const rate = number(entry.fxRate || entry.rate)
    if (source === 'CNY') return { cny: number(entry.sourceAmount), units: number(entry.targetAmount || entry.amount), unit: target, rate }
    if (target === 'CNY') return { cny: number(entry.targetAmount), units: number(entry.sourceAmount || entry.amount), unit: source, rate }
    return null
  }

  // 一笔换汇流水要存的字段。amount 始终是外币数量，人民币放在付出 / 到账的那一侧。
  function fxFields(type, parts) {
    const cny = round(parts.cny, 2)
    const units = round(parts.units, 8)
    const rate = round(parts.rate, 6)
    const unit = String(parts.unit || '').toUpperCase()
    const base = { amount: units, currency: unit, rate, fxRate: rate }
    return type === '出金'
      ? { ...base, sourceAmount: units, sourceCurrency: unit, targetAmount: cny, targetCurrency: 'CNY' }
      : { ...base, sourceAmount: cny, sourceCurrency: 'CNY', targetAmount: units, targetCurrency: unit }
  }

  // 人民币金额、单价、数量三个填两个，算出第三个。missing 指明要算哪一个。
  function solveFx(parts, missing) {
    const cny = number(parts.cny)
    const rate = number(parts.rate)
    const units = number(parts.units)
    if (missing === 'units') return cny > 0 && rate > 0 ? round(cny / rate, 6) : 0
    if (missing === 'rate') return cny > 0 && units > 0 ? round(cny / units, 6) : 0
    return rate > 0 && units > 0 ? round(units * rate, 2) : 0
  }

  // 收付款渠道：钱走的是哪条通道，和「去向 / 来源」是两回事。
  const PAY_CHANNELS = [
    { key: 'alipay', label: '支付宝' },
    { key: 'wechat', label: '微信' },
    { key: 'bank', label: '银行卡' },
    { key: 'other', label: '其他' }
  ]

  function normalizeChannel(value) {
    const text = String(value || '').trim()
    const hit = PAY_CHANNELS.find(option => option.key === text || option.label === text)
    return hit ? hit.key : ''
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
    PAY_CHANNELS,
    amountCNY,
    fxFields,
    fxParts,
    normalizeChannel,
    solveFx,
    compareEntriesDesc,
    isFxEntry,
    momentKey,
    normalizeTime,
    sourceAmount,
    targetAmount
  }
})
