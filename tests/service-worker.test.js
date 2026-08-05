const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')

function loadWorker() {
  const listeners = {}
  const calls = { fetch: [], open: [], match: [] }
  const response = { ok: true, clone: () => response }
  const context = {
    URL,
    Promise,
    console,
    self: {
      location: { origin: 'https://touji.example.com' },
      addEventListener(type, handler) { listeners[type] = handler },
      skipWaiting() {},
      clients: { claim() {} }
    },
    fetch: async request => { calls.fetch.push(request); return response },
    caches: {
      async keys() { return [] },
      async delete() {},
      async match(request) { calls.match.push(request); return null },
      async open(name) {
        calls.open.push(name)
        return { add: async () => {}, put: async () => {} }
      }
    }
  }
  vm.runInNewContext(fs.readFileSync('sw.js', 'utf8'), context)
  return { listeners, calls }
}

async function dispatchFetch(handler, url) {
  let responsePromise
  handler({
    request: { url, method: 'GET' },
    respondWith(value) { responsePromise = value }
  })
  await responsePromise
}

test('same-origin API responses bypass Cache Storage', async () => {
  const { listeners, calls } = loadWorker()

  await dispatchFetch(listeners.fetch, 'https://touji.example.com/api/v1/auth/me')

  assert.equal(calls.fetch.length, 1)
  assert.equal(calls.open.length, 0)
  assert.equal(calls.match.length, 0)
})

test('same-origin static files remain network-first cached', async () => {
  const { listeners, calls } = loadWorker()

  await dispatchFetch(listeners.fetch, 'https://touji.example.com/index.html')

  assert.equal(calls.fetch.length, 1)
  assert.equal(calls.open.length, 1)
})

