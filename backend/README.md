# Multi Proxy Backend (NestJS)

Manages users, roles (RBAC), central Decodo settings, and realtime control of the
Multi Proxy Browser over WebSocket.

## Stack
- NestJS 10 · PostgreSQL + Prisma · JWT auth · socket.io gateway

## Setup (dev)

```bash
# 1) start Postgres (Docker)
docker compose up -d

# 2) install deps
npm install

# 3) configure env
cp .env.example .env      # then edit secrets (JWT_SECRET, SETTINGS_ENC_KEY)

# 4) create the schema + first admin
npm run prisma:migrate     # creates tables
npm run db:seed            # creates admin (SEED_ADMIN_USERNAME / _PASSWORD)

# 5) run
npm run start:dev          # http://localhost:3000/api  (ws namespace: /control)
```

## REST API (prefix `/api`)
| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/auth/login` | any | `{username,password}` → `{accessToken, user}` |
| GET | `/auth/me` | auth | current user + lock state |
| GET | `/settings/effective` | auth | full proxy config the browser needs (incl. password) |
| GET | `/settings` | admin | settings for display (no raw password) |
| PUT | `/settings` | admin | update Decodo config / dataSaver / globalLock |
| GET | `/users` | admin | list users |
| POST | `/users` | admin | create user |
| PATCH | `/users/:id` | admin | update role/active/password/locked |
| DELETE | `/users/:id` | admin | delete user |
| POST | `/control/lock/:userId` | admin | lock one user's app (live) |
| POST | `/control/unlock/:userId` | admin | unlock one user |
| POST | `/control/lock-all` | admin | lock every client |
| POST | `/control/unlock-all` | admin | unlock every client |
| POST | `/control/logout/:userId` | admin | force a user to log out |

## WebSocket (`/control`, socket.io)
Client connects with `auth: { token: <JWT> }`. Server emits:
- `lock { reason }` / `unlock {}` — show/hide the lock screen
- `settings:updated <config>` — re-apply proxy config live
- `logout {}` — force logout
- `unauthorized {message}` — bad/missing token (then disconnect)

## RBAC
Two roles: `ADMIN` (sees admin section + Decodo settings) and `USER` (browse only).
Guards: `JwtAuthGuard` + `RolesGuard` with the `@Roles(Role.ADMIN)` decorator.

## Security notes
- Passwords: bcrypt (cost 12). Decodo password: AES-256-GCM at rest (`SETTINGS_ENC_KEY`).
- `/settings/effective` returns the Decodo password to authenticated clients because
  the browser runs the proxy relay locally and needs it. The browser's UI hides it
  from non-admins, but treat any client machine as able to hold that secret.
