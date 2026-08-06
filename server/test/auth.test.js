import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { createApp } from '../src/app.js'
import { verifyPassword } from '../src/modules/auth/password.js'
import { AuthRepositoryError } from '../src/modules/auth/repository.js'
import { AuthError, createAuthService } from '../src/modules/auth/service.js'
import { hashSecret } from '../src/modules/auth/tokens.js'

const NOW = new Date('2026-08-05T08:00:00.000Z')

function createMemoryRepository() {
  const state = {
    allowInvite: true,
    duplicateEmail: false,
    registration: null,
    users: new Map(),
    sessions: new Map()
  }
  const repository = {
    async registerUser(data) {
      state.registration = data
      if (!state.allowInvite) return null
      if (state.duplicateEmail) throw new AuthRepositoryError('EMAIL_TAKEN')
      const user = {
        id: 'user-1',
        email: data.email,
        password_hash: data.passwordHash,
        role: 'admin',
        status: 'active'
      }
      state.users.set(data.email, user)
      return {
        user,
        ledger: { id: 'ledger-1', name: '我的账本', revision: 0 }
      }
    },
    async findUserByEmail(email) {
      const user = state.users.get(email)
      return user ? {
        ...user,
        ledger_id: 'ledger-1',
        ledger_name: '我的账本',
        revision: 0
      } : null
    },
    async createSession({ userId, tokenHash, expiresAt }) {
      state.sessions.set(tokenHash, { userId, expiresAt })
      return { id: `session-${state.sessions.size}`, expires_at: expiresAt }
    },
    async findSession({ tokenHash, now }) {
      const session = state.sessions.get(tokenHash)
      if (!session || session.expiresAt <= now) return null
      const user = [...state.users.values()].find(item => item.id === session.userId)
      return user ? {
        user_id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        ledger_id: 'ledger-1',
        ledger_name: '我的账本',
        revision: 0
      } : null
    },
    async deleteSession(tokenHash) {
      state.sessions.delete(tokenHash)
    }
  }
  return { repository, state }
}

async function startApp(options) {
  const app = createApp(options)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
}

test('registration hashes password, invitation and session secrets', async () => {
  const memory = createMemoryRepository()
  const secret = 'test-session-pepper-value-long-enough'
  const service = createAuthService({ repository: memory.repository, clock: () => NOW, secret })
  const result = await service.register({
    email: ' Owner@Example.com ',
    password: 'correct-horse-battery',
    inviteCode: ' tji-secret-code '
  })

  assert.equal(result.user.email, 'owner@example.com')
  assert.equal(result.user.role, 'admin')
  assert.equal(result.user.ledger.id, 'ledger-1')
  assert.notEqual(memory.state.registration.passwordHash, 'correct-horse-battery')
  assert.equal(await verifyPassword(memory.state.registration.passwordHash, 'correct-horse-battery'), true)
  assert.equal(memory.state.registration.inviteCodeHash, hashSecret('TJI-SECRET-CODE', secret))
  assert.equal(memory.state.sessions.has(hashSecret(result.token, secret)), true)
  assert.equal(memory.state.sessions.has(result.token), false)
})

test('secret hashing uses the configured server pepper', () => {
  assert.notEqual(hashSecret('same-token', 'secret-a'), hashSecret('same-token', 'secret-b'))
})

test('invalid invitation and duplicate email share a generic registration error', async () => {
  const memory = createMemoryRepository()
  const service = createAuthService({ repository: memory.repository, clock: () => NOW })

  memory.state.allowInvite = false
  await assert.rejects(
    () => service.register({ email: 'a@example.com', password: 'long-enough-password', inviteCode: 'bad-code-1' }),
    error => error instanceof AuthError && error.code === 'REGISTRATION_FAILED'
  )

  memory.state.allowInvite = true
  memory.state.duplicateEmail = true
  await assert.rejects(
    () => service.register({ email: 'a@example.com', password: 'long-enough-password', inviteCode: 'valid-code' }),
    error => error instanceof AuthError && error.code === 'REGISTRATION_FAILED'
  )
})

test('unknown email and wrong password share invalid credentials', async () => {
  const memory = createMemoryRepository()
  const service = createAuthService({ repository: memory.repository, clock: () => NOW })

  for (const email of ['missing@example.com', 'owner@example.com']) {
    await assert.rejects(
      () => service.login({ email, password: 'wrong-password' }),
      error => error instanceof AuthError && error.code === 'INVALID_CREDENTIALS' && error.status === 401
    )
  }
})

test('Orbit identity headers provision the authenticated ledger user', async t => {
  let received = null
  const authService = {
    register: async () => {},
    login: async () => {},
    logout: async () => {},
    getSession: async () => null,
    getOrbitSession: async identity => {
      received = identity
      return {
        id: 'ledger-user-1',
        orbitUserId: identity.orbitUserId,
        email: identity.email,
        role: identity.role,
        ledger: { id: '11111111-1111-4111-8111-111111111111', name: '我的账本', revision: 0 }
      }
    }
  }
  const running = await startApp({
    authService,
    config: {
      appOrigin: 'https://ledger.orbitshz.com',
      accountOrigin: 'https://orbitshz.com',
      identityProvider: 'orbit',
      isProduction: true
    }
  })
  t.after(running.close)

  const response = await fetch(`${running.baseUrl}/api/v1/auth/me`, {
    headers: {
      Origin: 'https://orbitshz.com',
      'X-Orbit-User-Id': '42',
      'X-Orbit-User-Role': 'owner',
      'X-Orbit-User-Email': 'Owner@Example.com'
    }
  })

  assert.equal(response.status, 200)
  assert.deepEqual(received, { orbitUserId: '42', email: 'owner@example.com', role: 'admin' })
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://orbitshz.com')
  assert.equal((await response.json()).user.orbitUserId, '42')
})

test('Orbit mode rejects missing trusted identity headers', async t => {
  const authService = {
    register: async () => {}, login: async () => {}, logout: async () => {},
    getSession: async () => null,
    getOrbitSession: async identity => identity.orbitUserId ? { id: 'unexpected' } : null
  }
  const running = await startApp({
    authService,
    config: {
      appOrigin: 'https://ledger.orbitshz.com',
      accountOrigin: 'https://orbitshz.com',
      identityProvider: 'orbit',
      isProduction: true
    }
  })
  t.after(running.close)

  const response = await fetch(`${running.baseUrl}/api/v1/auth/me`)
  assert.equal(response.status, 401)
})

test('production auth route rejects cross-origin writes', async t => {
  const authService = {
    register: async () => { throw new Error('must not be called') },
    login: async () => { throw new Error('must not be called') },
    logout: async () => {},
    getSession: async () => null
  }
  const running = await startApp({
    authService,
    config: { appOrigin: 'https://touji.example.com', isProduction: true }
  })
  t.after(running.close)

  const response = await fetch(`${running.baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'password-value' })
  })

  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { error: 'INVALID_ORIGIN' })
})

test('successful login sets an HttpOnly production cookie', async t => {
  const authService = {
    register: async () => { throw new Error('not used') },
    login: async () => ({
      token: 'raw-session-token',
      user: { id: 'user-1', email: 'owner@example.com', ledger: null }
    }),
    logout: async () => {},
    getSession: async () => null
  }
  const running = await startApp({
    authService,
    config: { appOrigin: 'https://touji.example.com', isProduction: true }
  })
  t.after(running.close)

  const response = await fetch(`${running.baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://touji.example.com' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'password-value' })
  })
  const cookie = response.headers.get('set-cookie')

  assert.equal(response.status, 200)
  assert.match(cookie, /^touji_session=raw-session-token;/)
  assert.match(cookie, /HttpOnly/i)
  assert.match(cookie, /Secure/i)
  assert.match(cookie, /SameSite=Lax/i)
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
})
