# Year Filters Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add year dropdown filters to flow records and review while preserving the existing date shortcuts and local data model.

**Architecture:** Flow records gain a `filters.year` value that narrows month options and participates in the existing matching predicate. Review gains a separate `reviewYear` value; when selected, it overrides the rolling date window for summaries, signals, timeline, and calendar initialization without changing stored entries or notes.

**Tech Stack:** Vue 3 CDN, Day.js, existing localStorage settings, Node built-in tests.

---

### Task 1: Add Year-Aware Filter Models

**Files:**
- Modify: `index.html`
- Test: `tests/review-engine.test.js`

**Step 1:** Add computed available years from dated entries and narrow month options by the selected flow-record year.

**Step 2:** Add `filters.year` to matching, active-filter detection, and clear-filter behavior.

**Step 3:** Add a persisted review year selection. A selected year uses `YYYY-01-01` through `YYYY-12-31`; an empty value retains the existing 30/90/180-day and current-year shortcuts.

### Task 2: Add Controls And Verify

**Files:**
- Modify: `index.html`

**Step 1:** Add a compact year select before the flow-record month select.

**Step 2:** Add a compact year select next to the review range buttons.

**Step 3:** Verify empty years, historical years, narrow desktop layout, and 390px mobile layout. Run `node --test tests/review-engine.test.js`, extract and syntax-check the inline app script, and run `git diff --check`.
