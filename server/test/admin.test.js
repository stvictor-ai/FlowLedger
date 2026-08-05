import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { createApp } from '../src/app.js'
import { AdminError, createAdminService } from '../src/modules/admin/service.js'
import { hashSecret } from '../src/modules/auth/tokens.js'

const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const INVITE_ID = '33333333-3333-4333-8333-333333333333'
const NOW = new Date('2026-08-05T09:00:00.000Z')

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

function authService() {
  return {
    getSession: async token => {
      if (token === 'admin-session') return { id: ADMIN_ID, email: 'admin@example.com', role: 'admin' }
      if (token === 'user-session') return { id: USER_ID, email: 'user@example.com', role: 'user' }
      return null
    },
    register: async () => {},
    login: async () => {},
    logout: async () => {}
  }
}

test('admin routes reject ordinary users and return metadata only to admins', async t => {
  const adminService = {
    summary: async () => ({ users_total: 2, entries_total: 9, positions_total: 3 }),
    listUsers: async () => [{
      id: USER_ID,
      email: 'user@example.com',
      role: 'user',
      status: 'active',
      entries_count: 9,
      positions_count: 3
    }],
    listInvitations: async () => [],
    updateUserStatus: async () => {},
    createInvitation: async () => {},
    revokeInvitation: async () => {}
  }
  const running = await startApp({ authService: authService(), adminService })
  t.after(running.close)

  const forbidden = await fetch(`${running.baseUrl}/api/v1/admin/summary`, {
    headers: { Cookie: 'touji_session=user-session' }
  })
  assert.equal(forbidden.status, 403)
  assert.deepEqual(await forbidden.json(), { error: 'FORBIDDEN' })

  const users = await fetch(`${running.baseUrl}/api/v1/admin/users`, {
    headers: { Cookie: 'touji_session=admin-session' }
  })
  assert.equal(users.status, 200)
  const body = await users.json()
  assert.equal(body.users[0].email, 'user@example.com')
  assert.equal(JSON.stringify(body).includes('payload'), false)
})

test('admin service creates hashed ordinary invitations and blocks self management', async () => {
  const state = { invitation: null }
  const secret = 'admin-test-secret-value-long-enough'
  const repository = {
    summary: async () => ({}),
    listUsers: async () => [],
    listInvitations: async () => [],
    updateUserStatus: async data => ({ id: data.userId, status: data.status, role: 'user' }),
    createInvitation: async data => {
      state.invitation = data
      return { id: INVITE_ID, role: 'user', max_uses: data.maxUses, expires_at: data.expiresAt }
    },
    revokeInvitation: async () => ({ id: INVITE_ID })
  }
  const service = createAdminService({ repository, secret, clock: () => NOW })

  await assert.rejects(
    () => service.updateUserStatus({ actorId: ADMIN_ID, userId: ADMIN_ID, status: 'disabled' }),
    error => error instanceof AdminError && error.code === 'SELF_MANAGEMENT_FORBIDDEN'
  )

  const result = await service.createInvitation({ actorId: ADMIN_ID, maxUses: 2, expiresDays: 7 })
  assert.match(result.code, /^TJI-/)
  assert.equal(state.invitation.codeHash, hashSecret(result.code, secret))
  assert.equal(state.invitation.createdBy, ADMIN_ID)
  assert.equal(state.invitation.maxUses, 2)
  assert.equal(state.invitation.expiresAt.toISOString(), '2026-08-12T09:00:00.000Z')
})

test('admin status route validates input and forwards the authenticated actor', async t => {
  let update = null
  const adminService = {
    summary: async () => ({}),
    listUsers: async () => [],
    listInvitations: async () => [],
    createInvitation: async () => {},
    revokeInvitation: async () => {},
    updateUserStatus: async data => {
      update = data
      return { id: data.userId, role: 'user', status: data.status }
    }
  }
  const running = await startApp({ authService: authService(), adminService })
  t.after(running.close)

  const response = await fetch(`${running.baseUrl}/api/v1/admin/users/${USER_ID}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'touji_session=admin-session'
    },
    body: JSON.stringify({ status: 'disabled' })
  })
  assert.equal(response.status, 200)
  assert.deepEqual(update, { actorId: ADMIN_ID, userId: USER_ID, status: 'disabled' })

  const invalid = await fetch(`${running.baseUrl}/api/v1/admin/users/not-a-uuid/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'touji_session=admin-session'
    },
    body: JSON.stringify({ status: 'owner' })
  })
  assert.equal(invalid.status, 400)
})
