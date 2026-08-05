import { createInviteCode, hashSecret } from '../auth/tokens.js'

export class AdminError extends Error {
  constructor(code, status = 400) {
    super(code)
    this.name = 'AdminError'
    this.code = code
    this.status = status
  }
}

export function createAdminService({ repository, secret, clock = () => new Date() }) {
  return {
    summary() {
      return repository.summary()
    },

    listUsers() {
      return repository.listUsers()
    },

    async updateUserStatus({ actorId, userId, status }) {
      if (actorId === userId) throw new AdminError('SELF_MANAGEMENT_FORBIDDEN', 400)
      const user = await repository.updateUserStatus({ userId, status, now: clock() })
      if (!user) throw new AdminError('USER_NOT_FOUND', 404)
      return user
    },

    listInvitations() {
      return repository.listInvitations()
    },

    async createInvitation({ actorId, maxUses, expiresDays }) {
      const code = createInviteCode()
      const now = clock()
      const expiresAt = new Date(now.getTime() + expiresDays * 24 * 60 * 60 * 1000)
      const invitation = await repository.createInvitation({
        codeHash: hashSecret(code, secret),
        maxUses,
        expiresAt,
        createdBy: actorId
      })
      return { invitation, code }
    },

    async revokeInvitation(inviteId) {
      const invitation = await repository.revokeInvitation({ inviteId, now: clock() })
      if (!invitation) throw new AdminError('INVITATION_NOT_FOUND', 404)
      return invitation
    }
  }
}

