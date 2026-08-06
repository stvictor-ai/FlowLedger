import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadConfig } from '../src/config.js'

test('development config uses local-only defaults', () => {
  const config = loadConfig({})

  assert.equal(config.nodeEnv, 'development')
  assert.equal(config.port, 8787)
  assert.match(config.databaseUrl, /^postgres:/)
  assert.equal(config.isProduction, false)
  assert.equal(config.identityProvider, 'session')
})

test('production config refuses to start without secrets', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production' }),
    /DATABASE_URL is required in production/
  )
})

test('production config accepts explicit secure values', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    PORT: '9000',
    DATABASE_URL: 'postgres://touji:secret@db:5432/touji',
    SESSION_SECRET: 'a-secure-session-secret-with-32-characters',
    APP_ORIGIN: 'https://touji.example.com',
    IDENTITY_PROVIDER: 'orbit'
  })

  assert.equal(config.port, 9000)
  assert.equal(config.appOrigin, 'https://touji.example.com')
  assert.equal(config.isProduction, true)
  assert.equal(config.identityProvider, 'orbit')
})

test('invalid ports and short session secrets are rejected', () => {
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT must be an integer/)
  assert.throws(
    () => loadConfig({ SESSION_SECRET: 'too-short' }),
    /SESSION_SECRET must contain at least 32 characters/
  )
  assert.throws(() => loadConfig({ IDENTITY_PROVIDER: 'unknown' }), /IDENTITY_PROVIDER/)
})
