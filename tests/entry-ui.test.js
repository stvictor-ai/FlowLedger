const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

const html = fs.readFileSync('index.html', 'utf8')
const worker = fs.readFileSync('sw.js', 'utf8')

test('quick entry exposes minute time and converted foreign deposit fields', () => {
  assert.match(html, /type="time" v-model="form\.time"/)
  assert.match(html, /v-model\.number="form\.sourceAmount"/)
  assert.match(html, /本笔实际汇率/)
  assert.match(html, /按本笔汇率自动计算到账数量/)
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
