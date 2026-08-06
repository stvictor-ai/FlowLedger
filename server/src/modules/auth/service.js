import { randomBytes } from 'node:crypto'
import { AuthRepositoryError } from './repository.js'
import { hashPassword, verifyPassword } from './password.js'
import {
  createSessionToken,
  hashSecret,
  normalizeInviteCode
} from './tokens.js'

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000

export class AuthError extends Error {
  constructor(code, status = 400) {
    super(code)
    this.name = 'AuthError'
    this.code = code
    this.status = status
  }
}

function publicUser(user, ledger) {
  const ledgerId = ledger?.id || ledger?.ledger_id
  return {
    id: user.id || user.user_id,
    orbitUserId: user.orbit_user_id || null,
    email: user.email,
    role: user.role || 'user',
    ledger: ledgerId ? {
      id: ledgerId,
      name: ledger.name || ledger.ledger_name,
      revision: Number(ledger.revision || 0)
    } : null
  }
}

export function createAuthService({ repository, clock = () => new Date(), secret = '' }) {
  const dummyPasswordHash = hashPassword(randomBytes(24).toString('base64url'))

  async function issueSession(userId) {
    const now = clock()
    const token = createSessionToken()
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS)
    await repository.createSession({
      userId,
      tokenHash: hashSecret(token, secret),
      expiresAt,
      now
    })
    return { token, expiresAt }
  }

  return {
    async getOrbitSession({ orbitUserId, email, role }) {
      if (!orbitUserId || !['admin', 'user'].includes(role)) return null
      const user = await repository.findOrCreateOrbitUser({ orbitUserId, email, role })
      return publicUser(user, user)
    },

    async register({ email, password, inviteCode }) {
      const normalizedEmail = email.trim().toLowerCase()
      const passwordHash = await hashPassword(password)
      try {
        const result = await repository.registerUser({
          email: normalizedEmail,
          passwordHash,
          inviteCodeHash: hashSecret(normalizeInviteCode(inviteCode), secret),
          now: clock()
        })
        if (!result) throw new AuthError('REGISTRATION_FAILED', 400)
        const session = await issueSession(result.user.id)
        return {
          user: publicUser(result.user, result.ledger),
          ...session
        }
      } catch (error) {
        if (error instanceof AuthError) throw error
        if (error instanceof AuthRepositoryError && error.code === 'EMAIL_TAKEN') {
          throw new AuthError('REGISTRATION_FAILED', 400)
        }
        throw error
      }
    },

    async login({ email, password }) {
      const user = await repository.findUserByEmail(email.trim().toLowerCase())
      const passwordHash = user?.password_hash || await dummyPasswordHash
      const valid = await verifyPassword(passwordHash, password)
      if (!user || !valid || user.status !== 'active') {
        throw new AuthError('INVALID_CREDENTIALS', 401)
      }
      const session = await issueSession(user.id)
      return { user: publicUser(user, user), ...session }
    },

    async getSession(token) {
      if (!token) return null
      const session = await repository.findSession({
        tokenHash: hashSecret(token, secret),
        now: clock()
      })
      if (!session) return null
      return publicUser(session, session)
    },

    async logout(token) {
      if (token) await repository.deleteSession(hashSecret(token, secret))
    }
  }
}

export const authSessionDurationMs = SESSION_DURATION_MS
