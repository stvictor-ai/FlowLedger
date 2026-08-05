const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

test('admin center is role-gated and exposes metadata management only', () => {
  const html = fs.readFileSync('index.html', 'utf8')

  assert.match(html, /serverAccount\.user\.role==='admin'/)
  assert.match(html, /管理员中心/)
  assert.match(html, /创建普通用户邀请码/)
  assert.match(html, /serverAdmin\.users/)
  assert.doesNotMatch(html, /管理员[^\n]{0,80}查看[^\n]{0,80}(流水明细|持仓明细)/)
})
