# Decision Records

Short ADR-style entries for the non-obvious choices.

## ADR-001 — Yjs over Liveblocks / Socket.io-custom-sync

- **Decision**: Yjs + self-hosted y-websocket.
- **Why**: open source (portfolio credibility, no vendor lock-in), mature CRDT
  with offline tolerance, awareness protocol built in. Liveblocks would be faster
  to ship but hides exactly the interview-worthy parts. Hand-rolled Socket.io sync
  would re-implement CRDTs badly.
- **Trade-off**: we operate a stateful realtime server; mitigated by idle-doc
  eviction + periodic persistence.

## ADR-002 — NestJS owns auth; Next.js does not (no NextAuth)

- **Decision**: single authentication authority in the API. The web app reads the
  httpOnly cookie issued by the API.
- **Why**: the spec's stack has a real backend; duplicating auth in Next.js would
  create two session systems and a confused trust boundary. Cookie-based auth also
  makes websocket token issuance trivial (`/api/auth/token`).
- **Trade-off**: cross-origin cookies need CORS `credentials: true`; dev origins
  are pinned via `WEB_ORIGIN`.

## ADR-003 — Permission logic is a pure shared function

- **Decision**: `effectiveRole()` lives in `@collabcanvas/shared` and is used by
  API *and* realtime server; 100% unit-tested.
- **Why**: permissions are the highest-risk logic in the app; one implementation,
  tested once, enforced everywhere (spec: 100% coverage on permissions).

## ADR-004 — AI provider abstraction with a deterministic mock

- **Decision**: `AiProvider` interface; `mock | openai | ollama` implementations.
- **Why**: tests and demos must not depend on paid APIs or network; graceful
  degradation (503) keeps the board usable when AI is down (spec requirement).
- **Cost control**: per-user fixed window (5/h), `max_tokens` capped, cheap model.

## ADR-005 — Board state as Y.Map of plain JSON values

- **Decision**: elements are plain objects in `Y.Map("elements")`, not nested
  Y.Types, validated by `boardElementSchema` on every read boundary.
- **Why**: whole-object replacement matches how the UI edits (drag, resize, text
  change), keeps snapshots/restore trivial, and gives a single sanitization point.
  Nested Y.Text would enable character-level merging but complicates schema
  validation and undo semantics.

## ADR-006 — Snapshots are Yjs updates, restores are computed client-side

- **Decision**: store `Y.encodeStateAsUpdate` base64; restore builds a
  "clear + apply" update against the live doc and applies it as a normal update.
- **Why**: no restore endpoint race with the realtime server; the restore is just
  another edit that syncs to everyone and is undo-friendly.

## ADR-007 — CommonJS shared packages (for now)

- **Decision**: `@collabcanvas/shared` and `@collabcanvas/yjs-utils` build to CJS;
  the Next.js app transpiles workspace packages.
- **Why**: the NestJS API and realtime server are CJS; CJS shared output is the
  least-friction interop today. Revisit dual ESM/CJS exports if bundle size or
  tree-shaking becomes a concern.

## ADR-008 — In-memory rate limiting with a Redis swap-in

- **Decision**: fixed-window limiter; Redis (INCR/PEXPIRE) used when `REDIS_URL`
  is set, in-memory Map otherwise, fail-open to memory if Redis errors.
- **Why**: zero required infrastructure for local dev (spec: user runs Postgres
  locally, no Docker), one env var to productionize.
