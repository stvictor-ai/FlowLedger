import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { readSessionToken, SESSION_COOKIE } from './middleware.js'
import { AuthError, authSessionDurationMs } from './service.js'

const emailSchema = z.string().trim().toLowerCase().email().max(254)
const passwordSchema = z.string().min(10).max(128)
const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  inviteCode: z.string().trim().min(8).max(128)
}).strict()
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128)
}).strict()

function cookieOptions(isProduction) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: authSessionDurationMs,
    path: '/'
  }
}

function clearCookieOptions(isProduction) {
  const { maxAge: _maxAge, ...options } = cookieOptions(isProduction)
  return options
}

function sendAuthError(response, error) {
  if (error instanceof AuthError) {
    return response.status(error.status).json({ error: error.code })
  }
  throw error
}

export function createAuthRouter({ authService, isProduction, requireAuth, identityProvider = 'session' }) {
  const router = Router()
  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'TOO_MANY_REQUESTS' }
  })

  router.post('/register', limiter, async (request, response) => {
    if (identityProvider === 'orbit') return response.status(404).json({ error: 'NOT_FOUND' })
    const parsed = registerSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_INPUT' })
    try {
      const result = await authService.register(parsed.data)
      response.cookie(SESSION_COOKIE, result.token, cookieOptions(isProduction))
      return response.status(201).json({ user: result.user })
    } catch (error) {
      return sendAuthError(response, error)
    }
  })

  router.post('/login', limiter, async (request, response) => {
    if (identityProvider === 'orbit') return response.status(404).json({ error: 'NOT_FOUND' })
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_INPUT' })
    try {
      const result = await authService.login(parsed.data)
      response.cookie(SESSION_COOKIE, result.token, cookieOptions(isProduction))
      return response.json({ user: result.user })
    } catch (error) {
      return sendAuthError(response, error)
    }
  })

  router.post('/logout', async (request, response) => {
    if (identityProvider === 'orbit') return response.status(404).json({ error: 'NOT_FOUND' })
    await authService.logout(readSessionToken(request))
    response.clearCookie(SESSION_COOKIE, clearCookieOptions(isProduction))
    return response.status(204).end()
  })

  router.get('/me', requireAuth, (request, response) => response.json({ user: request.auth }))

  return router
}
