import { Router } from 'express'
import { z } from 'zod'
import { feedMaxLimit } from './service.js'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const querySchema = z.object({
  since: dateSchema.optional(),
  until: dateSchema.optional(),
  include: z.enum(['cash', 'all']).default('cash'),
  limit: z.coerce.number().int().positive().max(feedMaxLimit).default(feedMaxLimit)
}).strict()

export function createFeedRouter({ feedService }) {
  const router = Router()

  // Describes the feed to whoever is calling it — an agent can read this
  // instead of being told the shape out of band.
  router.get('/', (request, response) => {
    response.json({
      service: 'touji-feed',
      ledger: { id: request.apiToken.ledger.id, name: request.apiToken.ledger.name },
      scope: request.apiToken.scope,
      endpoints: [{
        path: '/api/v1/feed/cashflows',
        method: 'GET',
        description: '按时间升序返回该账本的出入金记录，含折合人民币金额与区间汇总。',
        query: {
          since: 'YYYY-MM-DD，可选，含当天',
          until: 'YYYY-MM-DD，可选，含当天',
          include: 'cash（默认，仅出入金）或 all（并入买入卖出）',
          limit: `1-${feedMaxLimit}，默认 ${feedMaxLimit}，超出时保留最近的部分`
        }
      }]
    })
  })

  router.get('/cashflows', async (request, response) => {
    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) {
      return response.status(400).json({
        error: 'INVALID_QUERY',
        details: parsed.error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      })
    }

    const { since = null, until = null, include, limit } = parsed.data
    if (since && until && since > until) {
      return response.status(400).json({ error: 'INVALID_RANGE' })
    }

    const payload = await feedService.readCashflows({
      token: request.apiToken,
      since,
      until,
      includeTrades: include === 'all',
      limit
    })
    // Balances are private and change without notice; never let a proxy hold
    // on to a copy.
    response.set('Cache-Control', 'no-store')
    return response.json(payload)
  })

  return router
}
