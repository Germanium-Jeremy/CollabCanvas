# Architecture

CollabCanvas is a monorepo with four deployables and two shared packages.

```
apps/
  web/       Next.js 15 (App Router) — canvas, presence, AI panel, export, history
  api/       NestJS 11 — auth, rooms, permissions, AI proxy, snapshots, health
  realtime/  Node ws server — Yjs sync + awareness, role enforcement, persistence
packages/
  shared/    Types, Zod schemas, permission logic (used by all apps)
  yjs-utils/ Board serialization, snapshot restore, AI context extraction
```

## Real-time collaboration (CRDT choice)

**Yjs** with a self-hosted WebSocket server (`apps/realtime`).

- The board is a single `Y.Map("elements")` keyed by element id; values are plain
  JSON objects validated by the shared Zod schema (`boardElementSchema`). Plain
  values keep the wire format simple and make snapshots trivial to serialize.
- **Awareness** (cursors, names, "is editing") is separate from document state and
  is ephemeral by design — it never touches the database.
- Yjs gives us offline tolerance for free: edits queue locally and merge on
  reconnect. Concurrent edits converge without a custom conflict-resolution layer.
- Trade-off: Yjs updates only grow (tombstones). Periodic snapshots + a future
  compaction job bound document size; acceptable for small-team boards.

### Realtime server details

- URL format `ws://host/<roomId>/<jwt>` — compatible with the standard
  `y-websocket` client; the JWT authenticates the socket on connect.
- Roles are re-checked against Postgres on connect and cached for 30 s.
- **Viewer writes are dropped server-side** (sync updates from VIEWER connections
  are ignored); the client additionally disables tools, so enforcement is
  defense-in-depth, not UI-only.
- Blocks (`Block` table) deny connection entirely (abuse protection).
- Boards persist every 10 s when dirty (and on shutdown) into `Room.boardData`.

## Auth flow

NestJS owns authentication (no NextAuth in the middle). Sessions are
**short-lived access JWT + DB-backed refresh session**:

1. **Email/password**: `POST /api/auth/register|login` — bcrypt hashes; on
   success the API issues an access JWT (15 min) *and* creates a refresh
   session (7 days, opaque random token stored only as a SHA-256 hash).
2. **OAuth (GitHub/Google)**: API starts the flow (`/api/auth/oauth/:provider`),
   stores a state cookie, exchanges the code server-side, upserts
   `User` + `Account`, issues the same session pair. Google `id_token`
   audience is verified.
3. Both tokens are **httpOnly cookies** (`cc_token` 15 min, `cc_refresh`
   7 days, SameSite=Lax); the access JWT is also returned in the response body
   for non-browser clients.
4. **Silent renewal**: when an API call 401s with an expired access token, the
   web client calls `POST /api/auth/refresh` (single-flight — concurrent 401s
   share one refresh) and retries the original request once. Rotation deletes
   the used session row and mints a new one, so a stolen refresh token is
   useless after first use. After 7 days (or logout) the user signs in again.
5. The web app's middleware only checks cookie *presence* for route protection;
   actual authorization happens in the API (JWT verify + room permission checks).
6. WebSockets authenticate by fetching `GET /api/auth/token` (cookie-authenticated)
   and passing the token in the socket URL. If a reconnect is rejected with close
   code 4401 (expired access token), the client fetches a fresh token and
   rebuilds the connection, carrying over unsynced local edits. Tokens never
   touch localStorage.
7. Rate limiting: login/register are limited per IP (20 / 15 min); AI actions per
   user (5 / hour). In-memory fixed window; swaps to Redis when `REDIS_URL` is set.
8. `Session` rows double as a session registry: logout deletes the row (the
   cookie alone becomes worthless), and `revokeAllSessions()` supports a future
   "sign out everywhere" feature. Expired rows can be pruned by a cron job.

Authorization is pure and shared: `effectiveRole()` in `@collabcanvas/shared` is
used by the API guards *and* the realtime server, so both enforce identical rules.

## AI proxy (cost control)

- The client never sees provider keys; all calls go through `POST /api/rooms/:id/ai`.
- Providers: `mock` (deterministic, for tests/demos), `openai` (gpt-4o-mini),
  `ollama` (local, zero cost). Selected via `AI_PROVIDER`.
- Hard per-user rate limit (5/hour) plus global `AI_ENABLED` flag: when off or the
  provider fails, the API returns 503 and **the board keeps working**.
- Board context is sent by the client as a base64 Yjs update and parsed with the
  same validation as snapshots; generated shapes are schema-checked before the
  client applies them.

## Version history

- Snapshots are base64 Yjs updates stored in Postgres (`Snapshot`), versioned per
  room, newest 50 kept.
- Restore computes a single "replace" update on a clone of the live doc
  (`buildRestoreUpdate`) and applies it locally; it propagates to peers through
  the normal sync path — no special server API needed.
- Auto-snapshot every 60 s when the board changed (editors only), plus manual saves.

## Scaling notes

- The realtime server is stateful (in-memory docs). Horizontal scaling requires
  room→server affinity or a Yjs document relay (e.g. Redis pub/sub between
  instances). For a team-sized deployment one node handles thousands of boards
  because inactive docs are evicted after 30 s idle.
- The API is stateless except the in-memory rate limiter — Redis makes it
  multi-instance ready.
- Postgres load is light: board data is one column updated at most every 10 s
  per active room.

## Failure modes considered

| Failure | Behavior |
| --- | --- |
| WebSocket drops | y-websocket reconnects; local edits queue and merge |
| AI provider down / key missing | 503 + friendly message; board unaffected |
| AI overuse | 429 with clear messaging after 5 actions/hour |
| Realtime server restart | Boards reload from last persisted `boardData` (≤10 s loss) |
| Viewer tries to write | Dropped server-side; tools disabled client-side |
| Blocked user | Socket refused on connect |
