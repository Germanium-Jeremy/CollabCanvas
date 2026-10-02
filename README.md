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
- **Auth & permissions** — email/password + GitHub/Google OAuth, 15-minute
  access JWT + 7-day rotating refresh session (httpOnly cookies, hashed and
  DB-backed, revoked on logout), room roles (OWNER/EDITOR/VIEWER) enforced on
  API *and* realtime server.
- **Rooms** — public/private rooms with invite links, recent rooms list, member
  management, report/block (abuse basics).
- **AI (cost-controlled)** — summarize board, suggest next steps, generate diagram
  from text. Proxied, rate-limited (5/user/hour), feature-flagged, graceful
  degradation with a deterministic mock provider; model-backed providers are
  Ollama (local), OpenAI, Hugging Face, and Google Gemini.
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

- `AI_PROVIDER=ollama` + local Ollama (`OLLAMA_BASE_URL=http://localhost:11434`,
  `OLLAMA_MODEL=llama3.2`, then `ollama pull llama3.2`) - no cloud key needed;
  `OLLAMA_MODEL` must match a name from `ollama list`, and slow hardware wants a
  larger `AI_TIMEOUT_MS`. Smoke test: `pnpm --filter @collabcanvas/api smoke:ollama`
- `AI_PROVIDER=openai` + `OPENAI_API_KEY` (uses `gpt-4o-mini`)
- `AI_PROVIDER=huggingface` + `HF_TOKEN` + `HF_MODEL` - optional `HF_PROVIDER`
  pins an Inference Provider; `HF_ENDPOINT_URL` targets a dedicated Inference
  Endpoint instead. Connectivity check:
  `pnpm --filter @collabcanvas/api smoke:hf`
- `AI_PROVIDER=gemini` + `GEMINI_API_KEY` (uses `GEMINI_MODEL`, default
  `gemini-2.5-flash`)

Only the selected provider's variables are required; all of them live in the
API environment (never in `NEXT_PUBLIC_*` or the browser). Every provider
answers the same JSON contract and its output is validated before it reaches
the board - a provider failure returns `503` and the board keeps working.

### OAuth (optional)

Create apps at GitHub (`/settings/developers`) and Google Cloud Console, set
`GITHUB_CLIENT_ID/SECRET` and `GOOGLE_CLIENT_ID/SECRET`, with callbacks pointing
at `${API_PUBLIC_URL}/api/auth/oauth/<provider>/callback`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run web + api + realtime in parallel |
| `pnpm test:e2e` | Playwright suite (boots api + realtime + web) |

### Deployed URLs (Render)

| Service | Public URL | Realtime WebSocket URL |
|---|---|---|
| web | `https://collabcanvas-web-96su.onrender.com` | — |
| api | `https://collabcanvas-api-i8x4.onrender.com` | — |
| realtime | — | `wss://collabcanvas-realtime.onrender.com` |

The web app passes `NEXT_PUBLIC_WS_URL=wss://collabcanvas-realtime.onrender.com` to the browser (see `render.yaml`). The realtime server itself is **not** configured with a browser URL — it reads `PORT`/`REALTIME_PORT` and serves `ws://` at its own Render host. Never put a `NEXT_PUBLIC_*` var on the realtime service; it is a server-only service.
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

## Deployment

Three Render web services run the three apps; Postgres lives in Neon. The
source of truth is [`render.yaml`](render.yaml) — validate it with
`render blueprints validate ./render.yaml`.

| Service | Role | Health check |
| --- | --- | --- |
| `collabcanvas-web` | Next.js UI | `/` |
| `collabcanvas-api` | NestJS REST API | `/api/health` |
| `collabcanvas-realtime` | Yjs WebSocket server | `/` |

### Why the web service proxies `/api/*`

Web and API are separate hosts, but auth sets httpOnly cookies on whichever
origin issues them. A cross-origin call would leave the web domain unable to
read the session cookie, so `/rooms/*` would bounce to `/login` forever. Next.js
therefore rewrites `/api/*` to the API (`API_PROXY_TARGET`) and the client
calls stay same-origin. This also keeps the OAuth state cookie valid — the
callback must travel back through the proxy, which is why the API's
`API_PUBLIC_URL` is set to the **web** origin, not the API's.

### Required env vars

Set per service in the Render dashboard (or with `scripts/set-render-env.mjs`):

- **api** — `DATABASE_URL` (Neon pooled URL), `WEB_ORIGIN` and `API_PUBLIC_URL`
  (both the web origin), `HF_TOKEN` + `HF_MODEL` if AI is enabled.
- **realtime** — `DATABASE_URL` and the **same `JWT_SECRET` as the API**; a
  mismatch makes every WebSocket handshake fail auth.
- **web** — `API_PROXY_TARGET` (API origin), `NEXT_PUBLIC_WS_URL` (set to `wss://collabcanvas-realtime.onrender.com` in `render.yaml`),
  `NEXT_PUBLIC_APP_URL`.

`NEXT_PUBLIC_*` vars are inlined at build time, so changing them requires a
rebuild, not just a restart.

### Notes on the free tier

- Migrations run as the last step of the API build (`prisma db push`) because
  Render rejects `preDeployCommand` on free services. On a paid plan, move it to
  `preDeployCommand` so it runs before the new instance goes live.
- Free instances cold-start and may sleep. `collabcanvas-realtime` sets
  `RENDER_WEB_SERVICE_FREE_PLAN_SLEEP=0` because a sleeping WebSocket server
  silently drops live collaboration sessions.

## Security notes

- Secrets only via env (`Zod`-validated); `.env` is gitignored.
- httpOnly + SameSite cookies; tokens never in localStorage.
- All client → server payloads pass shared Zod schemas (incl. AI prompts and
  board text lengths); colors are regex-validated to prevent `javascript:` URLs.
- Rate limits on auth endpoints and AI actions; blocks deny realtime connections.
