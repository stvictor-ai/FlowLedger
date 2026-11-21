(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.ToujiC2C = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  // 从交易所 C2C 订单列表的文字里读出订单。文字可以来自本地 OCR，也可以是手机
  // 「复制截图中的文字」粘贴进来的 —— 两种来源的换行和顺序不一样，所以不按行解析，
  // 而是先按「出售 / 购买 XXX」切块，再在块里各找各的字段。
  // 版式固定、规则可解释，不需要模型；读错的数字靠「单价 × 数量 ≈ 金额」拦下来。

  const SIDES = { 购买: 'buy', 买入: 'buy', 出售: 'sell', 卖出: 'sell' }
  const HEADER = /(购买|买入|出售|卖出)\s*([A-Za-z]{2,6})(?![A-Za-z])/g
  const DONE = /交易完成|已完成|订单完成/
  const CANCELLED = /已取消|交易取消|订单取消|已关闭/
  const PENDING = /待付款|待支付|待放币|待确认|申诉中|处理中|待收款/
  // 商家名后面跟着的徽标文字，不是名字的一部分。
  const BADGES = /^(冻结赔付|新手友好|认证商家|认证商户|优选商家|钻石商家|皇冠商家|保证金|免手续费|秒放币|实名|已实名)$/

  const KEYWORDS = new RegExp(
    ['购买', '买入', '出售', '卖出', '价格', '数量', '交易完成', '已完成', '订单完成', '已取消', '交易取消', '订单取消', '待付款', '待放币', '申诉中']
      .map(word => word.split('').join('[ \\t]+')).join('|'), 'g')

  function number(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  function round(value, precision) {
    const factor = 10 ** precision
    return Math.round((number(value) + Number.EPSILON) * factor) / factor
  }

  // 全角转半角，统一冒号和斜杠；OCR 和输入法都可能给出全角字符。
  function normalizeText(text) {
    return String(text || '')
      .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/　/g, ' ')
      .replace(/\r\n?/g, '\n')
      // 有的 OCR 模型会在每个汉字之间插空格（「价 格」「数 量」）。只把认得的关键词并回去：
      // 全文都并的话，头像被认成的单个乱码字会粘到商家名后面。
      .replace(KEYWORDS, match => match.replace(/[ \t]+/g, ''))
  }

  // "1,200.50" 的逗号是千分位；"6,7" 的逗号是 OCR 把小数点认错了。
  function parseNumber(raw) {
    let text = String(raw || '').replace(/\s+/g, '')
    text = text.replace(/,(?=\d{3}(?:\D|$))/g, '')
    text = text.replace(/,/g, '.')
    const parts = text.split('.')
    if (parts.length > 2) text = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]
    return number(text)
  }

  function pad(value) {
    return String(value).padStart(2, '0')
  }

  function parseMoment(block) {
    const m = block.match(/(20\d{2})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*日?\s*(\d{1,2})\s*[:：]\s*(\d{2})/)
    if (!m) return null
    const [month, day, hour, minute] = [m[2], m[3], m[4], m[5]].map(Number)
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
    return { date: `${m[1]}-${pad(month)}-${pad(day)}`, time: `${pad(hour)}:${pad(minute)}` }
  }

  function parseCounterparty(rest) {
    for (const token of rest.split(/[\s、，,。|｜·]+/)) {
      const clean = token.replace(/^[^一-龥A-Za-z0-9]+|[^一-龥A-Za-z0-9]+$/g, '')
      // 头像、徽章会被 OCR 认成一两个乱码字符，名字至少两个字。
      if (clean.length < 2 || BADGES.test(clean)) continue
      if (/^(价格|数量|购买|出售|买入|卖出)/.test(clean)) return ''
      return clean.slice(0, 40)
    }
    return ''
  }

  function parseBlock(side, coin, block) {
    const order = { side, coin, date: '', time: '', price: 0, quantity: 0, total: 0, fiat: 'CNY', counterparty: '', status: 'unknown', issues: [] }
    const moment = parseMoment(block)
    if (moment) Object.assign(order, moment)

    if (CANCELLED.test(block)) order.status = 'cancelled'
    else if (DONE.test(block)) order.status = 'done'
    else if (PENDING.test(block)) order.status = 'pending'

    const price = block.match(/价格[\s:：]*([\d.,]+)\s*([A-Za-z]{3})(?![A-Za-z])/)
    if (price) {
      order.price = parseNumber(price[1])
      order.fiat = price[2].toUpperCase()
    }
    const quantity = block.match(/数量[\s:：]*([\d.,]+)\s*([A-Za-z]{2,6})/)
    if (quantity) order.quantity = parseNumber(quantity[1])

    // 金额：块里另一个「数字 + 法币」，不是价格那个。
    const fiatAmount = new RegExp(`([\\d.,]+)\\s*${order.fiat}(?![A-Za-z])`, 'gi')
    let found
    while ((found = fiatAmount.exec(block))) {
      if (price && found.index >= price.index && found.index < price.index + price[0].length) continue
      const value = parseNumber(found[1])
      if (value > 0) { order.total = value; break }
    }

    if (quantity) order.counterparty = parseCounterparty(block.slice(quantity.index + quantity[0].length))
    return order
  }

  // 三个数里有两个就能补出第三个；三个都有就核对。差得多说明有数字读错了。
  function reconcile(order) {
    const { price, quantity, total } = order
    const known = [price, quantity, total].filter(v => v > 0).length
    if (!order.date || known < 2) return false
    if (!total) { order.total = round(price * quantity, 2); order.issues.push('total-computed') }
    else if (!price) { order.price = round(total / quantity, 4); order.issues.push('price-computed') }
    else if (!quantity) { order.quantity = round(total / price, 6); order.issues.push('quantity-computed') }
    else if (!agrees(price * quantity, total)) {
      // OCR 最常见的错是漏掉小数点（6.7 读成 67）。挪一下小数点就对得上的，直接改正并标出来。
      const fixedPrice = shiftToFit(price, total / quantity)
      const fixedQuantity = shiftToFit(quantity, total / price)
      if (fixedPrice) { order.price = fixedPrice; order.issues.push('price-corrected') }
      else if (fixedQuantity) { order.quantity = fixedQuantity; order.issues.push('quantity-corrected') }
      else order.issues.push('mismatch')
    }
    return true
  }

  function agrees(a, b) {
    return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01)
  }

  // value 的小数点左移 1–4 位后和 expected 对得上（1% 以内），就返回移位后的值。
  function shiftToFit(value, expected) {
    for (let k = 1; k <= 4; k++) {
      const shifted = round(value / 10 ** k, 8)
      if (expected > 0 && Math.abs(shifted - expected) <= expected * 0.01) return shifted
    }
    return 0
  }

  function parseOrders(text) {
    const source = normalizeText(text)
    const headers = []
    let m
    HEADER.lastIndex = 0
    while ((m = HEADER.exec(source))) headers.push({ index: m.index, end: m.index + m[0].length, side: SIDES[m[1]], coin: m[2].toUpperCase() })

    const orders = []
    let incomplete = 0
    headers.forEach((header, i) => {
      const block = source.slice(header.end, i + 1 < headers.length ? headers[i + 1].index : source.length)
      const order = parseBlock(header.side, header.coin, block)
      if (!reconcile(order)) { incomplete++; return }
      if (order.fiat !== 'CNY') order.issues.push('not-cny')
      orders.push(order)
    })

    // 多张截图会有重叠（上一张的最后一笔是下一张的第一笔），同一笔只留一次。
    const seen = new Set()
    const unique = orders.filter(order => {
      const key = [order.side, order.coin, order.date, order.time, order.total, order.quantity].join('|')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return { orders: unique, incomplete, headers: headers.length }
  }

  function dayDiff(a, b) {
    const ms = date => Date.UTC(...date.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))))
    return Math.round((ms(b) - ms(a)) / 86400000)
  }

  // 把订单对到账本里已有的流水上。老记录大多只记了人民币金额，订单能给它补上
  // 数量、单价和时间 —— 所以同类型、同金额、同一天且还没有数量的，算「补全」而不是新增。
  // 凌晨的订单常被记到前一天，同一天找不到时放宽到前后一天，并标出来让人确认。
  function matchOrders(orders, entries, helpers) {
    const { amountCNY, fxParts } = helpers
    const used = new Set()
    const pool = (entries || []).filter(e => e && (e.type === '入金' || e.type === '出金') && e.date)
    return orders.map(order => {
      const type = order.side === 'buy' ? '入金' : '出金'
      const sameMoney = pool.filter(e => e.type === type && !used.has(e.id) && Math.abs(amountCNY(e) - order.total) <= 0.01)

      const duplicate = sameMoney.find(e => {
        const fx = fxParts(e)
        return fx && e.date === order.date && Math.abs(fx.units - order.quantity) <= 0.01
      })
      if (duplicate) { used.add(duplicate.id); return { order, kind: 'duplicate', entryId: duplicate.id, nearDate: false } }

      const bare = sameMoney.filter(e => !fxParts(e))
      const byTime = list => list.find(e => e.time && e.time === order.time) || list.find(e => !e.time) || list[0]
      let hit = byTime(bare.filter(e => e.date === order.date))
      let nearDate = false
      if (!hit) {
        hit = byTime(bare.filter(e => Math.abs(dayDiff(e.date, order.date)) === 1))
        nearDate = !!hit
      }
      if (hit) { used.add(hit.id); return { order, kind: 'enrich', entryId: hit.id, entryDate: hit.date, nearDate } }
      return { order, kind: 'new', entryId: null, nearDate: false }
    })
  }

  return { matchOrders, normalizeText, parseNumber, parseOrders }
})
