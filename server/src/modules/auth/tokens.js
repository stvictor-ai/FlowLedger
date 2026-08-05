import { createHash, randomBytes } from 'node:crypto'

export function createSessionToken() {
  return randomBytes(32).toString('base64url')
}

export function createInviteCode() {
  return `TJI-${randomBytes(12).toString('base64url').toUpperCase()}`
}

export function normalizeInviteCode(value) {
  return String(value || '').trim().toUpperCase()
}

export function hashSecret(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}
