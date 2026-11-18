# PROJECT_STATUS — ShâVì Ai

**Milestone:** M07 — OCR and Document AI (implemented and verified; M05 still unaudited)
**Date:** 2026-11-18
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


## 1d. M04 — AI API integration (DeepSeek, OpenAI, Gemini)

**Model registry lives in `librechat/librechat.yaml` (+ `librechat-deploy/librechat.yaml`), keys live only in
the environment.** Model IDs were taken from the providers' own documentation on 2026-11-17, not guessed:

| Provider | Endpoint in LibreChat | Base URL | Model IDs used | Source |
| --- | --- | --- | --- | --- |
| NVIDIA NIM (house model) | custom `SHAVI AI` | `https://integrate.api.nvidia.com/v1` | `nvidia/nemotron-3-ultra-550b-a55b` | existing M02 config |
| DeepSeek | custom `DeepSeek` | `https://api.deepseek.com` | `deepseek-flash`, `deepseek-v4-pro` | api-docs.deepseek.com/quick_start/models |
| OpenAI | built-in `openAI` | `https://api.openai.com/v1` | `gpt-6.1-sol`, `gpt-6-luna`, `gpt-6-astra` | developers.openai.com/api/docs/models |
| Google Gemini | built-in `google` | `https://generativelanguage.googleapis.com` | `gemini-4-argon`, `gemini-3.8-flash` | ai.google.dev/gemini-api/docs/models |

`modelSpecs.enforce: true` + 7 specs (one per model; 8 after M06 added the vision spec) drive the selector; the registry is the single source of
truth for which provider/model a user can pick, and each spec carries label, capability description and icon.

| Requirement | Implementation files | Backend verification | Frontend verification | Test result | Remaining issues |
| --- | --- | --- | --- | --- | --- |
| DeepSeek official API | `librechat.yaml` custom endpoint `DeepSeek`, `baseURL https://api.deepseek.com`, `apiKey ${DEEPSEEK_API_KEY}` | Dummy key → `401 Authentication Fails, Your api key: ****-key is invalid (request_id …)` from DeepSeek itself; message persisted with `endpoint: DeepSeek, model: deepseek-flash` | Selector shows "DeepSeek V4.1 Flash" / "DeepSeek V4 Pro"; selecting routes request with `endpoint: DeepSeek` | **PASS (wiring + error path)** | No valid `DEEPSEEK_API_KEY` → no successful completion yet (see blocker) |
| OpenAI official API | `librechat.yaml` built-in `openAI` (+ `titleModel gpt-6-luna`) | Dummy key → `401 Incorrect API key provided … platform.openai.com/account/api-keys`; message persisted with `endpoint: openAI, model: gpt-6.1-sol` | Specs "OpenAI GPT-6.1 Sol" / "GPT-6 Luna" listed with OpenAI icon | **PASS (wiring + error path)** | No valid `OPENAI_API_KEY` → no successful completion yet |
| Gemini official API | `librechat.yaml` built-in `google` | Dummy key → `400 API key not valid. Please pass a valid API key.` from `generativelanguage.googleapis.com`; message persisted with `endpoint: google, model: gemini-3.8-flash` | Specs "Google Gemini 4 Argon" / "3.8 Flash" with Google icon | **PASS (wiring + error path)** | No valid `GOOGLE_KEY` → no successful completion yet |
| Model registry | `modelSpecs.list` (7 specs in M04; an 8th vision spec was added in M06), `/api/models` | `GET /api/models` → `openAI: 33`, `google: 15`, `SHAVI AI: 1`, `DeepSeek: 2`; `GET /api/config` → 7 spec names | Selector lists exactly 7 specs; all 7 icons load (`img.complete && naturalWidth>0`) | PASS | LibreChat hides endpoints without a key, so an unconfigured provider's spec is listed but cannot route (see gap 1) |
| Streaming | LibreChat agents stream (`/api/agents/chat` → generation job) | `POST /api/agents/chat` → `{streamId, conversationId, generationProtocolVersion: 1}`; after completion `GET /api/messages/<id>` → assistant text `M04-STREAM-OK` | UI renders the reply progressively (verified in M03 browser run) | PASS | SSE body is a job handle in this version; token-by-token capture not measured over the wire |
| Error handling | LibreChat provider error passthrough, surfaced in-message | No key → `Missing API Key for DeepSeek`; invalid key → provider's own 401/400 text; endpoint/spec mismatch → `Model spec mismatch` (no silent fallback to another provider) | Error text rendered inside the chat bubble, request terminates (no hang, 0:00 timer) | PASS | Provider errors are raw JSON strings for Gemini (LibreChat formats them verbatim) |
| API key security | `tools/start-librechat.sh` loads keys from untracked files into the process env; `.gitignore` covers `ai-key.txt`, `openai-key.txt`, `deepseek-key.txt`, `gemini-key.txt`; `.env.example` has placeholders only | `grep -r nvapi client/dist` → no match; `grep -r nvapi librechat.yaml librechat-deploy/*` → no match; launcher prints only key lengths | Keys are never sent to the browser (`/api/config` contains no key fields) | PASS | Keys must be pasted into local files/secret store; nothing is stored in Mongo |
| Model switching | Selector → `onSelectSpec` → `newConversation` with preset (`endpoint` + `model`) | DeepSeek run: payload `{endpoint: "DeepSeek", endpointType: "custom", model: "deepseek-flash", spec: "deepseek-flash"}`; Gemini run (dummy key): payload `{endpoint: "google", model: "gemini-3.8-flash"}` and Gemini's own 400 came back | Header label updates to the chosen spec; switching back to "SHAVI AI — Nemotron Ultra" keeps working (reply `M04-STREAM-OK`) | **PASS with keys present, FAIL without** | See gap 1: with no key at all for a provider, LibreChat drops that endpoint from the client config, the switch silently keeps the old endpoint, and the server rejects it as `Model spec mismatch` |
| Database integration | Mongo `messages`/`conversations` (LibreChat models) | Mongo query grouped by `endpoint`/`model`: `SHAVI AI/nvidia/nemotron-3-ultra-550b-a55b`, `DeepSeek/deepseek-flash`, `openAI/gpt-6.1-sol`, `google/gemini-3.8-flash` all stored; survives backend restart | Each switched model's message renders with its spec label | PASS | Error rows store the provider error object, not a normalised code |

**Gaps / blockers (honest state of M04)**

1. **No valid provider keys in this workspace.** `ai-key.txt` is the only real key (NVIDIA). `openai-key.txt`,
   `deepseek-key.txt`, `gemini-key.txt` exist as placeholders (`PASTE_YOUR_KEY_HERE`). Consequences:
   - real completions from OpenAI/DeepSeek/Gemini are **not** verified — only that requests reach the official
     endpoints and their auth errors come back;
   - LibreChat omits keyless endpoints from the client config, so picking an unconfigured provider's spec ends in
     `Model spec mismatch` instead of a "provider not configured" message. This is expected LibreChat behaviour,
     but the UX is poor. Fixing it properly needs either the keys (endpoint becomes selectable) or a UI patch to
     hide unconfigured specs; I did not patch the vendored client for this.
2. Streaming granularity was verified through persisted message content and UI rendering, not by counting
   provider deltas on the wire.
3. `titleModel` for OpenAI is `gpt-6-luna`; with a valid key the conversation-title job will consume a small
   amount of quota. Gemini titles use the first available model (no explicit `titleModel`, because the model
   list is provider-driven in this LibreChat version).
4. Anthropic/azure/bedrock/assistants endpoints remain visible in `/api/models` (LibreChat defaults) but are not
   offered in the selector, since `modelSpecs.enforce` is on.

**How to unblock (user action, ~2 minutes)**

```bash
cd <repo>
printf '%s' 'sk-...'  > openai-key.txt      # OpenAI platform key
printf '%s' 'sk-...'  > deepseek-key.txt    # DeepSeek platform key
printf '%s' 'AIza...' > gemini-key.txt      # Google AI Studio key
tools/start-librechat.sh --bg               # prints which keys are set (lengths only)
```

No restart of Mongo is needed; keys are read at process start and never written to disk by the app.

## 1e. M05 — not audited (the turn never started)

The M05 request (chat history, rename, delete, edit, regenerate, stop, continue, markdown, code
blocks, tables, export) arrived while this VM was unavailable, so **no agent work ran for M05** and
no M05 audit exists. Those features are LibreChat-native and were exercised incidentally during the
M04/M06 runs below (persisted conversations in Mongo, rename/delete in the sidebar, stop button,
regenerate/continue actions, streamed markdown) but **they are not verified evidence and M05 must
still be audited on its own** before it can be called complete. M06 was requested next and is
audited against the M04 state of the build.

## 1f. M06 — File upload system (PDF, DOCX, DOC, TXT, XLSX, XLS, CSV, PPTX, JSON, images)

**Pipeline (real, no mocks):**

```
composer attach → POST /api/files (multipart) → processAgentFileUpload
  → resolveUploadLLMDeliveryPath   text | provider | none
  → document parser / native text  → extracted text stored on the file record
  → files collection in MongoDB (text, llmDeliveryPath, context, source, bytes)
send → POST /api/agents/chat { files: [...] } → resolveTurnLLMDeliveryPath
  → text attached to the prompt | image sent as vision part
```

**Files added / changed (this repo):**

| File | Purpose |
| --- | --- |
| `librechat-deploy/librechat.yaml` | `fileConfig` block (text delivery for documents, `provider` for images, `textFallbackWithoutTools`); 8th spec `shavi-vision` + `nvidia/nemotron-3.5-super-vl-120b-a12b` in the SHAVI AI endpoint |
| `librechat-file-support/apply-file-support.mjs` | idempotent patch on the (gitignored) LibreChat clone: PPTX parser (yauzl over `ppt/slides/slideN.xml`), legacy `.doc` parser (`word-extractor`), both MIME types registered as parser + text-path types, `word-extractor` install, `build:data-provider` + `build:api` |
| `tools/make-upload-fixtures.py` | generates the 11 fixtures, each with a unique token and a number |
| `tools/librechat-dev/upload-test.mjs` | uploads every fixture through `/api/files` and dumps the stored Mongo records |
| `tools/librechat-dev/m06-ai-context-test.mjs` | per-format end-to-end chat test: upload → real turn → asserts the model's answer contains the document's token/number |
| `tools/setup-librechat.sh` | now copies the runtime config and applies the parser patch after `npm ci` |

**What the audit found before the fix (baseline, same build):**

| Fixture | Upload | Delivery | Stored text | Result before fix |
| --- | --- | --- | --- | --- |
| txt, csv, json, xls, xlsx, docx | 200 | `text` | 71–342 chars | OK |
| pdf | 200 | `provider` | 0 chars | PDF base64 would be posted to NVIDIA NIM, which does not accept documents |
| doc, pptx | 200 | `none` | 0 chars | uploaded "successfully" but the model never received it (silent, no error) |
| png, jpg | 200 | `provider` | – | no vision model in the registry (Nemotron Ultra is text-only) → upstream model error |

**Per-format evidence (after the fix — `node tools/librechat-dev/m06-ai-context-test.mjs`):**

| Requirement | Implementation files | Backend verification | Frontend verification | Test result | Remaining issues |
| --- | --- | --- | --- | --- | --- |
| PDF | LibreChat built-in parser (`packages/api/src/files/documents/crud.ts` `pdfToText`, pdfjs) + `fileConfig` text delivery | upload 200, `llmDeliveryPath=text`, text 294 chars; `/api/messages` answer `Token: TOKEN-PDF-4417 / Budget: 445000 rupees` | PDF chip in composer, answer rendered in chat (browser run) | **PASS** | no page markers in extracted text; scanned PDFs need OCR |
| DOCX | `wordDocToText` (mammoth) | text 246 chars (Hindi + table); answer `Token: TOKEN-DOCX-5521 / Scholarship amount: 25000` | chip + answer render | **PASS** | tables flattened to text |
| DOC (legacy Word 97) | **new** `legacyWordDocToText` via `word-extractor` in `apply-file-support.mjs` | text 196 chars; answer `This is a simple word document created using Word 97 - SR2.` | not re-run in browser (API only) | **PASS** | body + headers/footers only; images/tables not extracted |
| TXT | native text path (`parseTextNative`) | text 178 chars (Hindi preserved); answer `TOKEN-TXT-3399` | chip + answer render | **PASS** | — |
| XLSX | built-in spreadsheet parser (`spreadsheetToText`, SheetJS) | text 143 chars; answer `Token: TOKEN-XLSX-6633 / Hardware Amount: 445000` | chip + answer render | **PASS** | sheet cell cap applies, layout flattened |
| XLS (legacy) | same spreadsheet parser | text 80 chars; answer `Token: TOKEN-XLS-7744 / East Region Revenue: 445,000` | not re-run in browser | **PASS** | — |
| CSV | native text path | text 71 chars; answer `TOKEN-CSV-8855` | not re-run in browser | **PASS** | no table rendering; raw text to the model |
| PPTX | **new** `pptxToText` (yauzl, `<a:t>` runs, `[Slide N]` blocks, 50 MB inflate cap + zip-bomb guard) | text 176 chars; answer `Token: TOKEN-PPTX-9966 / Launch Budget: 445000 rupees` | not re-run in browser | **PASS** | speaker notes, charts and images not extracted |
| JSON | native text path | text 342 chars; answer `token: TOKEN-JSON-1177, budget_rupees: 445000` | not re-run in browser | **PASS** | sent verbatim (not pretty-summarised) |
| PNG image | vision path (`provider`) + `shavi-vision` spec (`nvidia/nemotron-3.5-super-vl-120b-a12b`) | upload 200, converted to `/images/...png` (900×600), answer `Token: TOKEN-IMG-2288 / Invoice Total: 445000 rupees` | image preview rendered in the message (`naturalWidth=900`), full-size preview modal in My Files, answer in chat — screenshot `artifacts/design/m06-image-context.png` | **PASS** | large images are resized client-side before upload |
| JPG image | same vision path (server converts jpg→png) | answer `Token: TOKEN-JPG-6611 / Invoice total: 445000 rupees` | not re-run in browser | **PASS** | — |
| Upload / storage | `POST /api/files` (`api/server/routes/files/files.js`, `services/Files/process.js`), local strategy | 11/11 uploads 200; Mongo `files` has 65 docs, 47 with extracted text, per-MIME counts for all ten types | attach/detach chip in composer, upload toast | **PASS** | no percentage progress bar (LibreChat shows a spinner/toast) |
| Preview | LibreChat composer chip + message image + My Files dialog | `GET /images/<file>` serves the stored image | My Files dialog lists every upload with source/context/size and a full-size image preview — screenshot `artifacts/design/m06-files-preview.png` | **PASS (images)** | documents have no in-app viewer; their text is the preview the model sees |
| Extraction | `extractInspectableFileText` + size caps (`MAX_STORED_EXTRACTED_TEXT_BYTES`, 15 MB parser cap) | stored `text` field inspected per record; `No text found in document` returned for text-free documents | extraction errors surface as an upload toast, not a silent success | **PASS** | no OCR/vision fallback for scanned PDFs |
| AI context | `resolveTurnLLMDeliveryPath` + files[] on `/api/agents/chat` | 32 user messages carry `files[]`; replies quote document tokens | browser run: PDF and image answers rendered with the correct token | **PASS** | long documents count against the model context window |
| Database integration | Mongo `files` (text, delivery path, context) and `messages.files` | counts above; records survive backend restart | My Files shows the rows | **PASS** | — |
| Config / reproducibility | `librechat-deploy/librechat.yaml` + `librechat-file-support/apply-file-support.mjs` + `tools/setup-librechat.sh` | LibreChat boot log shows the merged `fileConfig`; patch is idempotent | model selector now lists 8 specs including "SHAVI AI — Nemotron 3.5 VL" | **PASS** | the clone is gitignored, so the patch must be re-applied after any re-clone (setup does it) |

**Unit tests run (both green after the patch):**

```
packages/api   npx jest src/files/documents/crud.spec.ts   21 passed
data-provider  npx jest src/file-config.spec.ts           270 passed
```

**Gaps / blockers (honest state of M06)**

1. **No RAG API / vector store.** There is no Docker in this VM, so `RAG_API_URL` is unset:
   `file_search` (vector indexing, citations from chunks) is unavailable. Uploads work as **direct
   file context**, which is what this milestone asked for; document Q&A over a corpus does not.
2. **No OCR provider.** A scanned/image-only PDF returns `No text found in document`. Fixing it
   needs Mistral OCR (paid key) or the RAG API's unstructured pipeline. Images work because they go
   to the vision model instead.
3. **PPTX/DOC extraction is text-only**: slide bodies (no notes/charts/images) and Word body +
   headers/footers (no embedded images, tables flattened).
4. **No antivirus/MIME sniffing**: the upload parser trusts the multipart content type for choosing
   a reader; the file-config allowlist is the only gate.
5. **Provider keys still missing** for OpenAI/DeepSeek/Gemini (M04 blocker), so "send a PDF to GPT-6"
   cannot be verified yet — only the NVIDIA endpoint is live.
6. The `.doc` fixture is Apache POI's public Word 97 sample document (no company-specific token), so
   its check asserts the document's own first sentence; the other ten fixtures carry unique tokens.
7. Parsed text is capped by LibreChat (15 MB parser input, extracted-text storage cap) — a very large
   workbook/PDF is truncated rather than rejected.

**Reproduce**

```bash
bash tools/setup-librechat.sh                     # clone + npm ci + config copy + parser patch + builds
node tools/librechat-dev/mongod-server.mjs &      # real mongod
bash tools/start-librechat.sh --bg                # backend + provider keys from the untracked files
python3 tools/make-upload-fixtures.py             # 11 fixtures in artifacts/m06-fixtures
node tools/librechat-dev/upload-test.mjs          # per-format upload + Mongo record dump
node tools/librechat-dev/m06-ai-context-test.mjs  # per-format end-to-end AI answer check
```

## 1g. M07 — OCR and Document AI (scanned PDFs + images, Hindi + English, page refs, tables)

**What the audit found before this milestone:** there was **no OCR engine at all**.
LibreChat only OCRs through a Mistral OCR key (`ocr.strategy: mistral_ocr`) or the RAG API, neither
of which is configured here, and its built-in PDF parser reads the text layer only. A scanned PDF
therefore extracted to `""` and answered `No text found in document`; an image was readable only by
sending it to the vision model at chat time (no transcription stored, no page references).
`custom_ocr` exists as an enum value but has no implementation in v0.8.9.

**Implementation (tracked in this repo, applied to the gitignored clone):**

| File | Purpose |
| --- | --- |
| `librechat-ocr/files/shaviOcr.ts` → `librechat/packages/api/src/files/documents/shaviOcr.ts` | OCR engine: pulls the page image out of a PDF with pdfjs, paints its pixels into a PNG with `canvas`, and transcribes it with the OpenAI-compatible vision endpoint. One retry-free request per page, 180 s timeout, env-only config. |
| `librechat-ocr/apply-ocr-support.mjs` | idempotent patch: page-by-page `pdfToText` (text layer used when present, OCR only on pages shorter than 24 chars, `[Page N]` markers), `imageToText` for png/jpg/webp/gif, image MIME types registered as parser types, upstream spec updated for that intentional change, `canvas` install, `build:data-provider` + `build:api` |
| `tools/start-librechat.sh` | exports `SHAVI_OCR_API_KEY` (defaults to the existing NVIDIA key — no extra secret file), `SHAVI_OCR_BASE_URL`, `SHAVI_OCR_MODEL` (`nvidia/nemotron-3.5-super-vl-120b-a12b`), `SHAVI_OCR_MAX_PAGES` |
| `tools/make-ocr-fixtures.py` | generates the fixtures: image-only 2-page and 3-page PDFs (Hindi + English), a table PDF, a **mixed** PDF (real text page + scanned page), a Hindi image note, an English table image |
| `tools/librechat-dev/m07-agent-ocr-test.mjs` | image OCR end-to-end: OCR text stored on the file record, then a **text-only** model answers from it |
| `tools/librechat-dev/upload-test.mjs` | extended with `--tool-resource` / `--agent-id` for OCR-resource uploads |
| `tools/setup-librechat.sh` | runs the OCR patch after the file-support patch |

**Evidence (every row produced by a real call, no mocks):**

| Requirement | Implementation files | Backend verification | Frontend verification | Test result | Remaining issues |
| --- | --- | --- | --- | --- | --- |
| Scanned PDF OCR (Hindi + English) | `shaviOcr.ts`, `crud.ts#pdfToText` | upload 200, `llmDeliveryPath=text`, stored text 504 chars: `गंगा स्वच्छता परियोजना … Token: TOKEN-SCAN-101 … बजट: 445000 … First instalment amount: 283000`; answer `162000 रुपये — पेज 2` | chip `scanned-multipage.pdf · Document`, answer rendered in chat | **PASS** | one vision call per scanned page (~4–12 s/page) |
| Page references | `[Page N]` markers written by `pdfToText` | Mongo text starts `[Page 1] … [Page 2] … [Page 3]`; answer cites `पेज 2` / `पेज 3` | browser answer: “पेज 2 — पात्र जिले … पेज 3 — कुल राशि 8,90,000” | **PASS** | markers are page blocks, not per-line coordinates |
| Multi-page documents | same | 3-page scan → 3 `[Page N]` blocks, 580 chars, every page's token present (`TOKEN-OCR-201/202/203`) | 2-page scan uploaded through the UI and answered per page | **PASS** | OCR is capped at `SHAVI_OCR_MAX_PAGES` (12) pages per document |
| Tables | OCR prompt asks for markdown pipe tables | stored text contains `| मद | राशि (रुपये) | … | कुल | 890000 |`; invoice table `Printer 24000 / Total 31250`; answers correct | table question answered from the rendered image | **PASS** | table structure is the VLM's markdown; column widths/merges are not guaranteed |
| Mixed PDF (text page + scan page) | `pdfToText` per-page decision | page 1 taken from the text layer (no OCR call), page 2 OCR'd; text 301 chars with both tokens | — | **PASS** | page-level granularity only; a page with a short text layer (<24 chars) is OCR'd |
| Images (OCR to text) | `imageToText` in `crud.ts` | image uploaded to an agent `context` resource: `llmDeliveryPath=text`, 143 chars Hindi + 129 chars table; **text-only model** then answered `TOKEN-HINDI-401, बजट 445000, Q2 revenue 283000` | image preview + answer rendered (M06 evidence) | **PASS** | OCR text is stored only for `context`/agent uploads; a plain image attachment still goes to the vision model at chat time and stores no text |
| Images (vision answers) | modelSpecs `shavi-vision` (`nvidia/nemotron-3.5-super-vl-120b-a12b`) | answers `TOKEN-TBLIMG-501 / Q2 283000`, `TOKEN-HINDI-401 / 445000` | rendered in chat | **PASS** | hallucination risk on blurry scans is the provider's |
| Database integration | Mongo `files` | 14 records carry `[Page N]` text (scanned/mixed/table PDFs), 6 image records carry OCR text (129–143 chars) | My Files lists them | **PASS** | OCR text counts against the stored-text cap |
| Real API connection | `SHAVI_OCR_BASE_URL` → `https://integrate.api.nvidia.com/v1` | every transcription is an HTTP 200 completion against NVIDIA NIM (key from env, 70 chars, never logged) | — | **PASS** | shares the NVIDIA account quota with chat |
| Error handling | `ocrImageBuffer` throws with status+body snippet; `pdfToText` logs and keeps the text layer | a page that fails OCR keeps its text layer and the upload still succeeds (logged `[pdfToText] OCR failed for page N`) | upload toast on fatal errors | **PASS** | no retry/backoff on 429 |
| Config safety | env only | `grep -r nvapi` in `client/dist`, `librechat.yaml`, repo → no key; start script prints lengths only | — | **PASS** | — |

**Tests run**

```
packages/api      npx jest src/files/documents/crud.spec.ts      21 passed
data-provider     npx jest src/file-config.spec.ts              270 passed  (after updating the spec
                                                                 for the intentional "images are parser types" change)
OCR end-to-end    node tools/librechat-dev/m06-ai-context-test.mjs --dir artifacts/m07-fixtures
                  6/6 fixtures pass (hindi-note, scanned-hindi-en, scanned-mixed, scanned-multipage,
                  scanned-table, table-image)
Image OCR         node tools/librechat-dev/m07-agent-ocr-test.mjs <agent-id>   PASS
Browser           scanned 3-page Hindi PDF uploaded through the UI, question answered with page
                  numbers and the table total (screenshot artifacts/design/m07-scanned-pdf-ocr.png)
```

**Gaps / blockers (honest state of M07)**

1. **OCR engine is a vision-language model, not Tesseract.** Quality is high on clean scans
   (Hindi Devanagari included) but there are no bounding boxes, per-word confidence or layout
   coordinates — only text blocks per page.
2. **Cost/latency:** one completion per scanned page; a 12-page scan is 12 calls. `SHAVI_OCR_MAX_PAGES`
   caps it and pages beyond the cap keep their (empty) text layer.
3. **Plain image attachments are not transcribed.** An image dropped into a normal chat goes to the
   vision model for that turn (verified) but stores no text; only uploading it to an agent's
   `context` resource runs the OCR engine and persists the transcription.
4. **Agent chat needs the model spec:** posting to `/api/agents/chat` with `endpoint: "agents"` is
   rejected with `Model spec mismatch` under `modelSpecs.enforce`; the working shape is
   `endpoint: "SHAVI AI"` + `agent_id`. Reported here because it affects how the UI/agents are driven.
5. **Tables** are re-rendered as markdown by the model; numbers were verified, but merged cells,
   colours and multi-line cells are not preserved.
6. **Handwriting and very low-resolution scans** are untested — no fixture for either.
7. **No OCR for PPTX slide images / embedded pictures inside DOCX** — only PDF pages and image files.

**Reproduce**

```bash
bash tools/setup-librechat.sh                    # clone + config + file-support + OCR patch + builds
node tools/librechat-dev/mongod-server.mjs &
bash tools/start-librechat.sh --bg               # prints SHAVI_OCR_API_KEY: set (70 chars)
python3 tools/make-ocr-fixtures.py               # Hindi/English scanned PDFs, table, mixed, images
node tools/librechat-dev/upload-test.mjs --dir artifacts/m07-fixtures
node tools/librechat-dev/m06-ai-context-test.mjs --dir artifacts/m07-fixtures
node tools/librechat-dev/m07-agent-ocr-test.mjs <agent-id>
```

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
