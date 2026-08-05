import express from 'express'

export function createApp({ clock = () => new Date() } = {}) {
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json({ limit: '10mb' }))

  app.get('/api/v1/health', (_request, response) => {
    response.json({
      status: 'ok',
      service: 'touji-api',
      database: 'not_checked',
      timestamp: clock().toISOString()
    })
  })

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
