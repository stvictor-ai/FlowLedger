import { Router } from 'express'
import { z } from 'zod'
import { TokenError } from './service.js'

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  ledgerId: z.string().uuid().optional()
}).strict()

const idSchema = z.string().uuid()

function sendTokenError(response, error) {
  if (error instanceof TokenError) {
    return response.status(error.status).json({ error: error.code })
  }
  throw error
}

export function createTokenRouter({ tokenService }) {
  const router = Router()

  router.get('/', async (request, response) => {
    const tokens = await tokenService.list(request.auth.id)
    return response.json({ tokens })
  })

  router.post('/', async (request, response) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_BODY' })
    try {
      const created = await tokenService.create({
        userId: request.auth.id,
        name: parsed.data.name,
        ledgerId: parsed.data.ledgerId
      })
      // `token` appears in this response and nowhere else, ever.
      return response.status(201).json(created)
    } catch (error) {
      return sendTokenError(response, error)
    }
  })

  router.delete('/:id', async (request, response) => {
    const id = idSchema.safeParse(request.params.id)
    if (!id.success) return response.status(400).json({ error: 'INVALID_TOKEN_ID' })
    try {
      return response.json(await tokenService.revoke({ userId: request.auth.id, id: id.data }))
    } catch (error) {
      return sendTokenError(response, error)
    }
  })

  return router
}
