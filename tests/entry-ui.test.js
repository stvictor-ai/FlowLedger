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

test('tags and the reason are one field, and the optional labels carry icons', () => {
  const start = html.indexOf('class="entry-optional"')
  const optional = html.slice(start, html.indexOf('<footer class="entry-ticket-foot"', start))
  // 标签（点选）和理由（一行字）合在同一栏里，不再各占一个输入框
  assert.equal((optional.match(/class="form-group entry-reason"/g) || []).length, 1)
  assert.match(optional, /v-for="tag in quickReasonOptions"/)
  assert.doesNotMatch(optional, /v-model="form\.tagText"/)
  assert.equal((optional.match(/v-model="form\.note"/g) || []).length, 1)
  // 每个标签前都有小图标
  const labels = optional.match(/<label>[\s\S]*?<\/label>/g) || []
  assert.equal(labels.length, 4)
  // 交易对手只在加密货币（或 USDT）时出现
  assert.match(optional, /<div v-if="showCounterparty" class="form-group">/)
  assert.match(html, /const showCounterparty=computed\(\(\)=>[^\n]*form\.assetType==='加密货币'\|\|form\.currency==='USDT'/)
  for (const label of labels) assert.match(label, /class="entry-label-icon"/)
})

test('no text in the stylesheet is smaller than 11px', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
  const sizes = [...css.matchAll(/font-size:([0-9.]+)px/g)].map(m => Number(m[1]))
  assert.ok(sizes.length > 100)
  assert.ok(Math.min(...sizes) >= 11, `smallest font-size is ${Math.min(...sizes)}px`)
})
