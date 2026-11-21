const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

test('visible server sync UI delegates account management to Orbit', () => {
  const html = fs.readFileSync('index.html', 'utf8')
  const start = html.indexOf('<div v-if="syncProvider===\'server\'">')
  const end = html.indexOf('<div v-else>', start)
  const visibleServerPanel = html.slice(start, end)

  assert.ok(start > 0 && end > start)
  assert.match(visibleServerPanel, /账号在个人站管理/)
  // 没登录的人看到的是「只存在这台设备」的说明和登录入口，不是空白
  assert.match(visibleServerPanel, /v-if="guestMode"[\s\S]*只保存在这台设备的浏览器里[\s\S]*:href="orbitLoginUrl"/)
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

test('Orbit auto sync stays behind a first-migration gate', () => {
  const html = fs.readFileSync('index.html', 'utf8')

  assert.match(html, /touji_server_autosync_ready_v1__orbit_/)
  assert.match(html, /首次同步待确认/)
  assert.match(html, /delay:1200/)
  assert.match(html, /error\?\.code!==['"]REVISION_CONFLICT['"]/)
  assert.match(html, /window\.addEventListener\('online',retryOrbitAutoSync\)/)
})

test('the bottom bar has five items and the optional features stay out of it', () => {
  const html = fs.readFileSync('index.html', 'utf8')
  const tabs = html.slice(html.indexOf('const workspaceTabs=['), html.indexOf('const FEATURES_K'))
  const labels = [...tabs.matchAll(/label:'([^']+)'[^}]*?(nav:true)?[,}]/g)]
  const nav = [...tabs.matchAll(/\{key:'(\w+)'[^}]*nav:true[^}]*\}/g)].map(m => m[1])
  assert.deepEqual(nav, ['overview', 'records', 'quick', 'review', 'data'])
  assert.ok(labels.length >= 7)
  assert.match(tabs, /key:'positions'[^}]*feature:'positions'/)
  assert.match(tabs, /key:'debts'[^}]*label:'借款'[^}]*feature:'loans'/)
})

test('entry types keep their stored values and only change on screen', () => {
  const html = fs.readFileSync('index.html', 'utf8')
  assert.match(html, /function typeLabel\(type\)\{return\{入金:'投入',出金:'取出',互转:'转移'\}/)
  // 筛选和编辑里的选项：值还是账本里的值，显示的是新说法
  assert.match(html, /<option value="入金">\{\{ t\('typeIn'\) \}\}<\/option>/)
  assert.match(html, /typeIn:'投入'/)
  assert.doesNotMatch(html, /<option value="投入"/)
})
