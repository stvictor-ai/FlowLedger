import { parseCookie } from 'cookie'

export const SESSION_COOKIE = 'touji_session'

export function readSessionToken(request) {
  return parseCookie(request.headers.cookie || '')[SESSION_COOKIE] || ''
}

export function createRequireAuth(authService) {
  return async function requireAuth(request, response, next) {
    const user = await authService.getSession(readSessionToken(request))
    if (!user) return response.status(401).json({ error: 'UNAUTHENTICATED' })
    request.auth = user
    return next()
  }
}
