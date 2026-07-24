# Editorial Investment Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Replace the card-heavy overview with an editorial investment snapshot that explains current holdings, true return, capital movement, and allocation at a glance.

**Architecture:** Keep the existing Vue 3 single-file application and derive all new overview values from the current `entries`, `positions`, exchange rates, and live price cache. Add presentation-only computed values for allocation and top holdings; do not change localStorage keys, import/export formats, or transaction/position models.

**Tech Stack:** Single-file HTML, Vue 3 CDN, existing CSS theme variables, Chart.js-independent CSS visualization, Day.js.

---

### Task 1: Replace the overview hierarchy

**Files:**
- Modify: `index.html` overview template

1. Replace the separate hero, return card, and repeated metric cards with one `overview-dashboard` section.
2. Present current holdings value as the primary figure and true return as the primary interpretation.
3. Add a capital equation showing current holdings plus withdrawals minus deposits equals true return.
4. Keep language and privacy controls in the dashboard header.

### Task 2: Add allocation and complete holding rows

**Files:**
- Modify: `index.html` Vue computed state

1. Extract an unfiltered `allPositionRows` computed collection.
2. Keep `posRows` as the positions-page market-filtered view.
3. Add `overviewTopPositions`, sorted by current value.
4. Add `overviewAllocation`, grouped by normalized asset type and limited to the largest categories.
5. Add a latest local ledger update label derived from existing `updatedAt` values.

### Task 3: Refine overview modules and navigation

**Files:**
- Modify: `index.html` overview template and CSS

1. Style the dashboard as a calm, editorial financial statement instead of nested cards.
2. Use CSS allocation bars with existing asset colors.
3. Keep major holdings and recent activity below the snapshot.
4. Make recent activity navigate to the ledger and open the selected record.
5. Preserve compact single-column behavior on narrow screens.

### Task 4: Verify and commit

**Files:**
- Modify: `index.html`
- Modify: `sw.js`

1. Bump the application and service-worker cache version together.
2. Run inline JavaScript syntax validation.
3. Run import and review engine tests.
4. Run `git diff --check`.
5. Confirm no storage keys or persisted data models changed.
6. Commit only the dashboard files and plan; leave personal untracked design files untouched.
