import { loadConfig } from '../src/config.js'
import { createPool } from '../src/db/pool.js'
import { runMigrations } from '../src/db/migrate.js'
import { createAuthRepository } from '../src/modules/auth/repository.js'
import { createInviteCode, hashSecret } from '../src/modules/auth/tokens.js'

const maxUses = Number(process.env.INVITE_MAX_USES || 1)
const expiresDays = Number(process.env.INVITE_EXPIRES_DAYS || 14)
const role = String(process.env.INVITE_ROLE || 'user').trim().toLowerCase()
if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100) {
  throw new Error('INVITE_MAX_USES must be an integer between 1 and 100')
}
if (!Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > 365) {
  throw new Error('INVITE_EXPIRES_DAYS must be an integer between 1 and 365')
}
if (!['user', 'admin'].includes(role)) {
  throw new Error('INVITE_ROLE must be user or admin')
}

const config = loadConfig()
const pool = createPool(config)
try {
  await runMigrations({ pool })
  const repository = createAuthRepository(pool)
  const code = createInviteCode()
  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000)
  await repository.createInvitation({
    codeHash: hashSecret(code, config.sessionSecret),
    maxUses,
    expiresAt,
    createdBy: null,
    role
  })
  console.log(`Invite code: ${code}`)
  console.log(`Role: ${role}`)
  console.log(`Uses: ${maxUses}`)
  console.log(`Expires: ${expiresAt.toISOString()}`)
} finally {
  await pool.end()
}
