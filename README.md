# CollabCanvas

Real-time collaborative whiteboard with light AI assistance — draw, brainstorm and
plan together with low latency, live presence, board history and export.

> Built as a portfolio-grade full-stack project. See [AGENTS.md](AGENTS.md) for the
> product spec, [docs/architecture.md](docs/architecture.md) for key decisions, and
> [docs/demo.md](docs/demo.md) for a demo script.

## Features

- **Real-time collaboration** — Yjs CRDTs over a self-hosted WebSocket server:
  multi-user editing, live cursors, "is editing" indicators, offline tolerance.
- **Board tools** — freehand pen, rectangles, ellipses, text, sticky notes,
  arrows, eraser; move/resize; undo/redo; zoom & pan.
- **Auth & permissions** — email/password + GitHub/Google OAuth, JWT in httpOnly
  cookies, room roles (OWNER/EDITOR/VIEWER) enforced on API *and* realtime server.
- **Rooms** — public/private rooms with invite links, recent rooms list, member
  management, report/block (abuse basics).
- **AI (cost-controlled)** — summarize board, suggest next steps, generate diagram
  from text. Proxied, rate-limited (5/user/hour), feature-flagged, graceful
  degradation with a deterministic mock provider.
- **Export & history** — PNG/PDF export; version snapshots (manual + auto) with
  one-click restore.

## Stack

Next.js 15 + React 19 + Tailwind 4 · NestJS 11 · Yjs + y-websocket + Konva ·
PostgreSQL + Prisma · Zod everywhere (shared schemas, env validation) ·
Vitest + Supertest + Playwright · GitHub Actions CI.

## Quickstart (< 5 minutes, no Docker required)

Prereqs: Node ≥ 20, pnpm ≥ 9, a local PostgreSQL. (Optional: Redis, an OpenAI key.)

```bash
pnpm install
cp .env.example .env         # then set DATABASE_URL + JWT_SECRET

# Create the databases (adjust URL/user/password to your local Postgres):
psql -U postgres -c "CREATE DATABASE collabcanvas;"
psql -U postgres -c "CREATE DATABASE collabcanvas_test;"

pnpm db:push                 # apply the Prisma schema
pnpm db:generate

pnpm dev                     # web :3000 · api :3001 · realtime :3002
```

Open http://localhost:3000, register, create a room, open the invite link in a
second browser profile — draw together.

Prefer containers? `docker-compose up -d` starts Postgres + Redis; the apps still
run on the host with `pnpm dev`.

### AI providers

`AI_PROVIDER=mock` (default) needs no key and returns deterministic results —
good for tests and demos. For real calls:

- `AI_PROVIDER=openai` + `OPENAI_API_KEY` (uses `gpt-4o-mini`)
- `AI_PROVIDER=ollama` + local Ollama (`OLLAMA_MODEL=llama3.2`)

### OAuth (optional)

Create apps at GitHub (`/settings/developers`) and Google Cloud Console, set
`GITHUB_CLIENT_ID/SECRET` and `GOOGLE_CLIENT_ID/SECRET`, with callbacks pointing
at `${API_PUBLIC_URL}/api/auth/oauth/<provider>/callback`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run web + api + realtime in parallel |
| `pnpm build` | Build all apps (turbo) |
| `pnpm typecheck` | TypeScript strict across the monorepo |
| `pnpm lint` | ESLint (typescript-eslint) |
| `pnpm test` | Unit + integration tests (Vitest; integration uses `DATABASE_URL_TEST`) |
| `pnpm test:e2e` | Playwright suite (boots api + realtime + web) |
| `pnpm db:push` / `pnpm db:generate` | Prisma schema push / client generation |

## Project layout

```
apps/
  web/        Next.js 15 — canvas, presence, AI panel, export, history
  api/        NestJS — auth, rooms, permissions, AI proxy, snapshots
  realtime/   Yjs WebSocket server — sync, awareness, roles, persistence
packages/
  shared/     Types, Zod schemas, permission logic
  yjs-utils/  Board serialization, snapshot restore, AI context
docs/         architecture.md · decisions.md · demo.md
```

## Testing

- **Unit**: permission logic, Zod schemas, Yjs serialization/restore, prompt
  builders, UI helpers (Vitest).
- **Integration**: API endpoints over HTTP with a real Postgres test DB — auth
  flows, room CRUD, permission boundaries, AI proxy (mock provider), snapshots.
  Skips automatically if `DATABASE_URL_TEST` is unreachable.
- **E2E (Playwright)**: two-user collaboration with presence, AI summarize,
  PNG export, viewer permission boundary. Run with `pnpm test:e2e`
  (installs browsers first: `pnpm --filter @collabcanvas/web exec playwright install chromium`).

CI runs lint → typecheck → unit → integration (Postgres service) → build → E2E.

## Security notes

- Secrets only via env (`Zod`-validated); `.env` is gitignored.
- httpOnly + SameSite cookies; tokens never in localStorage.
- All client → server payloads pass shared Zod schemas (incl. AI prompts and
  board text lengths); colors are regex-validated to prevent `javascript:` URLs.
- Rate limits on auth endpoints and AI actions; blocks deny realtime connections.
