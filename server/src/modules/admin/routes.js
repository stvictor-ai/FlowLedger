import { Router } from 'express'
import { z } from 'zod'
import { AdminError } from './service.js'

const uuidSchema = z.string().uuid()
const statusSchema = z.object({
  status: z.enum(['active', 'disabled'])
}).strict()
const invitationSchema = z.object({
  maxUses: z.number().int().min(1).max(100).default(1),
  expiresDays: z.number().int().min(1).max(365).default(14)
}).strict()

function sendAdminError(response, error) {
  if (error instanceof AdminError) {
    return response.status(error.status).json({ error: error.code })
  }
  throw error
}

export function createAdminRouter({ adminService }) {
  const router = Router()

  router.get('/summary', async (_request, response) => {
    return response.json({ summary: await adminService.summary() })
  })

  router.get('/users', async (_request, response) => {
    return response.json({ users: await adminService.listUsers() })
  })

  router.patch('/users/:userId/status', async (request, response) => {
    const userId = uuidSchema.safeParse(request.params.userId)
    const body = statusSchema.safeParse(request.body)
    if (!userId.success || !body.success) {
      return response.status(400).json({ error: 'INVALID_INPUT' })
    }
    try {
      const user = await adminService.updateUserStatus({
        actorId: request.auth.id,
        userId: userId.data,
        status: body.data.status
      })
      return response.json({ user })
    } catch (error) {
      return sendAdminError(response, error)
    }
  })

  router.get('/invitations', async (_request, response) => {
    return response.json({ invitations: await adminService.listInvitations() })
  })

  router.post('/invitations', async (request, response) => {
    const body = invitationSchema.safeParse(request.body)
    if (!body.success) return response.status(400).json({ error: 'INVALID_INPUT' })
    const result = await adminService.createInvitation({
      actorId: request.auth.id,
      ...body.data
    })
    return response.status(201).json(result)
  })

  router.delete('/invitations/:inviteId', async (request, response) => {
    const inviteId = uuidSchema.safeParse(request.params.inviteId)
    if (!inviteId.success) return response.status(400).json({ error: 'INVALID_INPUT' })
    try {
      await adminService.revokeInvitation(inviteId.data)
      return response.status(204).end()
    } catch (error) {
      return sendAdminError(response, error)
    }
  })

  return router
}

