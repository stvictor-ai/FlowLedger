import express from 'express'
import { createAuthRouter } from './modules/auth/routes.js'
import { createRequireAuth, requireAdmin } from './modules/auth/middleware.js'
import { createAdminRouter } from './modules/admin/routes.js'
import { createSyncRouter } from './modules/sync/routes.js'
import { createOriginGuard } from './middleware/origin.js'
import { securityHeaders } from './middleware/security.js'

export function createApp({
  clock = () => new Date(),
  authService = null,
  adminService = null,
  syncService = null,
  database = null,
  config = {
    appOrigin: 'http://127.0.0.1:8787',
    isProduction: false
  }
} = {}) {
  const app = express()

  app.disable('x-powered-by')
  if (config.isProduction) app.set('trust proxy', 1)
  app.use(express.json({ limit: '10mb' }))
  app.use('/api', securityHeaders)
  app.use('/api/v1', createOriginGuard({
    appOrigin: config.appOrigin,
    requireOrigin: config.isProduction
  }))

  app.get('/api/v1/health', (_request, response) => {
    response.json({
      status: 'ok',
      service: 'touji-api',
      database: 'not_checked',
      timestamp: clock().toISOString()
    })
  })

  app.get('/api/v1/health/ready', async (_request, response) => {
    if (!database) {
      return response.status(503).json({ status: 'unavailable', database: 'not_configured' })
    }
    try {
      await database.query('SELECT 1')
      return response.json({ status: 'ready', database: 'ok' })
    } catch {
      return response.status(503).json({ status: 'unavailable', database: 'error' })
    }
  })

  if (authService) {
    app.use('/api/v1/auth', createAuthRouter({
      authService,
      isProduction: config.isProduction
    }))
    if (adminService) {
      app.use(
        '/api/v1/admin',
        createRequireAuth(authService),
        requireAdmin,
        createAdminRouter({ adminService })
      )
    }
    if (syncService) {
      app.use(
        '/api/v1/ledgers/:ledgerId/sync',
        createRequireAuth(authService),
        createSyncRouter({ syncService })
      )
    }
  }

  app.use((_request, response) => {
    response.status(404).json({ error: 'NOT_FOUND' })
  })

  app.use((error, _request, response, _next) => {
    const status = error?.type === 'entity.too.large' ? 413 : 500
    response.status(status).json({
      error: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR'
    })
  })

  return app
}
