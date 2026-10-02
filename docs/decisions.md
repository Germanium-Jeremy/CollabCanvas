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

- **Decision**: `AiProvider` interface; `mock | openai | ollama | huggingface |
  gemini` implementations (see ADR-013 for the shared contract).
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

## ADR-009 — Short-lived access JWT + hashed, rotating refresh sessions

- **Decision**: access JWT lives 15 minutes; the 7-day session is an opaque
  random token in an httpOnly cookie whose SHA-256 hash is stored in a `Session`
  table. `POST /api/auth/refresh` rotates it (delete row, mint new one).
- **Why**: a 7-day *JWT* cannot be revoked (logout does nothing server-side) and
  a leaked one is valid for a week. An opaque DB-backed token gives revocation,
  theft detection via rotation, logout-everywhere, and a session registry —
  while keeping the fast, stateless JWT path for API/websocket auth.
- **Trade-off**: refresh adds one DB round-trip every ~15 min per active user.
  Rotation is delete-then-create, not a single transaction; a strict
  implementation would track token families to invalidate on replay — noted as
  future hardening.

## ADR-010 — Header session state is client-fetched, keyed on route changes

- **Decision**: the header (`UserMenu`) checks `/auth/me` on mount and on every
  App Router route change; there is no global session context/provider.
- **Why**: the root layout persists across client-side navigations, so a
  mount-only check goes stale right after login (client-side redirect never
  remounts the header). Route-keyed re-checks fix the common transitions with
  one small component instead of a provider threading through the tree.
- **Trade-off**: an extra `/auth/me` call per navigation (cheap, indexed lookup).
  A truly global store (React context or TanStack Query) would dedupe these if
  the number of session-aware components grows.

## ADR-011 — Joins grant VIEWER; links and email invites are separate grants

- **Decision**: every join path (public URL, private share-link `?code=`)
  creates a VIEWER membership. Edit access flows only through explicit owner
  actions: an email invitation with a pre-chosen role, or a roster promotion.
  The room page never auto-joins on load, with one exception: opening a
  `?code=` link to a private room joins automatically because following an
  invite link *is* the intent to join. Email invitations carry their own
  secret code (`RoomInvitation`, unique per room+email) and are redeemed via
  `POST /rooms/:id/invitations/redeem` — acceptance is explicit in the UI.
- **Why**: page-load auto-join silently granted EDITOR to anyone with a public
  URL, which contradicted both the viewer role and the roster (guests were
  invisible and unpromotable). Making ownership the only path to edit rights
  gives owners real control and makes members visible.
- **Trade-off**: an extra click for new collaborators ("Join board" banner) and
  an owner promotion step; the realtime server's 30s role cache means a fresh
  promotion can lag on live sockets (reconnect/reload picks it up). The
  share-link `code` is one credential with two transports (link or pasted
  code) rather than two systems; revocation means rotating `Room.inviteCode`.

## ADR-012 — Text/sticky editors commit on pointerup-created elements

- **Decision**: the text/sticky tools create their board element on
  **pointerup** (guarded against drags), then mount the editor; Escape/Enter
  (text) and blur commit content, and an empty editor deletes its element.
- **Why**: creating on pointerdown mounted the textarea mid-gesture; the
  browser's focus default after mousedown stole focus back, the blur handler
  saw an empty element and deleted it — text and stickies vanished instantly.
  Pointerup is after the focus side effects, so the editor keeps the keyboard.
- **Trade-off**: none observed; drags still create nothing (intended).

## ADR-013 — One JSON contract for every model provider; HF Inference Providers first

- **Decision**: `ollama`, `openai`, `huggingface`, and `gemini` all extend a
  shared `ChatJsonProvider` base: identical system prompts, one non-streamed
  JSON completion, then shared `parseCompletionJson` + result normalization
  (`normalizeSummarize`, `normalizeSuggest`, `normalizeDiagram`). Hugging Face
  defaults to **Inference Providers** (`HF_MODEL`, optional `HF_PROVIDER` pin)
  and switches to a dedicated **Inference Endpoint** only when `HF_ENDPOINT_URL`
  is set; Gemini uses the current `@google/genai` SDK with
  `responseMimeType: "application/json"`. The SDKs are lazy-loaded and
  injectable for tests; `mock` stays the deterministic default.
- **Why**: the three hosted SDKs differ in auth, streaming, and output shape,
  but the API contract must not — one parse/validate boundary is the single
  place that proves model output can never inject arbitrary data onto the
  board (unknown shape types, NaN coordinates, oversized labels are dropped;
  empty/malformed output becomes a controlled 503). Inference Providers let you
  compare model/provider combos without deploying anything, while an
  Inference Endpoint is the explicit production path when a stable private URL
  and endpoint lifecycle control matter (its own cost/scaling settings).
  `@google/generative-ai` is deprecated, so Gemini uses `@google/genai`.
- **Trade-off**: structured output is not schema-enforced by every provider, so
  validation is defensive and a non-compliant model degrades to 503 instead of
  a partial answer. Routing knobs (provider pin, endpoint URL, model ids) are
  env vars — no provider picker in the UI, and credentials stay server-side.

## ADR-014 — Same-origin API proxy between the web and API services

- **Decision**: the deployed web app calls `/api/*` **relative to its own
  origin**; Next.js rewrites those requests to the API service
  (`API_PROXY_TARGET`). `NEXT_PUBLIC_API_URL` is empty in production, and the
  API's `API_PUBLIC_URL` is set to the **web** origin rather than its own.
- **Why**: web and API are separate Render hosts, but session state lives in
  httpOnly cookies scoped to the origin that sets them. Calling the API
  cross-origin would set `cc_token`/`cc_refresh` on the API host, leaving the
  web middleware unable to see them — `/rooms/*` would redirect to `/login`
  forever, and the OAuth state cookie would fail the same way. `API_PUBLIC_URL`
  must therefore be the web origin so the OAuth callback returns *through* the
  proxy, where the state cookie is still valid.
- **Trade-off**: one extra network hop per API request and the API is not
  directly reachable from the browser. The alternative — a shared cookie
  domain with `SameSite=None; Secure` — is looser security and breaks the day a
  custom domain is added, so it was rejected. `NEXT_PUBLIC_API_URL` still lets
  local dev talk to `http://localhost:3001` directly, where same-origin holds
  by definition.
