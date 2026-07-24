# Positions And Entry Workspaces Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Turn positions into a reading-first management workspace and simplify quick entry into a focused transaction ticket.

**Architecture:** Reuse the existing position rows, price cache, transaction linkage, target search, templates, and persistence methods. Add only transient UI state for the selected position and template selector; do not change transaction or position storage formats.

**Tech Stack:** Single-file HTML, Vue 3 CDN, existing CSS theme variables, Day.js, existing price/search APIs.

---

### Task 1: Build the position workspace

**Files:**
- Modify: `index.html`

1. Replace the chart and table stack with a page header, summary strip, market filter, position list, and detail inspector.
2. Sort visible positions by market value.
3. Select a position without navigating away.
4. Show quantity, average cost, current price, value, unrealized P/L, allocation, and linked records in the inspector.
5. Keep buy and sell actions connected to the existing entry form.
6. Preserve a compact mobile card list.

### Task 2: Simplify the entry ticket

**Files:**
- Modify: `index.html`

1. Move the four actions into one horizontal segmented control.
2. Replace the permanent explanation card with one concise active-action description.
3. For deposits and withdrawals, lead with currency and amount.
4. For buys and sells, lead with market, target, price, quantity, and calculated total in one stable grid.
5. Move date, asset type, note, tags, and common tags into the optional section.
6. Replace the template button collection with one template select.
7. Keep copy-last, save, and save-and-continue behavior unchanged.

### Task 3: Validate behavior and responsive layout

**Files:**
- Modify: `index.html`
- Modify: `sw.js`

1. Check add position, market filtering, select position, update manual quantity/cost, delete, buy, and sell.
2. Check deposit, withdrawal, buy, and sell save eligibility.
3. Check desktop, tablet, and mobile screenshots for overflow and occlusion.
4. Run inline JavaScript validation and existing engine tests.
5. Bump application and service worker versions together.
6. Commit only product files and this plan.
