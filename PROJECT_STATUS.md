# PROJECT_STATUS — ShâVì Ai

**Milestone:** M03 — SHAVI AI Branding (verified in browser)
**Date:** 2026-11-16
**Audited by:** evidence collected from source, live worker HTTP calls, and browser runs on
`https://vktechlearn.site/shavi-ai/` (see §7 test log)

---

## 1. Existing architecture (as built, not as the master brief assumes)

| Layer | Reality | Files |
| --- | --- | --- |
| Frontend | Vite + React 19 + TypeScript SPA, Tailwind, shadcn-style UI, AI Elements chat primitives, Streamdown markdown | `shavi-ai-app/src/**` (App.tsx 924 lines, lib 417 lines) |
| Build | `bun run build` → static bundle in `shavi-ai/` (Vite `base: /shavi-ai/`) | `shavi-ai-app/vite.config.*`, `shavi-ai/assets/*` |
| Hosting (frontend) | GitHub Pages from `main` (Actions deploy, ~100 s) | `.github/workflows/*` |
| Backend | One Cloudflare Worker, ES module, no framework | `ai-worker/worker.js` (608 lines) |
| Hosting (backend) | Freebuff Sites worker, preview + production | `ai-worker/deploy.json`, siteId `8f2f0c1e-…` |
| AI provider | NVIDIA NIM (OpenAI-compatible) — chat `nvidia/nemotron-3-ultra-550b-a55b`, vision `meta/llama-3.2-90b-vision-instruct`, image `black-forest-labs/flux.1-dev` | worker env `AI_API_KEY`, `AI_MODEL`, `AI_VISION_MODEL` |
| Frontend→worker link | `window.SHAVI_API` from `shavi-ai/config.js` (production worker URL) | `shavi-ai/config.js`, `App.tsx:47` |
| Persistence | **No database.** Threads in `localStorage` key `shavi-ai-threads-v1`, max 50 threads | `App.tsx:48,180-196` |
| Identity/auth | **None.** No accounts, no sessions, no roles | — |
| Search | News RSS feeds (BBC Hindi, NDTV, Amar Ujala, IE Tech, The Verge, TechCrunch, Gadgets 360, NDTV Sports, BBC Hindi Sport) + GDELT attempt; Exa/Tavily hooks exist but keys absent | `worker.js:159-330` |
| LibreChat | **Not installed, not vendored, not referenced.** Same for Vercel AI SDK as a backend: only `ai` + `@ai-sdk/react` client packages are used for chat state/stream protocol | `shavi-ai-app/package.json` |
| Repo rules | Static Blogger-driven site in same repo; `AGENTS.md` rules (author byline `by Vïnâý Kúshwâhå`, no hand-edited `posts/*.html`) must stay intact | `AGENTS.md` |

**Conclusion:** this is a custom 2-tier app (static SPA + one Worker), not a LibreChat deployment.
"Use LibreChat as foundation" from the brief is **not** satisfied and cannot be satisfied without
replacing the working stack — that requires explicit approval (see §6, decision needed).

---

## 1b. M02 — LibreChat foundation (implemented this milestone)

**Architecture chosen:** B (LibreChat), per your instruction to set up the LibreChat foundation.

| Item | Value |
| --- | --- |
| LibreChat version | `v0.8.9` (latest stable tag at setup time), shallow clone into `librechat/` (gitignored) |
| Runtime | Node `v26.13.0` (LibreChat ships no `engines` pin; works, but Node 20–22 is the supported range) |
| Package manager | `npm ci` against LibreChat's `package-lock.json` (2.3 GB `node_modules`, 5 workspace packages built) |
| Database | Real `mongod 8.0.20` (started via `mongodb-memory-server`, persistent `dbPath`) on `127.0.0.1:27017` |
| Backend | `npm run backend` → `api/server/index.js`, listening `0.0.0.0:3080` |
| Frontend | LibreChat client built (`client/dist`) and served by the same backend |
| AI endpoint | `librechat.yaml` → custom endpoint `SHAVI AI`, `baseURL https://integrate.api.nvidia.com/v1`, key from `SHAVI_AI_KEY` env (never stored in files/commits) |
| Model specs | `modelSpecs.enforce: true` with one spec `shavi-default` → Nemotron Ultra 550B |
| Branding | `APP_TITLE=SHAVI AI` (page title, UI header) |

**Evidence (all run in this VM, no Docker):**

```
GET  /health                     200 OK
GET  /api/config                 appTitle "SHAVI AI", registrationEnabled true
POST /api/auth/register          200 (creates user; first user role ADMIN)
POST /api/auth/login             200 (JWT issued)
GET  /api/user                   role ADMIN, emailVerified true
GET  /api/models                 200, includes "SHAVI AI": ["nvidia/nemotron-3-ultra-550b-a55b"]
POST /api/agents/chat            200 → {streamId, conversationId, responseMessageId, status:"started"}
GET  /api/convos                 2 conversations persisted
GET  /api/messages/<convId>      assistant message content: [{type:think,...},{type:"text",text:"SHAVI-OK"}]
restart backend → /api/convos    still 2 conversations (data survived)
Browser (preview host)           login → new chat → typed "Reply with exactly: UI-OK"
                                 → /c/<uuid>, reply "UI-OK" with "Thoughts", sidebar updated
```

**Files added**

- `tools/setup-librechat.sh` — reproducible clone (pinned tag) + `npm ci` + packages + client build + mongo helper
- `tools/librechat-dev/mongod-server.mjs` — real mongod on 127.0.0.1:27017 with persistent `mongo-data/`
- `tools/librechat-dev/proxy3000.mjs` — exposes the app on this chat's reserved preview port
- `librechat-deploy/docker-compose.yml` — api + mongodb + meilisearch + rag_api + pgvector
- `librechat-deploy/.env.example` — every required variable, no secrets
- `librechat-deploy/librechat.yaml` — the same config that was verified locally
- `.gitignore` — `librechat/`, local mongo data, tool `node_modules`

**Blockers / deviations**

1. **Docker cannot run here**: `/var/run/docker.sock` is root-only and sudo is disabled in this container,
   so `docker compose up` is impossible in the Freebuff VM. The compose file is delivered for your host;
   the identical stack was verified natively (real mongod + real API + real browser session).
2. **No SMTP**: registration returns "check your email"; accounts are verified with
   `librechat/scripts-shavi/verify-email.mjs` (local-only script).
3. **RAG API not running locally** (needs the `rag_api`+pgvector containers): LibreChat logs
   "RAG API is not reachable", so file uploads/document Q&A are **not** verified in this milestone.
4. **Meilisearch not running locally**: conversation search falls back to Mongo; not verified.
5. LibreChat's built-in endpoint model lists (OpenAI/Google/…) still appear in `/api/models`, but the UI
   selector only offers the enforced `SHAVI AI — Nemotron Ultra` spec.
6. LibreChat is **gitignored**, not vendored: the repo stays a static site + Workers project; the pinned
   version is reproducible through `tools/setup-librechat.sh`.

## 1c. M03 — SHAVI AI branding (implemented this milestone)

Branding is applied **on top of the gitignored LibreChat clone** by an idempotent script, so the
third-party tree stays reproducible and this repo only carries our own files.

| Requirement | Implementation | Verification | Result |
| --- | --- | --- | --- |
| Wordmark / logo | `librechat-branding/brand/logo.svg` → `client/public/assets/logo.svg`; `brand/mark.svg` → `assets/shavi-mark.svg` | Auth/share screens use `logo.svg`; sidebar renders `shavi-mark.svg` (`img.complete && naturalWidth>0`) | PASS |
| Sidebar brand | `client/src/components/BrandMark.tsx` (new, links to `/c/new`) patched into `UnifiedSidebar/ExpandedPanel.tsx` and `UnifiedSidebar/mobile/Header.tsx` | `[data-testid="brand-mark"]` present on desktop **and** in the mobile drawer, icon loaded | PASS |
| New chat | LibreChat `NewChatButton` (kept) + brand link | `[data-testid="new-chat-button"]` present; `/c/new` opens a fresh conversation | PASS |
| Model selector | `interface.modelSelect: true` + `modelSpecs` spec with `iconURL` | `[data-testid="model-selector-button"]` opens a list containing "SHAVI AI — Nemotron Ultra" + description + our mark | PASS |
| Dark / light mode | LibreChat `ThemeSelector` (Settings → Appearance) | Switched to Dark → `html.dark`, `localStorage color-theme = dark`; after reload still `dark` | PASS |
| Responsive layout | LibreChat layout (unchanged) + brand in drawer header | 390×844: `scrollWidth === innerWidth` (no overflow), sidebar collapses, drawer opens with brand + chat list | PASS |
| Page title / footer | `APP_TITLE=SHAVI AI`, `CUSTOM_FOOTER` in `.env` / `.env.example` | Tab title "(1) SHAVI AI"; footer reads "SHAVI AI — Made by Vïnâý Kúshwâhå · © 2026 VK Tech Learn" | PASS |
| Welcome copy | `interface.customWelcome` in `librechat.yaml` | Hindi welcome line renders on `/c/new` | PASS |
| Favicons | `librechat-branding/make-favicons.mjs` (sharp) → 16/32/180 px PNGs | Files regenerated; LibreChat inlines its own icon data-URI, so the new PNGs are shipped but not visible everywhere | PARTIAL |
| Backend untouched | No API/DB changes this milestone | `POST /api/agents/chat` still streams; new conversation persisted (`/api/convos`, `/api/messages`); reply "M03-OK" received | PASS |

**Files added/changed (this repo):** `librechat-branding/{apply-branding.sh,make-favicons.mjs,brand/logo.svg,brand/mark.svg}`,
`librechat-deploy/librechat.yaml`, `librechat-deploy/.env.example`.
**Files changed inside the LibreChat clone (regenerated by the script):** `client/public/assets/{logo.svg,shavi-mark.svg,favicon-*.png,apple-touch-icon-180x180.png}`,
`client/src/components/BrandMark.tsx`, `client/src/components/UnifiedSidebar/ExpandedPanel.tsx`, `client/src/components/UnifiedSidebar/mobile/Header.tsx`.

**Known gaps:** the UI chrome strings are LibreChat's English i18n (Hindi is selectable in Settings → Language);
`customFooter` is only exposed via env and not by `/api/config` for anonymous callers (UI shows it after login);
favicon override is partially masked by LibreChat's inline icon.

## 2. Requirement audit (evidence-based)

Legend: ✅ verified working · ⚠️ partial · ❌ missing · — not applicable to current stack

### 2.1 Chat core

| Requirement | Implementation files | Backend verification | Frontend verification | Test result | Remaining issue |
| --- | --- | --- | --- | --- | --- |
| Streaming responses (SSE) | `worker.js:511-600` (`/api/chat`, SSE `{delta}`), `App.tsx:63-160` (`ShaviTransport` → AI SDK chunks) | Live `POST /api/chat` streamed real tokens; `data: {delta}` frames | Live UI rendered streaming text | ✅ | No `usage`/token counts forwarded |
| Conversation history | `App.tsx` `loadThreads/saveThreads`, `persist()` | None (client-only) | 10 threads listed; reload kept 10 threads and message title | ⚠️ | **localStorage only** — lost with storage clear, not synced across devices, max 50 threads |
| Multiple conversations | `startWith`, `remove`, `rename`, sidebar list | — | New chat, rename, delete all wired to state | ✅ | No archive, no pin |
| Conversation search | `filter` state on title only | — | Search input filters sidebar | ⚠️ | Title-only, not message content |
| Rename / delete | `rename()` (window.prompt), `remove()` | — | Dropdown works | ✅ | Uses browser `prompt()` (not styled) |
| Archive | — | — | — | ❌ | Not implemented |
| Edit previous message | — | — | — | ❌ | Not implemented |
| Regenerate | — | — | — | ❌ | Not implemented |
| Continue response | — | — | — | ❌ | Not implemented |
| Stop generation | `stop` from `useChat` → `PromptInputSubmit onStop`; transport `abortSignal` + `cancel()` | Abort propagates to reader cancel | Stop button appears while busy | ✅ | Upstream NVIDIA request is cancelled client-side; no server-side cancel accounting |
| Markdown / code / tables / math / mermaid | `MessageResponse` (streamdown + `@streamdown/{code,math,mermaid,cjk}`) | — | Rendered in live chats | ✅ | Mermaid/math not exercised in a test this milestone |
| Export conversation | `exportChat()` (Markdown), `ExportMenu` + `lib/export.ts` (PDF/DOCX/XLSX/PPTX) | — | Exports produced earlier (PDF 1 page w/ Hindi, DOCX zip, XLSX table, PPTX 2 slides) | ✅ | Export of very long chats untested |
| Share conversations | — | — | — | ❌ | Not implemented (no public share route, no permissions) |
| Message actions (copy/like/dislike/share/read-aloud) | Copy only | — | Copy writes clipboard + toast | ⚠️ | Like/dislike/share/read-aloud missing |
| Persistent preferences | `dark` state; no storage | — | Theme toggle switches classes | ⚠️ | Theme resets on reload (defaults dark); no other prefs |
| Token usage display | — | upstream `usage` ignored | — | ❌ | Not implemented |

### 2.2 Model engine

| Requirement | Evidence | Result | Remaining issue |
| --- | --- | --- | --- |
| Model selector in UI | No selector in `App.tsx`; header shows wordmark only | ❌ | Single hard-coded model |
| Central model registry | Constants only (`DEFAULT_MODEL`, `DEFAULT_VISION_MODEL`, `IMAGE_MODEL`) — no capability metadata, no context limits | ❌ | Needs registry structure |
| Multi-provider (DeepSeek/OpenAI/Gemini/Anthropic/OpenRouter/Groq/Mistral/Ollama) | Only NVIDIA NIM (`DEFAULT_BASE`, `/chat/completions`) | ❌ | Provider abstraction absent |
| Server-side keys | `env.AI_API_KEY` used only in worker; no key in bundle (checked config.js) | ✅ | — |
| Provider error handling | Non-2xx → SSE `{error}` with status + detail; network catch | ✅ | No retry/fallback |
| Rate limits | In-memory `hits` Map, 30/hour/IP, `429` on exceed (`worker.js:52-63`) | ⚠️ | Per-isolate memory → not global; resets on cold start |
| Fallback provider | — | ❌ | — |

### 2.3 Files / documents (asked *what is in my file*, not just upload UI)

| Requirement | Implementation files | Verification | Result | Remaining issue |
| --- | --- | --- | --- | --- |
| PDF text | `lib/files.ts` `readPdf` (pdfjs, per-page `[पेज N]`) | Earlier real PDF answered with page refs | ✅ | Capped at 24 000 chars |
| Scanned PDF OCR | `pageToImage` → `POST /api/ocr` (vision model), max 6 pages | Real scan → invoice fields extracted | ✅ | >6 scanned pages silently left blank (note only counts OCRed pages) |
| DOCX | `readDocx` (mammoth raw text, Hindi fine) | DOCX question answered ("25,000 रुपये, गोरखपुर") | ✅ | Tables come as flat text, structure lost |
| XLSX/CSV | `readSheet` (SheetJS, up to 6 sheets × 120 rows → markdown tables) | Totals 4,45,000 / 2,83,000 / 1,62,000 read correctly | ✅ | Rows >120 per sheet truncated without page refs |
| PPTX | `readPptx` (JSZip + `<a:t>` per slide) | Slide content answered | ✅ | No speaker notes, no images |
| DOC, RTF, ODT, ODS, XLS(legacy) | `.xls` handled by SheetJS; DOC/RTF/ODT/ODS rejected with message | Not tested | ⚠️ | 4 of the brief's formats missing |
| Images (vision) | `imageToDataUrl` → `/api/chat` `images[]` (max 3) | Image question answered by vision model | ✅ | No multi-image table extraction test |
| File type/size limits | `FILE_ACCEPT`, `maxFiles=3`, `maxFileSize=20 MB` | UI-level only | ⚠️ | Worker validates data-URL type/count but not size; no server-side virus/type check |
| Upload progress | PromptInput attachment state + toast | — | ⚠️ | No real percentage progress |
| Page/sheet references in answers | Page markers `[पेज N]`, `[शीट: name]` in extracted text | Answers included page/sheet refs in earlier tests | ✅ | Not guaranteed by prompt for every answer |
| RAG / vector search | `buildDocumentContext` keyword scoring, no embeddings, no vector DB | — | ⚠️ | Keyword chunking only; no pgvector/Qdrant |
| Code-interpreter-grade Excel math | XLSX totals computed by the model from tables (no sandbox) | Earlier numeric answers correct | ⚠️ | Model arithmetic, not a real interpreter |
| Secure storage of files | Files never leave the browser except OCR page images; no bucket, no persisting | — | ✅ | — |

### 2.4 Web search / research

| Requirement | Evidence | Result | Remaining issue |
| --- | --- | --- | --- |
| Real web search with citations | News feeds only; `/api/news` debug route; model gets formatted sources with URLs; live answer had 4 clickable BBC links + dates | ⚠️ | No general page search (Exa/Tavily keys absent), no page-content fetching |
| Citations clickable in UI | `linkify()` + `linkSafety:{enabled:false}` | ✅ | — |
| No fabricated citations | System prompt forbids inventing URLs; irrelevant-topic note added | ✅ | Model can still drift; no URL validation server-side |
| Deep research (multi-step, compare sources) | — | ❌ | Not implemented |
| Distinguish sourced vs model knowledge | Prompt rule (sources section + "search से नहीं") | ⚠️ | Prompt-level only, not enforced |

### 2.5 Image generation

| Requirement | Evidence | Result | Remaining issue |
| --- | --- | --- | --- |
| Text-to-image | `POST /api/image` (FLUX.1-dev, steps 8), UI "इमेज बनाएँ" button + gallery + download | 1024×1024 image generated earlier | ✅ | — |
| Aspect ratio / quality controls | Not present (fixed) | ❌ | — |
| Image-to-image / editing | Endpoint attempt returned 422 on every payload (NVIDIA Kontext); feature removed | ❌ | Blocked upstream |
| Generation history persistence | `generated` state only (per session) | ⚠️ | Lost on reload |

### 2.6 Voice / audio, memory, agents, accounts, admin

| Area | Evidence | Result |
| --- | --- | --- |
| Mic input / STT / TTS / read aloud | No code paths in `App.tsx` | ❌ |
| Memory / custom instructions / personalization | None | ❌ |
| Agent tool framework, sandboxes, permissions | None (single deterministic search path, no tool calling) | ❌ |
| Registration / login / logout / password reset | None | ❌ |
| Admin panel, usage/cost stats, audit logs | None | ❌ |
| RBAC | None | ❌ |

### 2.7 Security & performance posture

| Item | Evidence | Result |
| --- | --- | --- |
| No secrets in frontend | `shavi-ai/config.js` has only worker URL; bundle grep: no keys | ✅ |
| CORS allowlist | `cors()` allows configured origins **plus any `*.style.dev` and localhost** | ⚠️ style.dev wildcard is broad for production |
| Input validation | `pickText` slices/trims, image data-URL regex, prompt ≤800 chars, body parse guarded | ✅ |
| Rate limiting | 30 req/hour/IP in memory | ⚠️ non-durable |
| Auth on endpoints | None — public API (intended for free tool, but means no per-user quota) | ⚠️ |
| XSS | React escapes; `linkSafety` disabled but links come from feed URLs; streamdown sanitizes HTML by default | ⚠️ no explicit `allowedTags` audit |
| Logging/audit | None (errors returned to client only) | ❌ |
| Payload caps | `MAX_CHARS 8000`/message, 20 turns, trim to last 10 in transport | ✅ |
| Caching / pagination | No cache; sidebar renders all threads (≤50) | ⚠️ fine at current size |
| Bundle size | Main bundle ≈ 2.4 MB (pdfjs, xlsx, docx, pptxgenjs, mermaid, shiki) | ⚠️ slow first load on mobile; lazy `readAttachment`/`saveAs` already used |

---

## 3. Simulated / misleading functionality found

1. **`/health` reports `news: "gdelt+rss"`** — GDELT returns 0 items from Worker egress (verified twice);
   only RSS works. Field should say `news: "rss"` with `gdelt:false`, or GDELT removed.
2. **`search: true` in `/health`** is hard-coded — it does not reflect Exa/Tavily configuration.
3. **`/api/news` debug route** is a permanent diagnostic endpoint on the production worker (no rate
   limiting) — acceptable for now, but it is a public surface that should be removed or gated.
4. **Theme toggle resets** after reload (no persistence), while UI implies a saved preference.
5. No other fake buttons found: every visible control in `App.tsx` maps to real state or a real API call.

## 4. Known bugs / risks (ranked)

1. **No database + no auth** → brief's "history survives logout/refresh/server restart" only partly true
   (refresh yes, other browser/device no). This blocks accounts, sharing, memory, usage stats.
2. **Master brief mismatch**: LibreChat foundation and multi-provider engine are absent; rebuilding on
   LibreChat would mean replacing this working 2-tier app (needs approval; also GitHub Pages + Workers
   cannot host LibreChat's Node/Mongo stack — Freebuff Sites cannot run a Node server).
3. **GDELT blocked from Worker**; no Exa/Tavily key → no general web search/deep research.
4. **Rate limit is per-isolate** and unauthenticated → easy to bypass/abuse, and shared by the whole site.
5. **CORS `*.style.dev` wildcard** on production worker.
6. **File caps**: PDF 24k chars, OCR 6 pages, sheets 6×120 rows, 3 attachments — silently truncated
   (note shown only for OCR).
7. **Image editing** unavailable (upstream 422).
8. **No automated test suite** in the repo; all verification so far is manual/Playwright-driven, so
   regressions are caught only by re-testing by hand.

## 5. Milestone roadmap (proposed, each independently verifiable)

| # | Milestone | Acceptance criteria | Depends on |
| --- | --- | --- | --- |
| M1 | **Status/health honesty + hardening** | `/health` reflects real search/news state; `/api/news` rate-limited or dev-gated; CORS wildcard removed | — |
| M2 | **Server persistence (Sites D1)** | conversations/messages tables, CRUD API with anonymous device token, frontend migration from localStorage, refresh/new-browser test | M1 |
| M3 | **Accounts + RBAC** | Freebuff auth (or magic link), per-user ownership checks, data export/delete, 401/403 tests | M2 |
| M4 | **Model registry + 2nd provider** | registry with capabilities, UI selector, provider abstraction, fallback, token usage display | — |
| M5 | **Chat parity actions** | edit message, regenerate, continue, stop (already), like/dislike, share links with permissions | M2 |
| M6 | **Search upgrade** | Exa (or Tavily) key wired, page-content extraction, deep-research report with citations | key from user |
| M7 | **Docs/voice/memory** | DOC/RTF/ODT/ODS support, chunking with page refs, STT/TTS, memory CRUD | M2 |
| M8 | **Admin + observability** | provider/model toggles, usage & error stats, audit log, automated test suite in CI | M3 |

**Recommended first implementation milestone: M1** (small, no risk to existing features), then **M2**.

## 6. Decision needed from you

The brief asks to build on LibreChat + Vercel AI SDK with a database and accounts. This repo currently
ships a working Workers + static-SPA app that cannot host LibreChat's Node/Mongo stack on its current
hosting (GitHub Pages + Freebuff Sites). Choose one:

- **A (recommended):** keep this architecture, implement M1→M8 above (Workers + D1 + auth).
- **B:** migrate to LibreChat on a Node host (new deployment target, new Mongo/Meilisearch stack, existing
  Worker/UI work retired). Needs new hosting and is a multi-week replacement, not an extension.

No feature work will start until you pick one.

## 7. Test log (this audit)

```
GET  /health                     200  {"demo":false,"search":true,"news":"gdelt+rss","exa":false,"tavily":false}
OPTIONS /api/chat (CORS)         200  allow-origin: https://vktechlearn.site, allow-headers: Content-Type
POST /api/chat {}                400  {"error":"कृपया पहले कुछ लिखें।"}
POST /api/ocr {"images":[]}      200  {"texts":[]}
POST /api/ocr bad json           400  {"error":"इमेज भेजें।"}
POST /api/image prompt:""        400  {"error":"क्या बनाना है, लिखें।"}
GET  /unknown                    404  "Shavi AI API. POST /api/chat"
GET  /api/news?q=tech            200  count 6, items 6 (gdelt 0)
GET  /shavi-ai/                  200
GET  /pdf/ , /img/               200
Browser: new chat → ask "2+2"   → localStorage threads 10, messages 2, title auto-set
Browser: reload                 → sidebar still 10 threads, first title intact
Browser: theme toggle           → html.dark removed, body bg oklch(0.985 …) (light)
Browser: news question (earlier) → 4 <a target="_blank"> BBC links, dates 2026-11-16, "स्रोत" section
```

Not verified in this audit (no change made, previously verified): DOCX/XLSX/PPTX/PDF/OCR flows,
image generation, exports. No feature code was modified in M01.

## 8. Files that will be touched by the roadmap

- `ai-worker/worker.js` — registry, providers, auth checks, D1 queries, health honesty
- `ai-worker/deploy.json` — bindings (D1/R2) when storage lands
- `shavi-ai-app/src/App.tsx` — selector, message actions, sync layer, auth screens
- `shavi-ai-app/src/lib/*` — storage client, document pipeline upgrades
- new: `ai-worker/migrations/*.sql`, `tests/*` — schema + automated checks
- untouched: `index.html`, `posts/*`, `tools/build_posts.py`, `post.css` (site rules)
