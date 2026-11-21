const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

const html = fs.readFileSync('index.html', 'utf8')
const worker = fs.readFileSync('sw.js', 'utf8')

test('quick entry exposes minute time and both sides of a conversion, in or out', () => {
  assert.match(html, /type="time" v-model="form\.time"/)
  assert.match(html, /v-model\.number="form\.sourceAmount"/)
  assert.match(html, /v-model\.number="form\.fxUnits"/)
  // 出金也能记单价和数量，不只是入金
  assert.match(html, /quickAction==='withdraw'\?'到账人民币':'支付人民币'/)
  assert.match(html, /人民币金额、单价、数量填两个/)
})

test('cash entries can carry a payment channel and a counterparty', () => {
  assert.match(html, /v-for="o in PAY_CHANNELS"/)
  assert.match(html, /v-model="form\.counterparty"/)
  assert.match(html, /'收付款渠道':channelLabel\(e\.channel\)/)
})

test('entry engine is loaded and available offline', () => {
  assert.match(html, /<script src="js\/entry-engine\.js"><\/script>/)
  assert.match(worker, /\.\/js\/entry-engine\.js/)
})

test('Excel export preserves time and both sides of a conversion', () => {
  assert.match(html, /'时间':e\.time\|\|''/)
  assert.match(html, /'支付金额':e\.sourceAmount\|\|''/)
  assert.match(html, /'到账金额':e\.targetAmount\|\|''/)
  assert.match(html, /'实际汇率':e\.fxRate\|\|''/)
})

test('the entry form is one column with the optional fields behind 更多', () => {
  assert.match(html, /class="entry-layout"/)
  assert.doesNotMatch(html, /entry-cash-grid|entry-action-bar/)
  // 付款渠道是可选项，放在「更多」里面
  const more = html.indexOf('class="entry-optional"')
  assert.ok(more > 0 && html.indexOf('v-for="o in PAY_CHANNELS" :key="o.key" type="button"') > more)
  // 没有借款的人看不到还贷的去向
  assert.match(html, /v-for="o in visibleDestinations"/)
})

test('no text in the stylesheet is smaller than 11px', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
  const sizes = [...css.matchAll(/font-size:([0-9.]+)px/g)].map(m => Number(m[1]))
  assert.ok(sizes.length > 100)
  assert.ok(Math.min(...sizes) >= 11, `smallest font-size is ${Math.min(...sizes)}px`)
})
