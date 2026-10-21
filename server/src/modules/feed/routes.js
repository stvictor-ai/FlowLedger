import { Router } from 'express'
import { z } from 'zod'
import { feedMaxLimit } from './service.js'
import { DEBTS_SCOPE, TOKEN_SCOPE } from '../tokens/service.js'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const querySchema = z.object({
  since: dateSchema.optional(),
  until: dateSchema.optional(),
  include: z.enum(['cash', 'all']).default('cash'),
  limit: z.coerce.number().int().positive().max(feedMaxLimit).default(feedMaxLimit)
}).strict()

// No parameters yet. Strict anyway, so a caller who expects ?since= to window
// the debts is told it does not, rather than silently getting everything.
const debtsQuerySchema = z.object({}).strict()

const ENDPOINTS = [{
  scope: TOKEN_SCOPE,
  path: '/api/v1/feed/cashflows',
  method: 'GET',
  description: '按时间升序返回该账本的出入金与平台互转记录，含折合人民币金额与区间汇总；互转不计入收支。',
  query: {
    since: 'YYYY-MM-DD，可选，含当天',
    until: 'YYYY-MM-DD，可选，含当天',
    include: 'cash（默认，出入金与互转）或 all（并入买入卖出）',
    limit: `1-${feedMaxLimit}，默认 ${feedMaxLimit}，超出时保留最近的部分`
  }
}, {
  scope: DEBTS_SCOPE,
  path: '/api/v1/feed/debts',
  method: 'GET',
  description: '返回该账本的借款、每笔还款（含流水里关联该借款的还本/付息出金）、剩余本金与还款计划。需要 debts:read 作用域。',
  query: {}
}]

function sendInvalidQuery(response, error) {
  return response.status(400).json({
    error: 'INVALID_QUERY',
    details: error.issues.map(issue => ({
      field: issue.path.join('.'),
      message: issue.message
    }))
  })
}

/** 403, not 401: the token is fine, it just was not granted this. */
function requireScope(scope) {
  return function checkScope(request, response, next) {
    if (request.apiToken.scopes.includes(scope)) return next()
    response.set('WWW-Authenticate', `Bearer realm="touji", error="insufficient_scope", scope="${scope}"`)
    return response.status(403).json({ error: 'INSUFFICIENT_SCOPE', required: scope })
  }
}

export function createFeedRouter({ feedService }) {
  const router = Router()

  // Describes the feed to whoever is calling it — an agent can read this
  // instead of being told the shape out of band. Only what this token may
  // call is listed, so the index never advertises a 403.
  router.get('/', (request, response) => {
    response.json({
      service: 'touji-feed',
      ledger: { id: request.apiToken.ledger.id, name: request.apiToken.ledger.name },
      scope: request.apiToken.scope,
      endpoints: ENDPOINTS
        .filter(endpoint => request.apiToken.scopes.includes(endpoint.scope))
        .map(({ scope: _scope, ...endpoint }) => endpoint)
    })
  })

  router.get('/cashflows', requireScope(TOKEN_SCOPE), async (request, response) => {
    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) return sendInvalidQuery(response, parsed.error)

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

  router.get('/debts', requireScope(DEBTS_SCOPE), async (request, response) => {
    const parsed = debtsQuerySchema.safeParse(request.query)
    if (!parsed.success) return sendInvalidQuery(response, parsed.error)

    const payload = await feedService.readDebts({ token: request.apiToken })
    response.set('Cache-Control', 'no-store')
    return response.json(payload)
  })

  return router
}
