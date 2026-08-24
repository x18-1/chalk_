# Development Email Login Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `admin@qq.com` and `user@qq.com` the only built-in development identities, using the existing email/password authentication contract throughout.

**Architecture:** Keep the existing `auth_users.email` schema and session model. Load two development email accounts from environment variables outside production, validate login identifiers as emails at the HTTP boundary, and leave normal database-backed email authentication intact. Remove the four superseded local identities from only the current `chalk` development database with a narrowly scoped delete.

**Tech Stack:** TypeScript, Fastify, Zod, Drizzle, PostgreSQL, Vitest, Playwright, Next.js

---

### Task 1: Lock the email authentication contract with integration tests

**Files:**
- Modify: `apps/api/tests/integration/auth-chat.test.ts`
- Test: `apps/api/tests/integration/auth-chat.test.ts`

- [ ] **Step 1: Define the desired development email accounts**

Replace the username fixtures with:

```ts
const developmentAdmin = { email: 'admin@qq.com', password: 'admin123' };
const developmentUser = { email: 'user@qq.com', password: 'user123' };
```

In `beforeAll`, set `DEV_ADMIN_EMAIL`, `DEV_ADMIN_PASSWORD`,
`DEV_USER_EMAIL`, and `DEV_USER_PASSWORD`, and delete the two superseded
`DEV_*_USERNAME` variables.

- [ ] **Step 2: Assert email logins and rejected old identifiers**

Use each fixture's `email` in login requests and returned-user assertions. Add
`admin` and `user` to the rejection cases. Expect malformed bare usernames to
return `400`, and legacy `@chalk.local` credentials to return `401`.

- [ ] **Step 3: Run the focused integration test and verify RED**

Run:

```bash
pnpm --filter @chalk/api exec vitest run tests/integration/auth-chat.test.ts
```

Expected: FAIL because the service still requires `DEV_ADMIN_USERNAME` and
`DEV_USER_USERNAME` and the credentials schema does not require an email.

### Task 2: Implement environment-configured email accounts

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/schemas.ts`
- Modify: `apps/api/src/auth/routes.ts`
- Test: `apps/api/tests/integration/auth-chat.test.ts`

- [ ] **Step 1: Load email account definitions**

Change the development account objects to read `DEV_ADMIN_EMAIL` and
`DEV_USER_EMAIL`, normalize them to lowercase, and store their identifier under
an `email` property. Match, upsert, and query development users by email.

- [ ] **Step 2: Enforce the email request contract**

Use Zod's email validation after trimming and lowercasing:

```ts
email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
```

Keep legacy `@chalk.local` addresses explicitly rejected even if stale rows
exist in another development database. Change the authentication error text to
`Invalid email or password` only if it is not already present.

- [ ] **Step 3: Run the focused integration test and verify GREEN**

Run:

```bash
pnpm --filter @chalk/api exec vitest run tests/integration/auth-chat.test.ts
```

Expected: all tests in the file pass.

### Task 3: Update environment configuration and all callers

**Files:**
- Modify: `.env` (ignored local configuration)
- Modify: `.env.example`
- Modify: `apps/api/tests/integration/mcp-chat.test.ts`
- Modify: `tests/e2e/auth-settings.spec.ts`
- Modify: `tests/e2e/chat-abort.spec.ts`
- Modify: `tests/e2e/chat-compaction.spec.ts`
- Modify: `tests/e2e/chat-interactions.spec.ts`
- Modify: `tests/e2e/chat-model-switch.spec.ts`
- Modify: `tests/e2e/chat-process-restart.spec.ts`
- Modify: `tests/e2e/chat-steer.spec.ts`

- [ ] **Step 1: Replace the environment contract**

Set:

```dotenv
DEV_ADMIN_EMAIL=admin@qq.com
DEV_ADMIN_PASSWORD=admin123
DEV_USER_EMAIL=user@qq.com
DEV_USER_PASSWORD=user123
```

Remove `DEV_ADMIN_USERNAME` and `DEV_USER_USERNAME`. Preserve
`WEB_ORIGIN=http://localhost:3002` and
`NEXT_PUBLIC_API_URL=http://localhost:3001`.

- [ ] **Step 2: Move test callers to email variables**

Use `DEV_USER_EMAIL ?? 'user@qq.com'` in every E2E login helper. Configure the
MCP integration fixture through `DEV_USER_EMAIL` rather than a username
variable.

- [ ] **Step 3: Check for superseded active configuration**

Run:

```bash
rg -n "DEV_(ADMIN|USER)_USERNAME" apps packages tests .env .env.example
```

Expected: no matches.

### Task 4: Make the login UI consistently email-based

**Files:**
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/api/auth.ts` only if its parameter is not already named `email`

- [ ] **Step 1: Update the form semantics and development hint**

Keep the state and API parameter named `email`, use the visible label `邮箱`,
use `type="email"` and `autoComplete="email"`, retain the error
`邮箱或密码不正确。`, and show:

```text
开发账号：admin@qq.com / admin123；user@qq.com / user123。
```

- [ ] **Step 2: Run the frontend typecheck**

Run:

```bash
pnpm --filter @chalk/web typecheck
```

Expected: PASS.

### Task 5: Delete the four superseded development users

**Files:**
- No repository files
- Modify data: local PostgreSQL database `chalk`, table `auth_users`

- [ ] **Step 1: Reconfirm the exact deletion targets**

Run a read-only query for `admin@chalk.local`, `user@chalk.local`, `admin`, and
`user`. Stop if any other target would be included.

- [ ] **Step 2: Delete only the confirmed users in a transaction**

Execute:

```sql
BEGIN;
DELETE FROM auth_users
WHERE email IN ('admin@chalk.local', 'user@chalk.local', 'admin', 'user')
RETURNING id, email;
COMMIT;
```

Expected: exactly four returned rows. Foreign-key-owned database records are
removed through the existing cascade constraints.

- [ ] **Step 3: Verify cleanup**

Query the same four identifiers and expect zero rows. Do not delete MinIO
objects, JSONL files, volumes, or records from test/E2E databases.

### Task 6: Restart and verify the complete workflow

**Files:**
- No production file changes

- [ ] **Step 1: Run all quality gates**

Run:

```bash
pnpm env:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: every command exits zero; unit and integration test counts contain no
failures.

- [ ] **Step 2: Restart the development server**

Restart `pnpm dev` so the API and Next.js process read the new environment.
Confirm API `/health` and Web `/login` both return `200`.

- [ ] **Step 3: Verify authentication against the running API and browser**

Confirm `admin@qq.com / admin123` and `user@qq.com / user123` each create a
session and enter `/chat`. Confirm `admin`, `user`, and all three legacy local
emails do not authenticate.

- [ ] **Step 4: Inspect final scope**

Run `git status --short`, `git diff --check`, and a final `auth_users` query.
Do not restore the user's pre-existing deletion of
`docs/runbooks/new-computer-migration.md`, and do not create a commit.
