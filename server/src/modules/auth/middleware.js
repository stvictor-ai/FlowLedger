import { parseCookie } from 'cookie'

export const SESSION_COOKIE = 'touji_session'

export function readSessionToken(request) {
  return parseCookie(request.headers.cookie || '')[SESSION_COOKIE] || ''
}

function orbitIdentity(request) {
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
    const identity = config.identityProvider === 'orbit' ? orbitIdentity(request) : null
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
