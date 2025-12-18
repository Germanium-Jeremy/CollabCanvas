# AGENTS.md — CollabCanvas

> **Project**: CollabCanvas – Real-time Collaborative Whiteboard with AI Assist  
> **Goal**: Ship a polished, production-ready full-stack portfolio project in 3–4 weeks that demonstrates real-time collaboration, modern TypeScript full-stack skills, AI integration, testing, and deployment.  
> **Target Audience**: Hiring managers looking for juniors who can own a complete product slice (frontend + backend + infra + quality).

This document is the **single source of truth**. Follow it strictly. Prefer simplicity and correctness over premature optimization. Every feature must be fully functional, tested, and documented.

---

## 1. Core Product Vision & Scope

CollabCanvas is a focused real-time collaborative whiteboard for small teams and study groups. Users can:
- Create/join rooms
- Draw, keyboard texting, add sticky notes and simple shapes together with low latency
- See live presence (cursors + avatars)
- Use light AI assistance (summarize board, suggest next steps, generate diagram from text)
- Export the board and keep basic version history

**Out of scope for v1** (do not implement unless time remains after core is solid):
- Mobile-native apps
- Complex vector graphics / SVG export beyond PNG/PDF
- Payment / paid plans
- Advanced CRDT conflict resolution beyond what Yjs provides
- Self-hosting the entire stack without containers

---

## 2. Required Features (Must Have)

Implement these in priority order. Do not skip ahead.

### 2.1 Authentication & Authorization
- GitHub OAuth + Google OAuth + email/password (or magic link) via Auth.js / NextAuth.js (or equivalent in NestJS).
- JWT or session-based auth.
- Room-level permissions: owner, editor, viewer.
- Protected routes and API endpoints.
- Proper logout and session invalidation.

**Implementation notes**:
- Use httpOnly cookies where possible.
- Never store secrets in client code.
- Rate-limit login endpoints.

### 2.2 Real-time Collaborative Canvas
- Multi-user canvas with simultaneous editing.
- Recommended approach: **Yjs + y-websocket** (or Liveblocks if you prefer managed). Prefer open-source Yjs for portfolio credibility.
- Support: freehand drawing, sticky notes, rectangles, ellipses, text, arrows.
- Live presence: remote cursors + user avatars + “user is editing” indicators.
- Low-latency updates (< 100 ms perceived under normal conditions).
- Offline tolerance: local changes should queue and sync when reconnected (Yjs handles this well).

**Implementation notes**:
- Keep the canvas library lightweight (Konva, Excalidraw core, or raw Canvas 2D + Yjs). Avoid heavy commercial SDKs.
- Separate “awareness” (presence) from document state.
- Document the CRDT choice and trade-offs in a short `docs/architecture.md`.

### 2.3 Room Management
- Create room (public or private with invite code/link).
- Join by ID or invite link.
- List of user’s recent rooms.
- Basic room settings (name, permissions, delete).
- Presence list of currently connected users.

### 2.4 AI Assistance (Light & Cost-Controlled)
- “Summarize this board” → short paragraph + bullet key points.
- “Suggest next steps” → 3–5 actionable ideas based on current content.
- “Generate diagram from text” → create shapes/sticky notes from a prompt.
- Use a cheap, fast model (Groq, OpenAI gpt-4o-mini, or local via Ollama for development).
- Proxy all AI calls through the backend. Never expose API keys to the client.
- Hard rate limits per user/room (e.g. 5 AI actions / hour).
- Graceful degradation when AI provider is down.

### 2.5 Export & History
- Export current board as PNG and PDF.
- Simple version history: save snapshots on significant changes or manually. Allow restore of last N versions (store as Yjs updates or serialized JSON).

### 2.6 Quality, Security & Ops
- Rate limiting on all public endpoints.
- Basic abuse protection (report room, block user – even if just logged).
- Input sanitization (especially text on sticky notes and AI prompts).
- Error boundaries on frontend + structured error responses on backend.
- Health check endpoint.
- Structured logging (pino or equivalent).
- Environment-based configuration (never hardcode secrets).

---

## 3. Recommended Tech Stack (Strict)

| Layer              | Choice                          | Why |
|--------------------|---------------------------------|-----|
| Frontend           | Next.js 15 (App Router) + TypeScript + React 19 | You already know it. Excellent DX, SSR/SSG when needed, easy deployment. |
| UI                 | Tailwind CSS + shadcn/ui + Lucide | Fast, consistent, accessible. |
| Canvas / CRDT      | Yjs + y-websocket + Konva (or Excalidraw core) | Battle-tested, open-source, great portfolio signal. |
| Backend            | NestJS (preferred) or FastAPI   | NestJS keeps entire stack in TypeScript. FastAPI is fine if you prefer Python. |
| Database           | PostgreSQL + Prisma (or Drizzle) | Relational data for users/rooms + JSON for board snapshots. |
| Auth               | Auth.js (NextAuth) or NestJS Passport + JWT | Standard and well-documented. |
| Realtime transport | y-websocket (self-hosted) or Liveblocks | Prefer self-hosted for learning. |
| AI                 | OpenAI SDK or Groq SDK (proxied) | Cheap models only. |
| Caching / Queues   | Redis (optional but recommended) | Rate limiting, presence, background jobs. |
| Testing            | Vitest + Playwright + Supertest | Fast unit/integration + solid E2E. |
| Hosting            | Vercel (frontend) + Railway / Render / Fly.io (backend + DB + Redis) | Free/cheap tiers, easy CI. |
| CI/CD              | GitHub Actions                  | Lint → typecheck → unit → integration → build → deploy. |
| Monitoring         | Sentry (frontend + backend)     | Catch real errors early. |

**Rules for working with the stack**:
- Use TypeScript strictly (`strict: true`). No `any`, `unknown` and `undefined` unless absolutely justified and commented.
- Prefer server components and server actions where they make sense; use client components only for the interactive canvas and presence.
- Keep API contracts typed (shared types package or Zod schemas).
- All environment variables go through a validated config module (Zod).
- Dockerize the backend + DB + Redis for local development parity.
- Never commit `.env` files. Provide `.env.example`.

---

## 4. Project Structure (Recommended)

```
collabcanvas/
├── apps/
│   ├── web/                 # Next.js frontend
│   └── api/                 # NestJS (or FastAPI) backend
├── packages/
│   ├── shared/              # Shared types, Zod schemas, constants
│   └── yjs-utils/           # Optional shared Yjs helpers
├── docs/
│   ├── architecture.md
│   ├── decisions.md         # ADRs
│   └── demo.md              # How to demo the project
├── .github/workflows/
├── docker-compose.yml
├── AGENTS.md                # This file
└── README.md
```

Monorepo with Turborepo or pnpm workspaces is preferred but not mandatory.

---

## 5. Deliverables (Definition of Done)

A feature is done only when **all** of the following are true:

1. Code is typed, linted, and formatted.
2. Unit tests exist for pure logic and critical utilities.
3. Integration tests cover the API endpoints involved.
4. E2E test (Playwright) covers the happy path of the feature.
5. Feature works in the deployed preview environment.
6. README / docs updated if the feature changes how someone runs or demos the project.
7. No secrets or debug code left behind.
8. Accessibility basics respected (keyboard navigation on non-canvas UI, proper labels).

**Final v1 deliverables**:
- Working production deployment (public URL) (when reaching this stage, you can guide on the deployment, or ask for terminal integration with hosting services to continue).
- GitHub repository with clean commit history and good README.
- Short demo video (2–4 min) showing multi-user collaboration + AI features.
- `docs/architecture.md` explaining key decisions (CRDT choice, auth flow, AI proxy, scaling notes).
- Test coverage report (aim for >70% on critical paths; 100% on auth and room permissions).
- One-click local setup (`docker-compose up` + `pnpm dev`) (I don't have docker installed - and don't want to install it - But most needed services are installed locally).

---

## 6. Testing Strategy (Mandatory)

You must implement a layered testing approach. Do not treat tests as optional.

### 6.1 Unit Tests
- Pure functions (permission checks, board serialization, AI prompt builders, rate-limit logic).
- React components that contain logic (with React Testing Library).
- Yjs utility helpers.
- Tool: Vitest (or Jest).

### 6.2 Integration Tests
- API routes / NestJS controllers: auth flows, room CRUD, permission enforcement, AI proxy (mocked provider).
- Database interactions (use a test Postgres or transaction rollback).
- Tool: Vitest + Supertest (or NestJS testing module) + test DB.

### 6.3 End-to-End Tests
- Critical user journeys:
  1. Sign up / login → create room → invite second user → both draw → see presence.
  2. AI summarize + suggest next steps.
  3. Export PNG.
  4. Permission boundaries (viewer cannot edit).
- Tool: Playwright. Run against local or preview deployment.

### 6.4 Other Useful Tests
- **Contract / Schema tests**: Zod schemas for all API payloads.
- **Load / concurrency smoke**: simple script that opens 5–10 concurrent Yjs connections and asserts no data loss (can be a manual or CI script).
- **Security smoke**: basic checks for missing auth on protected routes, XSS on sticky-note text.
- **Visual regression** (optional): Playwright screenshots of the canvas toolbar and room list.

**Rules**:
- Every PR must keep the test suite green.
- Mock external services (AI provider, OAuth) in unit/integration tests.
- Prefer deterministic tests; avoid flakiness from real-time timing by using Yjs test utilities or controlled clocks where possible.

---

## 7. Implementation Order

**Foundation**
- Monorepo / project scaffolding
- Auth (GitHub + Google + credentials)
- Basic room CRUD + permissions
- Database schema + Prisma
- CI pipeline (lint + typecheck + unit tests)
- Docker Compose for local dev

**Real-time Core**
- Yjs document + WebSocket server
- Canvas rendering + drawing tools
- Presence (cursors + avatars)
- Join/leave room flows
- Basic E2E for collaboration

**AI + Polish**
- AI proxy + three core actions
- Rate limiting + abuse basics
- Export PNG/PDF
- Version snapshots
- Error handling + loading states + empty states
- Sentry integration

**Hardening & Demo**
- Full E2E suite
- Performance pass (bundle size, WebSocket reconnection)
- Documentation + architecture decision records
- Demo video + README polish
- Deploy to production + custom domain (optional)
- Final security review

---

## 8. Coding & Collaboration Standards

- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Small, focused PRs.
- Every non-trivial decision gets a short entry in `docs/decisions.md` (Architecture Decision Record style).
- Comments explain **why**, not what.
- Prefer early returns and flat code over deep nesting.
- Handle errors explicitly; never swallow them.
- Keep the AI features behind a feature flag so the core whiteboard remains usable if the LLM is down.

---

## 9. What “Senior-Quality” Looks Like for This Project

When a hiring manager or interviewer looks at the repo they should see:

- Clear separation of concerns
- Typed boundaries between frontend and backend
- Thoughtful real-time architecture (not just “I threw Socket.io at it”)
- Cost-aware AI integration
- Actual tests that protect the important invariants (permissions, data consistency)
- A README that lets anyone run the project in < 5 minutes
- Evidence that you thought about failure modes (network drop, AI timeout, concurrent edits)

---

## 10. Final Checklist Before Calling It Done

- [ ] Multi-user drawing + presence works reliably
- [ ] Auth + room permissions enforced on both frontend and backend
- [ ] AI features work and are rate-limited
- [ ] Export + basic history functional
- [ ] Unit + integration + E2E tests passing in CI
- [ ] Production deployment live
- [ ] Architecture doc + good README + demo video
- [ ] No secrets in git history
- [ ] Bundle and WebSocket performance are acceptable
- [ ] You can confidently explain every major technical decision in an interview

Follow this document. When in doubt, choose the simpler, more correct solution and document the trade-off. Ship something you are proud to put at the top of your resume.