const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

test('visible server sync UI delegates account management to Orbit', () => {
  const html = fs.readFileSync('index.html', 'utf8')
  const start = html.indexOf('<div v-if="syncProvider===\'server\'">')
  const end = html.indexOf('<div v-else-if="false">', start)
  const visibleServerPanel = html.slice(start, end)

  assert.match(visibleServerPanel, /统一在个人站管理/)
  assert.match(visibleServerPanel, /https:\/\/orbitshz\.com\/account/)
  assert.match(visibleServerPanel, /比较并同步/)
  assert.doesNotMatch(visibleServerPanel, /server-auth-form|邀请码注册|管理员中心|创建普通用户邀请码/)
})

test('local ledger storage is scoped to the authenticated Orbit user', () => {
  const html = fs.readFileSync('index.html', 'utf8')

  assert.match(html, /function bindAccountStorage\(accountId\)/)
  assert.match(html, /__orbit_\$\{id\}/)
  assert.match(html, /ACCOUNT_STORAGE_OWNER_K/)
  assert.match(html, /clearVisibleAccountData\(\)/)
  assert.match(html, /window\.addEventListener\('focus',verifyOrbitSession\)/)
})
