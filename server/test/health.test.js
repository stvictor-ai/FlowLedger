import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import { createApp } from '../src/app.js'

let server
let baseUrl

before(async () => {
  const app = createApp({ clock: () => new Date('2026-08-05T00:00:00.000Z') })
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
})

test('health endpoint reports the API without exposing configuration', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health`)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, {
    status: 'ok',
    service: 'touji-api',
    database: 'not_checked',
    timestamp: '2026-08-05T00:00:00.000Z'
  })
  assert.equal(response.headers.get('x-powered-by'), null)
})

test('unknown API routes return a stable error shape', async () => {
  const response = await fetch(`${baseUrl}/api/v1/missing`)

  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: 'NOT_FOUND' })
})

test('readiness endpoint checks the database connection', async t => {
  const readyApp = createApp({ database: { query: async sql => assert.equal(sql, 'SELECT 1') } })
  const readyServer = readyApp.listen(0, '127.0.0.1')
  await once(readyServer, 'listening')
  t.after(() => new Promise((resolve, reject) => readyServer.close(error => error ? reject(error) : resolve())))

  const { port } = readyServer.address()
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ready', database: 'ok' })
})

test('readiness endpoint returns 503 when the database is unavailable', async t => {
  const failedApp = createApp({ database: { query: async () => { throw new Error('offline') } } })
  const failedServer = failedApp.listen(0, '127.0.0.1')
  await once(failedServer, 'listening')
  t.after(() => new Promise((resolve, reject) => failedServer.close(error => error ? reject(error) : resolve())))

  const { port } = failedServer.address()
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`)

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { status: 'unavailable', database: 'error' })
})
