import { randomBytes } from 'node:crypto'
import { hashSecret } from '../auth/tokens.js'

const MAX_ACTIVE_TOKENS = 10
export const TOKEN_SCOPE = 'cashflows:read'
export const DEBTS_SCOPE = 'debts:read'
// Every token reads cash flows; debts are opt-in on top. The stored string is
// joined in this order, which is what the CHECK in migration 005 expects.
export const TOKEN_SCOPES = [TOKEN_SCOPE, DEBTS_SCOPE]
const TOKEN_PREFIX = 'tjk_'

export class TokenError extends Error {
  constructor(code, status) {
    super(code)
    this.name = 'TokenError'
    this.code = code
    this.status = status
  }
}

export function createApiToken() {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
}

/** Space-separated, OAuth style. */
export function parseScopes(scope) {
  return String(scope || '').split(/\s+/).filter(Boolean)
}

/** Canonical, de-duplicated scope string, or null if it is not grantable. */
function formatScopes(scopes) {
  const wanted = new Set(Array.isArray(scopes) ? scopes : [])
  if (!wanted.has(TOKEN_SCOPE)) return null
  if ([...wanted].some(scope => !TOKEN_SCOPES.includes(scope))) return null
  return TOKEN_SCOPES.filter(scope => wanted.has(scope)).join(' ')
}

function withScopes(record) {
  return { ...record, scopes: parseScopes(record.scope) }
}

export function createTokenService({ repository, pepper = '' }) {
  return {
    /**
     * Resolves a bearer token to the ledger it may read. Returns null for every
     * failure — unknown, revoked, ledger deleted — so a caller cannot tell them
     * apart by probing.
     */
    async authenticate(rawToken) {
      const token = String(rawToken || '').trim()
      if (!token.startsWith(TOKEN_PREFIX) || token.length < 20) return null
      const found = await repository.findActiveByHash(hashSecret(token, pepper))
      if (!found) return null
      // Last-used is bookkeeping; a write failure must not break the read.
      repository.touch(found.id).catch(() => {})
      return found
    },

    async list(userId) {
      return (await repository.list(userId)).map(withScopes)
    },

    async create({ userId, name, ledgerId = null, scopes = [TOKEN_SCOPE] }) {
      const label = String(name || '').trim()
      if (!label || label.length > 60) throw new TokenError('INVALID_NAME', 400)
      // The route already validates; this guards every other caller.
      const scope = formatScopes(scopes)
      if (!scope) throw new TokenError('INVALID_SCOPE', 400)

      const active = await repository.countActive(userId)
      if (active >= MAX_ACTIVE_TOKENS) throw new TokenError('TOO_MANY_TOKENS', 409)

      const ledger = ledgerId
        ? await repository.findLedger({ userId, ledgerId })
        : await repository.firstLedger(userId)
      if (!ledger) throw new TokenError('LEDGER_NOT_FOUND', 404)

      const token = createApiToken()
      const record = await repository.create({
        userId,
        ledgerId: ledger.id,
        name: label,
        prefix: token.slice(0, 12),
        tokenHash: hashSecret(token, pepper),
        scope
      })

      // The only time the secret exists outside the caller's machine.
      return { ...withScopes(record), ledgerName: ledger.name, token }
    },

    async revoke({ userId, id }) {
      const revoked = await repository.revoke({ userId, id })
      if (!revoked) throw new TokenError('TOKEN_NOT_FOUND', 404)
      return { status: 'revoked' }
    }
  }
}

export const maxActiveTokens = MAX_ACTIVE_TOKENS
