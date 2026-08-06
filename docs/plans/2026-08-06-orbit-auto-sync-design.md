# Orbit automatic ledger sync

## Goal

After a user has explicitly resolved the first local/server migration, normal
ledger changes should save to Orbit automatically while preserving the local
browser copy as the immediate source of durability.

## Behavior

- Local writes remain immediate. Server writes are debounced by 1.2 seconds.
- Automatic sync is enabled per Orbit account only after the first migration is
  resolved. Two non-empty, different ledgers always require explicit review.
- An empty device may download an existing server ledger automatically. Two
  empty ledgers, or two already-identical ledgers, can enable automatic sync
  without a migration prompt.
- Each server flush pulls the current revision, merges records and tombstones by
  ID and `updatedAt`, then writes the complete merged snapshot.
- A revision conflict triggers one fresh pull, merge, and retry.
- Failed or offline writes stay in local storage and retry when the browser comes
  online, returns to the foreground, or reaches the periodic retry interval.
- Manual compare, upload, download, and merge actions remain available as a
  recovery path.

## Safety invariants

- No automatic server write occurs before first-migration approval.
- Remote deletion tombstones are persisted locally before the merged snapshot is
  uploaded, preventing deleted records from reappearing on another device.
- Logging out clears visible reactive data but does not delete the account-scoped
  local backup.
- Automatic sync state is stored under the Orbit account ID and cannot leak to a
  different account.
