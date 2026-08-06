import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadMigrations, runMigrations } from '../src/db/migrate.js'

function createFakePool({ versions = [], failOnMigration = false } = {}) {
  const calls = []
  let released = false
  const client = {
    async query(sql, params) {
      const text = String(sql)
      calls.push({ text, params })
      if (text === 'SELECT version FROM schema_migrations') {
        return { rows: versions.map(version => ({ version })) }
      }
      if (failOnMigration && text.includes('CREATE TABLE users')) {
        throw new Error('synthetic migration failure')
      }
      return { rows: [] }
    },
    release() {
      released = true
    }
  }
  return {
    pool: { connect: async () => client },
    calls,
    wasReleased: () => released
  }
}

test('initial migration defines all account and ledger tables', async () => {
  const migrations = await loadMigrations()

  assert.deepEqual(migrations.map(item => item.version), ['001_initial', '002_admin_roles', '003_orbit_identity'])
  for (const table of ['users', 'invitation_codes', 'sessions', 'ledgers', 'entries', 'positions']) {
    assert.match(migrations[0].sql, new RegExp(`CREATE TABLE ${table}`))
  }
  assert.match(migrations[0].sql, /FOREIGN KEY \(ledger_id, user_id\)/)
  assert.match(migrations[1].sql, /ADD COLUMN role/)
  assert.match(migrations[1].sql, /'user', 'admin'/)
  assert.match(migrations[2].sql, /ADD COLUMN orbit_user_id/)
  assert.match(migrations[2].sql, /password_hash DROP NOT NULL/)
})

test('migration runner applies pending migrations once and releases the client', async () => {
  const fake = createFakePool()
  const applied = await runMigrations({ pool: fake.pool })

  assert.deepEqual(applied, ['001_initial', '002_admin_roles', '003_orbit_identity'])
  assert.equal(fake.calls.some(call => call.text.includes('CREATE TABLE users')), true)
  assert.equal(fake.calls.some(call => call.text === 'COMMIT'), true)
  assert.equal(fake.wasReleased(), true)
})

test('migration runner skips versions already recorded', async () => {
  const fake = createFakePool({ versions: ['001_initial', '002_admin_roles', '003_orbit_identity'] })
  const applied = await runMigrations({ pool: fake.pool })

  assert.deepEqual(applied, [])
  assert.equal(fake.calls.some(call => call.text.includes('CREATE TABLE users')), false)
})

test('migration runner rolls back and releases after an error', async () => {
  const fake = createFakePool({ failOnMigration: true })

  await assert.rejects(
    () => runMigrations({ pool: fake.pool }),
    /synthetic migration failure/
  )
  assert.equal(fake.calls.some(call => call.text === 'ROLLBACK'), true)
  assert.equal(fake.wasReleased(), true)
})
