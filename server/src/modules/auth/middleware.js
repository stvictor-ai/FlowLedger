import { createHash, timingSafeEqual } from 'node:crypto'
import { parseCookie } from 'cookie'

export const SESSION_COOKIE = 'touji_session'

export function readSessionToken(request) {
  return parseCookie(request.headers.cookie || '')[SESSION_COOKIE] || ''
}

function sameSecret(given, expected) {
  const digest = value => createHash('sha256').update(String(value)).digest()
  return timingSafeEqual(digest(given), digest(expected))
}

// The headers below are only as trustworthy as the hop that set them. When a
// proxy secret is configured, a request without it is treated as carrying no
// identity at all, however well-formed its headers are.
function orbitIdentity(request, proxySecret) {
  if (proxySecret && !sameSecret(request.get('x-orbit-proxy-secret') || '', proxySecret)) return null
  const orbitUserId = String(request.get('x-orbit-user-id') || '').trim()
  const orbitRole = String(request.get('x-orbit-user-role') || '').trim()
  const rawEmail = String(request.get('x-orbit-user-email') || '').trim().toLowerCase()
  if (!/^\d{1,20}$/.test(orbitUserId)) return null
  if (!['owner', 'friend'].includes(orbitRole)) return null
  const email = rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : null
  return {
    orbitUserId,
    email,
    role: orbitRole === 'owner' ? 'admin' : 'user'
  }
}

export function createRequireAuth(authService, config = {}) {
  return async function requireAuth(request, response, next) {
    const identity = config.identityProvider === 'orbit' ? orbitIdentity(request, config.orbitProxySecret) : null
    const user = config.identityProvider === 'orbit'
      ? await authService.getOrbitSession(identity || {})
      : await authService.getSession(readSessionToken(request))
    if (!user) return response.status(401).json({ error: 'UNAUTHENTICATED' })
    request.auth = user
    return next()
  }
}

export function requireAdmin(request, response, next) {
  if (request.auth?.role !== 'admin') {
    return response.status(403).json({ error: 'FORBIDDEN' })
  }
  return next()
}
