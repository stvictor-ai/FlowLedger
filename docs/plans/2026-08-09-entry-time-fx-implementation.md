# Entry Time And FX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Record entry time to the minute and preserve the actual exchange rate and both sides of foreign-currency deposits.

**Architecture:** Add a framework-independent UMD entry engine for time normalization, chronological sorting, CNY valuation, and FX conversion. Keep Vue responsible for form state and persistence while extending the existing entry payload with optional backward-compatible fields.

**Tech Stack:** Vue 3 CDN, plain JavaScript UMD modules, Node built-in test runner, SheetJS, localStorage, JSONB server sync.

---

### Task 1: Entry calculation engine

**Files:**
- Create: `js/entry-engine.js`
- Create: `tests/entry-engine.test.js`
- Modify: `index.html`
- Modify: `sw.js`

1. Add failing tests for time normalization, date-time sorting, exact CNY source totals, and FX target calculation.
2. Implement the pure helpers and load the module before the Vue application.
3. Add the engine to the service worker asset cache.
4. Run `node --test tests/entry-engine.test.js`.

### Task 2: Entry form and persistence

**Files:**
- Modify: `index.html`

1. Add `time`, `sourceAmount`, and FX-derived preview state to the quick form.
2. Show the foreign deposit conversion fields only for non-CNY deposits.
3. Allow automatic rate lookup and manual override through the same rate input.
4. Persist the optional source/target fields and reset them correctly after save.
5. Add time and FX fields to desktop and mobile editing.

### Task 3: Ledger presentation and data portability

**Files:**
- Modify: `index.html`
- Modify: `js/server-sync.js`
- Modify: `tests/server-sync.test.js`

1. Sort entries by date and time and display time in ledger rows.
2. Show converted cash flows as `source -> target @ rate`.
3. Include new fields in sync fingerprints and duplicate detection.
4. Import and export the new Excel columns.
5. Make server-side summaries use the exact CNY source amount.

### Task 4: Documentation and verification

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

1. Document minute-level timestamps and per-entry FX records.
2. Run all browser and server unit tests.
3. Run `git diff --check`.
4. Verify the quick-entry form and ledger on desktop and mobile screenshots.

