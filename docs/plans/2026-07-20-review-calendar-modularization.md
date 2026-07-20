# Review Calendar And Modularization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an automatic review calendar, explainable behavior signals, a recent activity timeline, and daily review notes while extracting the review calculations from the single-file app.

**Architecture:** Add a framework-independent UMD module at `js/review-engine.js` so the browser can load it with a normal script tag and Node can test it without a build step. Vue keeps ownership of reactive state and localStorage; the module only receives normalized entries, position values, rules, and dates, then returns immutable calendar and signal models.

**Tech Stack:** Plain JavaScript UMD, Vue 3 CDN, Day.js, Node built-in test runner, existing CSS design tokens.

---

### Task 1: Create The Review Engine Contract

**Files:**
- Create: `js/review-engine.js`
- Create: `tests/review-engine.test.js`

**Step 1: Write failing tests**

Cover month-grid generation, large cash-flow signals, FOMO signals, loss-sale signals, rolling dense-buy signals, concentration signals, and timeline sorting.

**Step 2: Run tests and verify failure**

Run: `node --test tests/review-engine.test.js`

Expected: FAIL because `js/review-engine.js` does not exist.

**Step 3: Implement the pure module**

Expose:

```js
ToujiReview.buildSignals(entries, positions, rules, today)
ToujiReview.buildCalendarMonth(monthKey, entries, signals, noteDates, today)
ToujiReview.buildTimeline(entries, signals, limit)
```

The module must not read localStorage, access the DOM, mutate inputs, or make network requests.

**Step 4: Run tests**

Run: `node --test tests/review-engine.test.js`

Expected: all tests PASS.

### Task 2: Load The Module In The Static App

**Files:**
- Modify: `index.html`
- Modify: `sw.js`

**Step 1: Load `js/review-engine.js` before the Vue application script**

Use a normal script tag to preserve direct static hosting and avoid a build step.

**Step 2: Bump the application version and Service Worker cache name**

The new local module must refresh reliably on GitHub Pages.

**Step 3: Run syntax checks**

Run:

```bash
node --check js/review-engine.js
node --check /private/tmp/touji-app.js
```

Expected: both commands exit successfully.

### Task 3: Connect Reactive Review Models

**Files:**
- Modify: `index.html`

**Step 1: Normalize review entries for the engine**

Add CNY amount and normalized tags without modifying stored entry objects.

**Step 2: Add computed models**

Create computed values for review signals, the visible calendar month, selected-day entries, selected-day signals, and the recent timeline.

**Step 3: Add calendar navigation**

Support previous month, next month, current month, and selecting a date.

**Step 4: Add daily note persistence**

Store notes under `touji_review_day_notes_v1`, keyed by `YYYY-MM-DD`. Editing an entry should automatically update the calendar; notes remain user-authored.

### Task 4: Build The Calendar And Timeline UI

**Files:**
- Modify: `index.html`

**Step 1: Add a seven-column calendar**

Every day cell has stable dimensions and may show entry-type dots, signal state, selection state, today state, and note state.

**Step 2: Add selected-day details**

Show entries, rule signals, the exact trigger reason, and a daily note editor.

**Step 3: Add recent signal timeline**

Show the newest operations and their attached automatic rule labels.

**Step 4: Add responsive styles**

Verify the layout at desktop, 1280x720, and 390x844 without overlap or horizontal scrolling.

### Task 5: Verify And Document

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Step 1: Run automated tests and static checks**

Run:

```bash
node --test tests/review-engine.test.js
git diff --check
```

**Step 2: Browser-test automatic updates**

Load anonymous demo data, open Review, navigate months, select a day, confirm signals explain their reasons, save a daily note, and verify mobile layout.

**Step 3: Update documentation**

Document that timeline facts and rule signals are generated locally after every entry edit. Document the new module and tests.

**Step 4: Commit only project files**

Do not include local design drafts or user data.
