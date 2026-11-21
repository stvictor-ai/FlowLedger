const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

const html = fs.readFileSync('index.html', 'utf8')
const worker = fs.readFileSync('sw.js', 'utf8')
const workflow = fs.readFileSync('.github/workflows/deploy-lightsail.yml', 'utf8')

test('the page and its service worker carry the same version', () => {
  const version = html.match(/const APP_VERSION='([^']+)'/)?.[1]
  assert.ok(version, 'index.html declares APP_VERSION')
  const cache = worker.match(/const CACHE_NAME = '([^']+)'/)?.[1]
  // 版本不一致时，「有新版本」的提示会一直挂着，或者永远不出现。
  assert.equal(cache, `touji-${version.replace(/\./g, '-')}`)
})

test('every engine the page loads is cached for offline use', () => {
  const scripts = [...html.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m => m[1])
  assert.ok(scripts.length >= 5)
  for (const src of scripts) assert.ok(worker.includes(`'./${src}'`), `${src} is in the service worker pre-cache`)
})

test('deployment waits for the tests and reads the version from the source', () => {
  assert.match(workflow, /deploy:\n\s+needs: test/)
  assert.match(workflow, /node --test tests\/\*\.test\.js/)
  assert.doesNotMatch(workflow, /v20\d\d\.\d+\.\d+-\d+/)
})
