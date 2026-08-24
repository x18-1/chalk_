# Development Email Login Accounts

> Status: Accepted
> Date: 2026-08-24

## Goal

Use email and password consistently across the existing database, API, web UI,
and local development configuration. Local development has one administrator
and one ordinary user, both defined explicitly through environment variables.

## Environment Contract

```dotenv
DEV_ADMIN_EMAIL=admin@qq.com
DEV_ADMIN_PASSWORD=admin123
DEV_USER_EMAIL=user@qq.com
DEV_USER_PASSWORD=user123

WEB_ORIGIN=http://localhost:3002
NEXT_PUBLIC_API_URL=http://localhost:3001
```

All four development account variables are required when the API runs outside
production. The fixed values above are local defaults documented in
`.env.example`. Built-in development accounts remain disabled in production.

## Authentication Behavior

- `DEV_ADMIN_EMAIL` authenticates as the `admin` role.
- `DEV_USER_EMAIL` authenticates as the `user` role.
- Login requests, session users, database users, and admin user listings retain
  the existing `email` field and treat it as an email address.
- Bare usernames such as `admin` and `user` are not accepted.
- Legacy local addresses such as `admin@chalk.local`, `user@chalk.local`, and
  `dev@chalk.local` are not accepted.
- A valid development login creates or refreshes the corresponding database
  user and issues the existing HttpOnly session cookie.

## Development Data Cleanup

The current local `chalk` database contains exactly these four superseded users:

- `admin@chalk.local`
- `user@chalk.local`
- `admin`
- `user`

Delete these four rows from `auth_users` once during this change. Existing
foreign keys use `ON DELETE CASCADE`, so their database sessions,
conversations, provider settings, tool settings, observations, and other owned
database rows are deleted as well. The cleanup does not delete MinIO objects,
JSONL session files, Docker volumes, or unrelated databases.

The new `admin@qq.com` and `user@qq.com` rows are created automatically on
their first successful login.

## UI

The login form is email-only. Its label, state names, validation errors, API
client parameters, and development hint all use email terminology. The hint
lists `admin@qq.com / admin123` and `user@qq.com / user123` only outside
production.

## Verification

- Integration tests cover both configured email accounts and their roles.
- Integration tests reject bare usernames and legacy local email accounts.
- E2E login helpers use the new user email account.
- A browser smoke check verifies both logins, redirect to `/chat`, and session
  cookie persistence through Web `http://localhost:3002` and API
  `http://localhost:3001`.
- A post-cleanup database query confirms that none of the four superseded
  identities remain.
