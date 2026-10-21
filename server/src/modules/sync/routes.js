import { Router } from 'express'
import { z } from 'zod'
import { SyncError, syncDebtLimit } from './service.js'

const idSchema = z.string().min(1).max(120)
const itemSchema = z.object({ id: idSchema }).loose()
const tombstoneSchema = z.record(idSchema, z.number().int().nonnegative())
const deletedSchema = tombstoneSchema.default({})
const snapshotSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  entries: z.array(itemSchema).max(10000),
  positions: z.array(itemSchema).max(10000),
  deletedIds: deletedSchema,
  deletedPositionIds: deletedSchema,
  // Optional with no default on purpose: a cached PWA from before debts sends
  // neither, and "absent" must stay distinguishable from "empty" so the
  // service can leave stored debts alone.
  debts: z.array(itemSchema).max(syncDebtLimit).optional(),
  deletedDebtIds: tombstoneSchema.optional()
}).strict()
const ledgerIdSchema = z.string().uuid()

function sendSyncError(response, error) {
  if (error instanceof SyncError) {
    return response.status(error.status).json({ error: error.code, details: error.details })
  }
  throw error
}

export function createSyncRouter({ syncService }) {
  const router = Router({ mergeParams: true })

  router.get('/', async (request, response) => {
    const ledgerId = ledgerIdSchema.safeParse(request.params.ledgerId)
    if (!ledgerId.success) return response.status(400).json({ error: 'INVALID_LEDGER_ID' })
    try {
      const snapshot = await syncService.readSnapshot({
        userId: request.auth.id,
        ledgerId: ledgerId.data
      })
      return response.json(snapshot)
    } catch (error) {
      return sendSyncError(response, error)
    }
  })

  router.put('/', async (request, response) => {
    const ledgerId = ledgerIdSchema.safeParse(request.params.ledgerId)
    if (!ledgerId.success) return response.status(400).json({ error: 'INVALID_LEDGER_ID' })
    const parsed = snapshotSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_SNAPSHOT' })
    const { baseRevision, ...snapshot } = parsed.data
    try {
      const result = await syncService.writeSnapshot({
        userId: request.auth.id,
        ledgerId: ledgerId.data,
        baseRevision,
        snapshot
      })
      return response.json(result)
    } catch (error) {
      return sendSyncError(response, error)
    }
  })

  return router
}
