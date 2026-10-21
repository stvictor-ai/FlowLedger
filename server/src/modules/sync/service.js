const MAX_ITEMS_PER_COLLECTION = 10000
// A household has a handful of loans; this only bounds a runaway client.
const MAX_DEBTS = 2000

export class SyncError extends Error {
  constructor(code, status, details = null) {
    super(code)
    this.name = 'SyncError'
    this.code = code
    this.status = status
    this.details = details
  }
}

function assertUniqueState(items, deletedIds, label) {
  const ids = new Set()
  for (const item of items) {
    if (ids.has(item.id)) throw new SyncError('DUPLICATE_ID', 400, { collection: label, id: item.id })
    ids.add(item.id)
  }
  for (const id of Object.keys(deletedIds)) {
    if (ids.has(id)) throw new SyncError('ACTIVE_DELETED_COLLISION', 400, { collection: label, id })
  }
}

/**
 * Debts arrived after the first clients shipped. An old cached PWA sends no
 * `debts` key at all, and treating that as "no debts" would wipe them, so
 * absence is passed on as absence and the repository leaves the table alone.
 * Tombstones without the list are dropped for the same reason: debts are
 * replaced as one collection or not at all.
 */
function normaliseDebts(snapshot) {
  const { debts, deletedDebtIds, ...rest } = snapshot
  if (!Array.isArray(debts)) return rest
  return { ...rest, debts, deletedDebtIds: deletedDebtIds || {} }
}

export function createSyncService({ repository }) {
  return {
    async readSnapshot({ userId, ledgerId }) {
      const snapshot = await repository.readSnapshot({ userId, ledgerId })
      if (!snapshot) throw new SyncError('LEDGER_NOT_FOUND', 404)
      return snapshot
    },

    async writeSnapshot({ userId, ledgerId, baseRevision, snapshot: input }) {
      const snapshot = normaliseDebts(input)
      if (snapshot.entries.length + Object.keys(snapshot.deletedIds).length > MAX_ITEMS_PER_COLLECTION) {
        throw new SyncError('TOO_MANY_ENTRIES', 413)
      }
      if (snapshot.positions.length + Object.keys(snapshot.deletedPositionIds).length > MAX_ITEMS_PER_COLLECTION) {
        throw new SyncError('TOO_MANY_POSITIONS', 413)
      }
      if (snapshot.debts && snapshot.debts.length + Object.keys(snapshot.deletedDebtIds).length > MAX_DEBTS) {
        throw new SyncError('TOO_MANY_DEBTS', 413)
      }
      assertUniqueState(snapshot.entries, snapshot.deletedIds, 'entries')
      assertUniqueState(snapshot.positions, snapshot.deletedPositionIds, 'positions')
      if (snapshot.debts) assertUniqueState(snapshot.debts, snapshot.deletedDebtIds, 'debts')

      const result = await repository.writeSnapshot({
        userId,
        ledgerId,
        baseRevision,
        snapshot
      })
      if (result.status === 'not_found') throw new SyncError('LEDGER_NOT_FOUND', 404)
      if (result.status === 'conflict') {
        throw new SyncError('REVISION_CONFLICT', 409, { revision: result.revision })
      }
      return result
    }
  }
}

export const syncCollectionLimit = MAX_ITEMS_PER_COLLECTION
export const syncDebtLimit = MAX_DEBTS
