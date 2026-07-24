# Review And Data Workspaces

## Goal

Make review and data management easier to scan on desktop while expanding position creation beyond the limited live-quote catalog.

## Review

- Keep the existing summary and year/range controls.
- Add three focused views: calendar, insights, and rules.
- Calendar contains the month grid, selected-day details, and recent activity.
- Insights contains behavior signals, conclusions, checklist, and notes.
- Rules contains triggered events and configurable local thresholds.
- Preserve the current review engine and local note storage.

## Data Center

- Merge cloud sync, import/export, snapshots, and import history into one workspace.
- Add navigation for cloud sync, transfer, and recovery.
- Keep GitHub Gist configuration and conflict previews unchanged.
- Keep Excel and JSON import/export behavior unchanged.
- Keep snapshots and import undo behavior unchanged.

## Position Creation

- Expand built-in asset types with bonds, REITs, FX, and cash management.
- Merge new built-in types with existing user-defined types.
- Show an explicit asset-type field while creating a position.
- Allow manual position creation when a quote-search result is unavailable.

## Safety

- Do not rename localStorage keys.
- Do not change transaction, position, sync, import, or backup schemas.
- Bump the app and service-worker cache versions together.
- Verify syntax, tests, and responsive layouts before committing.
