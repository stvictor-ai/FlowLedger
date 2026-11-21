const MAX_ITEMS_PER_COLLECTION = 10000
// A household has a handful of loans; this only bounds a runaway client.
const MAX_DEBTS = 2000

// What the client's ledger format knows about. A page left open (or a PWA
// resumed from memory) keeps running old code long after a release: it drops
// every field it has never heard of when it reads the ledger, then writes the
// whole thing back. Clients state their version in X-Touji-Schema; the two
// generations that predate the header are told apart by whether they send
// debts. Bump this, and list the new fields below, whenever entries gain one.
export const SYNC_SCHEMA = 4
const ENTRY_FIELDS_SINCE = {
  2: ['fundSource', 'destination', 'loanId', 'toExchange'],
  3: ['channel', 'counterparty']
}
// The debts collection holds more than loans: each document says what it is in
// `kind`. A client drops the kinds it has never heard of when it reads them,
// so the same reasoning applies to whole documents here as to fields above.
const DEBT_KINDS_SINCE = {
  4: ['balance']
}

export function clientSchemaOf(declared, snapshot) {
  const version = Number(declared)
  if (Number.isInteger(version) && version >= 1 && version <= 100000) return version
  return Array.isArray(snapshot?.debts) ? 2 : 1
}

function stamp(item) {
  return Number(item?.updatedAt) || 0
}

/**
 * Rewrites what an outdated client sent so it cannot destroy what it cannot
 * see. Three things such a client gets wrong, and what is done about each:
 *  - a record it did not edit comes back stripped (same timestamp): the stored
 *    copy is kept whole;
 *  - a record it did edit lacks the newer fields: those are carried over;
 *  - a record of a type it does not know was dropped on read, so it is simply
 *    missing: kept, unless the client sent a tombstone for it. The same goes
 *    for documents in the debts collection whose kind is newer than the client.
 * A current client is never routed through here — its snapshot replaces the
 * ledger as sent.
 */
export function protectFromOutdatedClient(snapshot, storedEntries, clientSchema, storedDebts = []) {
  const newer = Object.entries(ENTRY_FIELDS_SINCE)
    .filter(([version]) => Number(version) > clientSchema)
    .flatMap(([, fields]) => fields)
  const stored = new Map(storedEntries.map(item => [item.id, item]))
  const sent = new Set()
  const entries = snapshot.entries.map(item => {
    sent.add(item.id)
    const kept = stored.get(item.id)
    if (!kept) return item
    if (stamp(item) <= stamp(kept)) return kept
    const carried = {}
    for (const field of newer) {
      if (!(field in item) && field in kept) carried[field] = kept[field]
    }
    return { ...item, ...carried }
  })
  for (const kept of storedEntries) {
    if (!sent.has(kept.id) && !(kept.id in snapshot.deletedIds)) entries.push(kept)
  }
  if (!Array.isArray(snapshot.debts)) return { ...snapshot, entries }

  const unknownKinds = new Set(Object.entries(DEBT_KINDS_SINCE)
    .filter(([version]) => Number(version) > clientSchema)
    .flatMap(([, kinds]) => kinds))
  const sentDebts = new Set(snapshot.debts.map(item => item.id))
  const tombstones = snapshot.deletedDebtIds || {}
  const debts = [...snapshot.debts]
  for (const kept of storedDebts) {
    if (unknownKinds.has(kept.kind) && !sentDebts.has(kept.id) && !(kept.id in tombstones)) debts.push(kept)
  }
  return { ...snapshot, entries, debts }
}

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

    async writeSnapshot({ userId, ledgerId, baseRevision, snapshot: input, clientSchema = SYNC_SCHEMA }) {
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

      const outdated = clientSchema < SYNC_SCHEMA
      const result = await repository.writeSnapshot({
        userId,
        ledgerId,
        baseRevision,
        snapshot,
        // Runs inside the write transaction, against the rows about to be
        // replaced, so nothing can slip in between the read and the write.
        reconcile: outdated
          ? stored => protectFromOutdatedClient(snapshot, stored.entries, clientSchema, stored.debts)
          : null
      })
      if (result.status === 'not_found') throw new SyncError('LEDGER_NOT_FOUND', 404)
      if (result.status === 'conflict') {
        throw new SyncError('REVISION_CONFLICT', 409, { revision: result.revision })
      }
      // Lets a client that understands the flag ask its user to reload.
      return outdated ? { ...result, clientOutdated: true } : result
    }
  }
}

export const syncCollectionLimit = MAX_ITEMS_PER_COLLECTION
export const syncDebtLimit = MAX_DEBTS
