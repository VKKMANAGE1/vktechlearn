# SHAVI AI — Milestone Roadmap

Derived from the M01 audit (`PROJECT_STATUS.md`). Current stack: Vite/React SPA on GitHub Pages +
one Cloudflare Worker (NVIDIA NIM). No database, no auth, single model.

**Rule for every milestone:** implement → test (API + browser) → update `PROJECT_STATUS.md` → report →
wait for approval. No milestone may break the existing chat, document, OCR, image or export features,
and site files (`index.html`, `posts/*`, `tools/build_posts.py`, CSS) stay untouched.

## Architecture decision (blocking)

| Option | What it means | Cost |
| --- | --- | --- |
| **A — extend current stack (recommended)** | Workers + D1 + auth + provider registry; keeps everything that works | incremental, deployable today |
| B — adopt LibreChat | Node 20 + MongoDB + Meilisearch host, new deploy target, retire Worker/SPA work | replacement project, new hosting required |

Roadmap below assumes **A**. If you choose B, milestones M1–M3 are re-scoped to a LibreChat fork instead.

---

## M1 — Health honesty & API hardening (small, no UX change)

**Goal:** stop the API from claiming things it does not do, and close the obvious abuse surfaces.

- `/health`: derive `search` from configured keys, report `news: "rss"` with `gdelt: false` (GDELT is blocked
  from Worker egress), expose `model`/`vision`/`image` capability flags from a single registry object.
- `/api/news`: rate limit it (same limiter as chat) or gate it behind a token; keep it for diagnostics only.
- CORS: drop the `*.style.dev` wildcard in production (env-driven allowlist only).
- Add `tests/api.mjs` smoke script: health schema, 400s, 404, CORS headers, news count > 0.

**Acceptance:** smoke script green against production worker; `/health` values match reality; no
`*.style.dev` allow-origin on prod; chat/OCR/image unchanged (regression check).

## M2 — Server-side conversation persistence (D1)

- Schema: `conversations(id, client_id, title, created_at, updated_at, archived)`,
  `messages(id, conversation_id, role, content, images_json, created_at)`; indexes on
  `(client_id, updated_at)`, `(conversation_id, created_at)`.
- Worker routes: `GET/POST/PATCH/DELETE /api/conversations`, `GET/POST /api/conversations/:id/messages`
  with `client_id` (anonymous device token) ownership checks on every query.
- Frontend: `lib/store.ts` replaces `localStorage` reads/writes; one-time migration of
  `shavi-ai-threads-v1`; offline fallback to localStorage if the worker is unreachable.
- History search moves server-side (title + message text, `LIKE` with index).

**Acceptance:** message persists after localStorage clear and in a fresh browser (same device token);
ownership test (token B cannot read token A's rows) returns 404; migration keeps existing threads.

## M3 — Accounts & RBAC

- Freebuff auth (Sites) or magic-link; `users(id, email, role)`, `sessions`; every row scoped to `user.sub`.
- Endpoints reject unauthenticated writes with 401; admin role gate for M8 routes.
- Account data export (JSON) and delete (cascade conversations/messages/files).
- Frontend: sign-in screen, profile menu, "logout keeps local drafts" behavior.

**Acceptance:** sign-up → chat → logout → login restores history; second account sees nothing of the first;
export/delete verified; signed-out chat either blocked or guest-scoped.

## M4 — Model registry + multi-provider

- `ai-worker/models.js`: provider id, model id, display name, context window, input/output modalities,
  tools/vision/streaming flags, status — real IDs only (NVIDIA today; DeepSeek/OpenAI/Gemini/Anthropic/
  OpenRouter/Groq/Mistral/Ollama added only when a key exists).
- Provider adapter interface (`chatStream`, `imageGenerate`, `ocr`) so `/api/chat` stops hard-coding NIM.
- UI: model selector grouped by provider with capability badges; disabled models explain why.
- Stream `usage` through SSE and show tokens per message; error mapping per provider (429/401/5xx).
- Fallback chain configurable per request when the primary provider fails.

**Acceptance:** switch model in UI → correct provider called (log/echo model id in response); token counts
displayed; killing a provider key shows a clear error instead of a hang; no invented model ids.

## M5 — Chat parity actions

- Edit a user message (truncate following messages, resend), regenerate last answer, continue answer.
- Like/dislike stored per message; share link (`/shavi-ai/s/:id`) read-only with expiry + revoke.
- Read-aloud via Web Speech API, per-message; stop playback.
- Themed rename dialog instead of `window.prompt`; archive + restore conversations; theme persisted.

**Acceptance:** edit/regenerate/continue produce correct history; share link works in a private window and
respects permissions; archived chats leave the default list; theme survives reload.

## M6 — Web search & deep research

- Exa/Tavily key from you → `EXA_API_KEY` secret on the worker; fetch page text for top results.
- Server validates every cited URL is one of the fetched result URLs (no invented citations).
- Deep research mode: plan → 3–5 sub-queries → gather → compare → structured report with source table.
- `web_search` tool exposed only when a key exists (`/health` must reflect it).

**Acceptance:** question about today's event returns a source table whose URLs all resolve; deep research
produces sections + disagreements; with no key the UI says search is unavailable (no fake answers).

## M7 — Documents, voice, memory

- Add DOC (antiword-equivalent), RTF, ODT, ODS parsing; keep page/sheet references.
- Replace keyword chunking with embeddings + D1/pgvector-style retrieval; expose "pages 3, 4, 9 used".
- Remove silent truncation: tell the user which pages/rows were skipped.
- STT (browser or provider) + TTS for answers, Hindi/English.
- Memory: user-editable facts, custom instructions, per-project memory; never cross-user.

**Acceptance:** each new format answered with page refs; large PDF (>24k chars) answers cite the right
pages; voice round-trip works in Chrome; memory CRUD verified with two accounts.

## M8 — Admin, observability, test suite

- Admin UI: provider/model toggles, rate limits, usage & cost per provider, error log, system health.
- Structured worker logs (no prompts/keys), audit log for admin actions.
- Automated suite in CI: unit (parsers, chunking, registry), integration (worker routes with Miniflare +
  local D1), browser (Playwright: chat, upload, share, login).
- Production build gate: `tsc --noEmit`, `bun run build`, worker `--check`, smoke script.

**Acceptance:** CI green on push; admin can disable a provider and the UI reflects it; error dashboard shows
injected failures; test coverage listed in `PROJECT_STATUS.md`.
