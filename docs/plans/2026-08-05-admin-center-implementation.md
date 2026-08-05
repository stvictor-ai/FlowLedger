# FlowLedger Admin Center Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Add a privacy-preserving FlowLedger administrator account and dashboard, plus a prominent FlowLedger link in the personal homepage navigation.

**Architecture:** PostgreSQL stores user and invitation roles. A dedicated Express admin module exposes metadata-only management endpoints behind role-based authorization. The existing Vue single-file frontend renders the admin center inside the sync workspace; the Sites-hosted homepage adds a direct navigation link.

**Tech Stack:** PostgreSQL 17, Node.js 22, Express 5, Zod, Vue 3 CDN, Vinext/React, Node test runner.

---

### Task 1: Role migration and authentication

**Files:**
- Create: `server/migrations/002_admin_roles.sql`
- Modify: `server/src/modules/auth/repository.js`
- Modify: `server/src/modules/auth/service.js`
- Modify: `server/scripts/create-invite.js`
- Test: `server/test/auth.test.js`
- Test: `server/test/migrations.test.js`

Add `user/admin` role constraints, inherit role from a locked invitation during registration, expose role in session responses, and support CLI-only admin invitations.

### Task 2: Admin API

**Files:**
- Create: `server/src/modules/admin/repository.js`
- Create: `server/src/modules/admin/service.js`
- Create: `server/src/modules/admin/routes.js`
- Modify: `server/src/modules/auth/middleware.js`
- Modify: `server/src/app.js`
- Modify: `server/src/server.js`
- Test: `server/test/admin.test.js`

Implement metadata summary, user listing/status updates, and ordinary invitation creation/revocation. Enforce administrator sessions and prevent self-disable.

### Task 3: Admin frontend

**Files:**
- Modify: `js/server-sync.js`
- Modify: `index.html`
- Test: `test-server-sync.js`
- Test: `test-static.js`

Add client methods and a compact admin center in the sync workspace. Keep it hidden for ordinary users and avoid rendering any ledger detail.

### Task 4: Personal homepage entry

**Files:**
- Modify: `../swings-homepage/app/components/SiteHeader.tsx`
- Modify: `../swings-homepage/tests/rendered-html.test.mjs`

Add a top-level “投记” link to `https://ledger.orbitshz.com` with a clear accessible label and responsive behavior.

### Task 5: Verification and deployment

Run the FlowLedger server and static test suites, run the homepage build and rendered HTML tests, deploy the API migration and frontend, deploy the Sites homepage, then generate a single-use admin invitation. Confirm public health and that ordinary users receive 403 from admin routes.

