# PROJECT_STATUS — ShâVì Ai

**Milestone:** M13d — YouTube Studio + Auto Publish. Static studio at
<https://vktechlearn.site/youtube/> (Python tools in-browser via Pyodide, model via the existing Worker);
**M13d** adds one-time channel connect (OAuth in the Worker, token in D1) and a scheduled clip-and-publish
pipeline in GitHub Actions. The Docker/subdomain variant is configured but not deployed.
M12 E2E **22/22**, M11 **39/39**. M12 deployment open items still stand. M05 still unaudited)
**Date:** 2026-11-20
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

## 1h. M08 — Web search and research (real provider, page extraction, citations)

**Audit before this milestone:** the deployment had **no web search at all**. Every provider in
`webSearch` needs a credential — Serper, Tavily, SearXNG (all keyed or blocked), Firecrawl for
scraping — and none was configured, so `web_search` was never offered as a tool. The other
keyless routes were tested and rejected on evidence: DuckDuckGo HTML returned `202` with a bot
check, seven public SearXNG instances answered `429`/captcha, and `api.duckduckgo.com` returns an
empty instant-answer object for real queries. Keenable's public endpoints answer with real
results and real page content, so Keenable is the provider.

**Configuration (tracked, `librechat-deploy/librechat.yaml` → runtime `librechat/librechat.yaml`):**

```yaml
webSearch:
  searchProvider: "keenable"     # https://api.keenable.ai/v1/search/public  (keyless)
  scraperProvider: "keenable"    # https://api.keenable.ai/v1/fetch/public   (keyless)
  rerankerType: "none"
  scraperTimeout: 25000
```

`shavi-nemotron` also carries `webSearch: true`, which seeds the composer's Web Search toggle.

**Research workflow:** the `SHAVI Research` agent (`tools/librechat-dev/create-research-agent.mjs`,
idempotent) runs on `web_search` with instructions that (1) forbid URL-shaped queries, (2) forbid
any fact, link, number or date that is not in the tool output, (3) require citation markers, and
(4) require a `स्रोत:` list of the real URLs used. Its prompt is the guard against fabricated
citations; the tool output is the only source of URLs it may print.

**Evidence (every row a real call, no mocks):**

| Requirement | Implementation | Backend verification | Frontend verification | Test result | Remaining issues |
| --- | --- | --- | --- | --- | --- |
| Real search provider integrated | `librechat.yaml#webSearch`, `tools/librechat-dev/create-research-agent.mjs` | `POST /.v1/search/public` answers 200 with 8 organic results (`librechat.ai/changelog/v0.8.9`, GitHub release, …); the tool call carries `args={"query":"LibreChat v0.8.9 changelog new features"}` | "Searched the web" badge + result chips `LibreChat v0.8.9`, `api.github.com` | **PASS** | keyless public tier: rate limits and bot rules are the provider's; no key configured |
| Search results reach the model | `@librechat/agents` search tool via `createSearchTool` | tool output 36,480 chars with `# Search 0…`, `Anchor:`, `URL:`, `Summary:`, `Date:`, `Source:` per result | result table rendered from the answer | **PASS** | results are the provider's ranking (no reranker) |
| Page extraction | `scraperProvider: keenable` → `/v1/fetch/public` | `Summary:` plus `### Highlight 1..N` blocks contain the page's real markdown (`Chat Projects…`, `Slack with linked accounts…`), 36k chars total for 8 results | highlights feed the rendered table | **PASS** | no JS rendering, no images; pages behind a bot check return `target_blocked` |
| Source citations | citation markers `\ue202turn0searchN` from the tool output | answer carries `turn0search0/1/4`; **all three anchors exist in the tool output**; the two URLs in the answer are byte-equal to tool URLs; both pages answer HTTP 200 | footnote chips + linked sources under the answer | **PASS** | marker rendering is the client's; plain-URL citations depend on the model following instruction 4 |
| No fake citations | agent instructions + anchor whitelist in the test | `no fabricated citation markers`, `no fabricated URLs in answer` both verified by set-difference against the tool output | — | **PASS** | a model that ignores the instructions is caught by the test, not blocked by code |
| Research workflow | `SHAVI Research` agent (tools `["web_search"]`) | `/api/agents` list → detail `tools: ["web_search"]`, instructions stored; turn produced search → answer → sources | agent answers in the normal chat UI with the same citations | **PASS** | one agent; no multi-step "deep research" planner, no sub-question decomposition |
| Database integration | Mongo `messages` | stored assistant message contains the `web_search` tool call with `URL: http…` **and** the `turn0searchN` markers in `content` | conversation reloads from Mongo in the browser | **PASS** | scraped page text is stored inside the message, not in a separate retrievable table |
| Failure behaviour | provider errors surface to the model | observed `422 content_not_extracted`, `404 page_not_found`, `403 target_blocked` for URL-shaped queries; the tool reports them instead of inventing results; with the research-agent instructions those queries no longer occur | — | **PASS (by design)** | the raw spec (`/c/new`, no agent) can still send URL queries and wastes its tool-call budget — see gaps |
| Config safety | yaml only, no secrets | `webSearch` block has no key fields; `/api/config` serves no secrets; `grep -r keenable` in `client/dist` → none | — | **PASS** | — |

**Tests run**

```
packages/api   npx jest src/web/web.spec.ts src/tools/toolkits/web.spec.ts     126 passed
end-to-end     node tools/librechat-dev/m08-web-search-test.mjs                 10/10 checks pass
               (tool executed · keyword query · >=2 real URLs · extraction ·
                citation markers · no fabricated markers · no fabricated URLs ·
                pages reachable · tool output + citations stored in Mongo)
browser        conversation c365ff9d… opened in the Cloud browser: "Searched the web",
               source chips, linked sources, Web Search toggle on the composer
               (screenshot artifacts/design/m08-web-search-citations.png)
```

**Gaps / blockers (honest state of M08)**

1. **Provider is Keenable's keyless public tier.** No key is configured, so the deployment sits on
   the public rate limit and the provider's own bot rules; `KEENABLE_API_KEY` lifts the limit and is
   the single upgrade path (search and fetch both).
2. **URL-shaped queries fail by design.** The provider treats them as fetch targets and answers
   `422/403/404`; the research agent is instructed to send keywords only, but a user chatting on the
   default spec with the Web Search toggle can still trigger this and burn the turn's tool budget.
3. **No reranker.** `rerankerType: none` means the provider's order is used; Cohere/Jina need keys.
4. **No JavaScript rendering.** Pages that build their content client-side extract to little or
   nothing, and pages behind bot checks return `target_blocked`.
5. **Not a deep-research planner.** One search per turn, no sub-question decomposition, no
   cross-checking across sources, no report file; the workflow is search → extract → answer with
   citations.
6. **Only web results were exercised.** News/image/video result types are rendered by the same
   pipeline but were not tested.
7. **Locale:** search quality for Hindi queries was not measured; the tested queries were English
   keywords with Hindi answers.

**Reproduce**

```bash
bash tools/setup-librechat.sh                       # config + patches + builds
bash tools/start-librechat.sh --bg
node tools/librechat-dev/create-research-agent.mjs  # creates/refreshes "SHAVI Research"
node tools/librechat-dev/m08-web-search-test.mjs
```

## 1i. M09 — Voice and image (media gateway: STT, TTS, FLUX images, vision)

**What was built:** a local media gateway (`shavi-media/gateway.mjs`, port 4123; OpenAI-compatible `/v1/audio/transcriptions`, `/v1/audio/speech`, `/v1/images/generations`, `/v1/models`, `/health`) that LibreChat talks to as
its external STT/TTS provider, plus a dedicated image agent that owns the image tool.

| Requirement | Implementation files | Backend verification | Frontend verification | Test result | Remaining issues |
| --- | --- | --- | --- | --- | --- |
| Speech-to-text | `shavi-media/gateway.mjs`, `shavi-media/transcribe.py`, `shavi-media/setup-speech.sh` (local faster-whisper) | `POST /v1/audio/transcriptions` returns a real transcript for a generated WAV | Mic button in the composer is wired to `/api/files/speech/stt` → gateway | `PASS speech-to-text returns a transcript of the spoken words` | Hindi accuracy not measured against a labelled corpus |
| Text-to-speech | `shavi-media/gateway.mjs` (`/v1/audio/speech`) | real RIFF/WAV bytes, not a stub | LibreChat advertises the external TTS + voice list under Settings → Speech | `PASS text-to-speech returns real audio bytes`, `PASS configured TTS voices are listed`, `PASS LibreChat advertises external STT and TTS` | no streaming/VAD tuning |
| Image generation | image agent (`tools/librechat-dev/create-image-agent.mjs`) + NVIDIA FLUX through the `SHAVI AI` endpoint | `PASS image generated by FLUX (real JPEG bytes)`; file stored and served by the app | `artifacts/design/m09-generated-image.jpg` (generated in the UI) | `PASS image tool exists only on the image agent`, `PASS generated image stored and served by the app` | one model, no style presets |
| Image understanding (vision) | `shavi-vision` spec → `nvidia/nemotron-3.5-super-vl-120b-a12b` | reads a token rendered into a PNG | vision model selectable in the model picker | `PASS image understanding reads the token from the image` | none found |
| Fail-closed behaviour | `librechat.yaml` speech/image config | unconfigured provider is hidden from the picker **and** refused server-side | picker shows only configured providers | `PASS unconfigured image provider is hidden and refused`, `PASS gateway reports all three capabilities configured` | — |

**M09 result: 11/11 checks passed** in the 2026-11-18 run of `tools/librechat-dev/m09-media-test.mjs`
(the `/tmp` log did not survive the runner restart; the checks above are the ones that run printed).

---

## 1j. M10 — Memory and Agents (memory, projects, custom instructions, tool calling, file search, code interpreter)

**New services (tracked in this repo, restartable):**

| Service | File | Port | Notes |
| --- | --- | --- | --- |
| Retrieval (LibreChat-compatible RAG) | `shavi-rag/service.mjs` | 4125 | `/health`, `/text`, `/embed`, `/query`, `/documents` (DELETE), `/ids`; verifies the HS256 `JWT_SECRET` token and scopes every vector by `user_id`; per-user JSON vector store under `shavi-rag/runtime/vectors` |
| Code API | `shavi-code/service.mjs` + `shavi-code/sandbox.sh` | 4126 | `/exec`, `/download/:session/:file`, `/files/...`, `DELETE`, `/health` |

**Embeddings:** local `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (transformers.js, q8, 384-dim).
Reason: the hosted NVIDIA embedding model (`nvidia/nemotron-3.5-embed-1b`) needs `input_type` and timed out
(504 after 120 s) on this network, so a local model keeps file search working offline. `SHAVI_RAG_EMBED_PROVIDER=nvidia`
switches to the hosted path when it is reachable.

### Evidence table

| Requirement | Implementation files | Backend verification | Frontend verification | Test result | Remaining issues |
| --- | --- | --- | --- | --- | --- |
| **User-controlled memory** | `librechat-deploy/librechat.yaml` (`memory:` + `personalization.memories`), LibreChat `api/server` memory routes, Mongo `memoryentries` | `POST /api/memories` → 201, `GET /api/memories` lists it, `PATCH /api/memories/:key` updates, `DELETE` removes; document read straight out of `memoryentries`; a later chat **without** the memory in the prompt still answers from it; `PATCH /api/memories/preferences {memories:false}` stops the injection | Memories panel (screenshot `artifacts/design/m10-memories.png`): entry created by a real tool call is listed, Edit/Delete buttons, "Use memory" toggle | `PASS memory create/list/update reaches the API and Mongo`, `PASS saved memory reaches the model in a later chat`, `PASS memory opt-out stops injection`, `PASS memory delete removes the record` | memory is injected as instructions, not as a separate retrievable store |
| **Projects** | `chatprojects` collection, LibreChat project routes (`/api/projects…`), client `Projects` sidebar + `ProjectResources` | `POST /api/projects` → 201 with instructions in Mongo; `PUT /api/projects/conversations/:id` assigns; `POST /api/projects/:id/files` stores `file_ids`; `GET /api/projects/:id/files` lists the file with `availability: ready` | sidebar shows the projects and their chats (screenshot `artifacts/design/m10-projects.png`); project chat carries the instructions | `PASS project create stores its instructions in Mongo`, `PASS an existing conversation can be assigned to a project`, `PASS project instructions steer the model inside the project conversation` (reply ends with the required `PROJECT-CODEX-91`), `PASS project files can be attached and are listed` | project instructions only apply when the chat is sent with `chatProjectId` (that is what the UI does) |
| **Custom instructions — per request** | `promptPrefix` on `POST /api/agents/chat`, read in `packages/api/src/agents/load.ts` | the streamed reply ends with the exact token asked for in `promptPrefix` | the composer's custom-instruction field posts `promptPrefix` on every turn | `PASS per-request custom instructions are applied` | not stored on the conversation document in v0.8.9, so the client must resend it each turn |
| **Custom instructions — saved on an agent** | `PATCH /api/agents/:id`, `agents.instructions` in Mongo | PATCH → 200, Mongo shows the new text, restoring the original works | Agent Builder edits the same field | `PASS agent custom instructions are stored and restorable` | **limitation:** with `modelSpecs.enforce: true` the saved `instructions` (and `model_parameters.promptPrefix`) are persisted but never reach the model; only the per-request `promptPrefix` does. Reproduced three times, printed by the test as a `LIMITATION` line, not counted as a pass |
| **Tool calling** | `agent_shavi_workspace` (`tools: file_search, execute_code, web_search, memory`), `tools/librechat-dev/create-workspace-agent.mjs` + `pin-agent-ids.mjs`, Mongo `agents`/`messages` | the agent document carries the four tools; `messages` rows hold `content.tool_call.name` for both `file_search` and `execute_code` | screenshot `artifacts/design/m10-workspace-tools.png`: "Ran Code" tool card, `result.csv` spreadsheet artifact, correct `319,754` answer | `PASS workspace agent carries file_search, execute_code and memory`, `PASS tool calls are persisted in Mongo` | model picks `execute_code` or `bash_tool` depending on the turn; both are routed |
| **File search** | `shavi-rag/service.mjs`, `RAG_API_URL` wiring in `tools/start-librechat.sh` + `/api/files` upload path, agent `tool_resources.file_search` | upload → `embedded` file; `/query` returns page-scoped passages; a token that exists only in the uploaded file comes back in the answer; a second user's token is **not** returned | upload + attach in the composer, answer names the file and page | `PASS file_search upload is indexed for the agent`, `PASS file_search runs a real retrieval and the answer uses the file's fact`, `PASS file search is scoped to the owner` | non-plain-text files (PDF/DOCX/images) are parsed by LibreChat's own M06/M07 pipeline and then indexed, so OCR quality still bounds those answers |
| **Secure code interpreter** | `shavi-code/service.mjs`, `shavi-code/sandbox.sh` | `unshare -r -m -n -p -f --mount-proc` + minimal chroot + tmpfs `/tmp`, `/dev/shm` + `prlimit` (512 MB, 25 s CPU, 96 procs, 64 MB file) + 30 s timeout + `env -i`; probes: `MARKER-9f31 319754`, `HOST_FS_BLOCKED`, `NETWORK_BLOCKED`, `SECRET_ENV []` | same screenshot: artifact rendered as CSV preview and downloadable | `PASS sandbox computes real output`, `PASS sandbox blocks the host filesystem`, `PASS sandbox blocks network egress`, `PASS sandbox inherits no secrets`, `PASS sandbox artifact is downloadable byte-for-byte`, `PASS code interpreter runs the model's code and returns its stdout`, `PASS code artifacts are delivered and downloadable` | isolation is process/namespace level, not a VM: Docker is unavailable here (`permission denied …/docker.sock`, `sudo: no new privileges`), so a kernel-level escape is out of scope of this guarantee |

**M10 result: 24/24 checks passed** (`tools/librechat-dev/m10-memory-agents-test.mjs`), plus one printed
`LIMITATION` (saved agent instructions not delivered on enforced model specs).

### M10 test log (abridged)

```
PASS retrieval service is up and reports its embedding model
PASS code service is up with the sandbox profile
PASS sandbox computes real output / blocks host FS / blocks network / no secrets / artifact byte-for-byte
PASS workspace agent carries file_search, execute_code and memory
PASS memory create/list/update reaches the API and Mongo
PASS saved memory reaches the model in a later chat
PASS memory opt-out stops injection
PASS memory delete removes the record
PASS project create stores its instructions in Mongo
PASS an existing conversation can be assigned to a project
PASS project instructions steer the model inside the project conversation
PASS project files can be attached and are listed
PASS per-request custom instructions are applied
PASS agent custom instructions are stored and restorable
PASS file_search upload is indexed for the agent
PASS file_search runs a real retrieval and the answer uses the file's fact
PASS file search is scoped to the owner
PASS code interpreter runs the model's code and returns its stdout
PASS code artifacts are delivered and downloadable
PASS tool calls are persisted in Mongo
LIMITATION Saved agent instructions are stored in Mongo but not delivered to the model on enforced
           model-spec chats (v0.8.9); per-request promptPrefix is the effective channel.
PASS 24/24 checks
```

### M10 — open items (not hidden, not fixed)

1. Saved agent `instructions` are inert on enforced model specs (above). The workspace agent's tool rules
   therefore rely on the tool schemas and the per-request prompt, not on its saved instructions.
2. Embeddings are local and small (384-dim multilingual MiniLM) — good for Hindi/English Q&A, weaker than a
   hosted embedding model on long technical documents.
3. The code sandbox is namespace/chroot level, not VM level (Docker unavailable in this environment).
4. Per-conversation `promptPrefix` is not part of the v0.8.9 conversation schema; the client resends it.
5. M05 (accounts/roles/admin) is still unaudited.

---

## 1k. M11 — Admin & Security (admin panel, usage, cost, permissions, rate limits, audit, privacy)

**What already existed:** LibreChat v0.8.9 ships a hardened admin *API* (`/api/admin/{users,roles,grants,groups,audit-log,config}`),
capability-based RBAC, a hash-chained audit log and the rate-limit middleware — but **no admin UI** (its
`ADMIN_PANEL_URL` points at a separate product) and **no usage/cost view**. Winners this milestone are those two
missing pieces plus the wiring that makes the existing security controls actually enforce.

**New services / files (this repo):**

| File | Role | Port |
| --- | --- | --- |
| `shavi-admin/service.mjs` | admin panel gateway: static panel + `/api/panel/*` (auth, users, roles, audit, limits, usage, cost, privacy). Authorises every admin call through LibreChat's own `access:admin` capability — no second RBAC implementation. | 4127 |
| `shavi-admin/public/{index.html,app.js,style.css,favicon.svg}` | admin UI: Overview, Usage, Cost, Users, Permissions, Rate limits, Audit log, Privacy | — |
| `shavi-admin/pricing.json` | declared price table (per 1M tokens) used for the cost estimate; agent turns are priced against the agent's underlying model (`agents.model`) | — |
| `tools/start-shavi-admin.sh` | starts the gateway with the **same** `MESSAGE_*`/`LOGIN_*` variables the backend runs with, so the panel reports the enforced values | — |
| `tools/start-librechat.sh` | **changed:** exports `LIMIT_MESSAGE_USER/IP=true` + `MESSAGE_*` defaults. LibreChat leaves message limiting **off** unless these are set, so before this change a single account could send unlimited chat requests | — |
| `tools/librechat-dev/m11-admin-security-test.mjs` | 39 end-to-end checks (below) | — |

### Requirement table (evidence, not appearance)

| Requirement | Implementation files | Backend verification | Frontend verification | Test result | Remaining issues |
| --- | --- | --- | --- | --- | --- |
| **Admin Panel** | `shavi-admin/service.mjs`, `shavi-admin/public/*`; data from `/api/admin/*` proxies | `GET /api/panel/me` → 200 for ADMIN (25 capabilities incl. `access:admin`), **403** for a plain account, **401** anonymous; `/api/panel/overview|users|roles|limits|audit` all 200 | Panel is served (`GET /` → 200, HTML + `app.js` load); every tab calls the endpoints above. **Not clicked through in a browser this run** — see open item 4 | **PASS (API + asset serving)** | Panel is a separate origin/port (4127); it is not yet behind the site's reverse proxy — see open item 3 |
| **Usage tracking** | `service.mjs` aggregations over Mongo `messages.tokenCount` / `conversations` / `users` | Panel totals **equal** a direct Mongo aggregation: `266/133/133/512,907` (messages/user/assistant/tokens) in both; `byDay`, `byModel`, `byUser` returned | Overview KPIs + per-day bar chart + model table; Usage tab switches day/model/user | **PASS** | Windows are token-total only (LibreChat stores one `tokenCount`, no prompt/completion split) |
| **Cost tracking** | `shavi-admin/pricing.json` + `service.mjs` (`priceFor`/`costOf`, agent→model resolution) | Panel total `$0.7345` == recomputed `tokens × price` `$0.7345` (tolerance 1e-4); payload labelled `estimate: true`, `currency: USD`, unpriced tokens reported (0 after agent mapping + `meta/llama-3.2-90b-vision` price) | Cost tab: total, priced-model count, unpriced tokens, per-model table with blended $/1M | **PASS** | Prices are list prices, not provider invoices; the table must be kept current by hand |
| **User Permissions** | LibreChat roles/capabilities (`/api/admin/roles`, `/api/roles/:name/:group`, `systemgrants`), panel Permissions tab, `shavi-admin/service.mjs` proxy | Plain account: panel 403, `GET /api/admin/users` **403**, role write **403**; ADMIN: `access:admin` + 25 capabilities; `PUT /api/roles/USER/prompts {SHARE_PUBLIC:true}` → 200 and the role document **changes** (`PROMPTS.SHARE_PUBLIC` flips, then restored) | Roles table lists each role with its capability groups; toggle writes through the documented per-group route | **PASS** | No UI to create roles or assign members yet (API supports it) |
| **Rate Limits** | LibreChat limiters (`messageLimiters`, `loginLimiter`, `registerLimiter`, `toolCallLimiter`) + `tools/start-librechat.sh` enabling them; panel Rate-limits tab | **Login limiter denies with HTTP 429** `{"message":"Too many login attempts, please try again after 5 minutes."}`; chat IP limiter denies with an SSE `{"type":"message_limit","max":"2","limiter":"ip"}` frame at `MESSAGE_IP_MAX=2`; headers show `X-RateLimit-Limit/Remaining` decrementing | Rate-limits tab shows configured budgets and the limiter source | **PASS (re-verified in M12)** | The M11 "never denies" result was a **test bug**, not a product bug: the denial is streamed as HTTP 200 with an SSE `error` frame whose JSON is escaped (`{\"type\":\"message_limit\",\"limiter\":\"user\"}`), so a raw-substring predicate never matched it. With the predicate fixed, 5 concurrent turns at `MESSAGE_USER_MAX=3` produce **3 denials** (M11 and M12 suites), login still returns 429, and `X-RateLimit-*` headers decrement.
| **Audit Logs** | LibreChat hash-chained audit log (`auditlogs`, `api/server/routes/admin/audit.js`), panel Audit tab + `service.mjs` proxies | Every read is itself audited (`audit.read`); a role change emits `role.permissions_updated`; entries count grew 20 → 27 during the run; `GET /api/panel/audit/verify` → `{ok:true, checked:…, range:{firstSeq:1,lastSeq:…}}`; CSV export returns rows | Audit tab: table (time/category/action/actor/target/outcome/seq), **Verify hash chain** button, CSV download | **PASS** | Append-only store; retention/purge policy not defined |
| **Data Privacy** | `shavi-admin/service.mjs` (`exportUserData`), LibreChat `DELETE /api/user/delete` cascade; panel Privacy tab | Export is generated from Mongo for the **caller only** (admin export returned the admin account, not the other user); counts matched the DB; no password hash / `totpSecret` in the export or in `/api/panel/me`; delete → 200, user row gone, owned conversations gone, re-login fails | Privacy tab: “Download my data (JSON)” + “Delete my account” (confirm dialog) | **PASS** | Export includes conversations/messages/memories/files-metadata/projects/shared links; RAG vectors and uploads on disk are removed by LibreChat's own file cleanup (not re-verified here) |

### M11 test log (`workflow: tools/librechat-dev/m11-admin-security-test.mjs`, live stack)

```
PASS LibreChat API is up
PASS admin panel service is up with Mongo access
PASS admin panel UI is served
PASS admin can sign in through the panel login route / panel login route returns a JWT
PASS admin account reports its effective capabilities (25, incl. access:admin)
PASS panel never returns the password hash
PASS a second, non-admin account can be created / can sign in
PASS plain user is refused the admin panel API (403) / cannot read usage-cost / cannot read /api/admin/users / cannot change role permissions
PASS anonymous caller is refused (401)
PASS admin sees the usage overview / can list users / can list roles / rate-limit configuration is reported
PASS usage totals equal the MongoDB aggregation
PASS cost equals tokens × the declared price table / cost is labelled as an estimate
FAIL chat rate limit denies the turn once the per-user budget is spent   (no denial frame)
FAIL the denial names the per-user limiter, not just the IP one          (0 user-limit denials of 5 turns)
PASS turns inside the budget are not denied
PASS panel reports the limiter that actually fired
PASS admin can change a role permission / the change is persisted in the role document
PASS the admin action produced a new audit entry / audit hash chain verifies / audit log exports as CSV
PASS account export is generated from the database / counts match the database / strips secrets / is scoped to the caller
PASS account deletion runs through the API / cascades: user row and owned conversations are gone / deleted account cannot sign in
PASS prompt text is not written to the service logs
PASS no provider key is present in the panel responses

37/39 checks passed
```

### M11 — open items (not hidden, not fixed)

1. ~~**Per-user chat limiter does not deny.**~~ **Resolved in M12 — it was the test, not the limiter.** The denial
   frame exists but is JSON-escaped inside the SSE payload (`{\"type\":\"message_limit\",\"limiter\":\"user\"}`), so
   the old predicate (`text.includes('"type":"message_limit"')`) never matched. `m11-admin-security-test.mjs` now
   matches `message_limit` / `limiter\"user` and reports 3 denials out of 5 concurrent turns at
   `MESSAGE_USER_MAX=3`; `m12-e2e-test.mjs` asserts the same behaviour independently.
2. Message-limit denials are streamed as HTTP 200 + `event: error` (SSE), not HTTP 429 — the panel and docs must say
   so, otherwise a monitor watching status codes will miss abuse.
3. The admin panel runs on its own port (4127) and is not yet exposed through the site's reverse proxy or protected
   beyond the LibreChat login + `access:admin` capability. Before production it needs a host/route decision
   (e.g. `admin.vktechlearn.site`) and `ADMIN_PANEL_URL` set so LibreChat's Settings → Admin panel link points to it.
4. The panel UI was verified by asset serving + every endpoint it calls, **not** by clicking through it in a browser;
   a screenshot run is still owed.
5. Rate-limit counters are in-memory per backend process (`USE_REDIS` is off): a restart resets them and multiple
   replicas would each keep their own window.

---

## 1l. M12 — Final QA & Deployment (end-to-end test, bugs fixed, build, Docker, HTTPS, backup/recovery)

No feature was added in this milestone. The only product code changed is two **bug fixes** found by the new tests
(privacy-export ownership filter, deployment parity for the branded API image); everything else is verification,
test harness and deployment configuration.

**Files added / changed this milestone**

| File | Purpose |
| --- | --- |
| `tools/librechat-dev/m12-e2e-test.mjs` | 22-check end-to-end suite on the live stack (build serving → auth → real chat → persistence → memory → admin → rate limit → privacy → backup/restore → log hygiene) |
| `tools/backup-mongo.mjs` | JSONL dump of every collection + `uploads/` into `backups/backup-<ts>/` with a manifest (`mongo`, counts, file list) |
| `tools/restore-mongo.mjs` | restores a dump into any target URI (`--db`), optional `--drop`, optional `--uploads`, then runs a per-collection count comparison (`RECOVERY CHECK OK`) |
| `librechat-deploy/docker-compose.yml` | production stack: api (built from the local tree), admin (M11), mongodb + healthcheck, caddy, scheduled mongodump + retention, meilisearch, vectordb, rag_api |
| `librechat-deploy/Caddyfile` | HTTPS for both hostnames, HSTS/nosniff/Referrer-Policy, `flush_interval -1` so chat SSE is not buffered |
| `librechat-deploy/.env.example` | every variable the stack needs, including `SHAVI_DOMAIN`, `SHAVI_ADMIN_DOMAIN`, `ACME_EMAIL`, `ADMIN_PANEL_URL`, `LIMIT_MESSAGE_*`, `BACKUP_*` |
| `shavi-admin/Dockerfile` | unprivileged `node:22-alpine` image for the panel/gateway with a healthcheck |
| `shavi-admin/service.mjs` | **bug fix:** `exportUserData` now scopes by both the hex string and the ObjectId form of the user id |
| `tools/librechat-dev/m11-admin-security-test.mjs` | **test fix:** SSE denial predicate + string-typed ownership counts |
| `.gitignore` | `backups/`, `librechat-deploy/.env` |

### Requirement table (evidence, not appearance)

| Requirement | Implementation files | Backend verification | Frontend verification | Test result | Remaining issues |
| --- | --- | --- | --- | --- | --- |
| **End-to-end application test** | `tools/librechat-dev/m12-e2e-test.mjs` | 22/22 checks on the live stack: register → login JWT → `POST /api/agents/chat` → **model actually answered** (`M12QACHK1795100895953`) → conversation + assistant message in Mongo with `tokenCount=14` → history API lists it → memory create/list/delete → panel `overview` 200 for admin / 403 for user → audit chain `{ok:true, checked:34}` → rate-limit denials → privacy export + delete cascade → backup + restore → no prompt text in logs | SPA shell and hashed JS/CSS are the files the browser loads (`/` 200, `/assets/index.BWdvrzJr.js` 200, css 200, `sw.js` 200); panel `/` 200 + `/app.js` 200. **No interactive click-through in a browser** (open item 3) | **PASS** | Flow coverage is API-level; DOCX/OCR/voice/image paths were verified in their own milestones and were not re-run here |
| **Bugs fixed** | `shavi-admin/service.mjs` (export), `tools/librechat-dev/m11-*.mjs` (test predicate) | Privacy export previously returned **0** conversations/messages for an account that owned 3/4 rows, because `conversations.user` / `messages.user` / `memoryentries.userId` are stored as the hex **string** while the gateway filtered by `ObjectId`. Query is now `{$in:[String(id), ObjectId(id)]}`; export counts equal a direct Mongo count (`3/4 vs 3/4`, `m12` and `m11` suites both assert it). The M11 "rate limit never denies" finding was traced to the escaped SSE frame and corrected in the test | — | **PASS (both fixed and re-verified)** | No other functional defect surfaced in this pass |
| **Production build** | `librechat/client` (Vite), `librechat/client/dist/*` | `NODE_OPTIONS=--max-old-space-size=6144 npx vite build` → “✓ built in 10.85s”; the running API serves that build: `GET /` 200 `28,026 b` HTML, `index.BWdvrzJr.js` 200 `617,116 b`, css 200 `298,503 b`, `sw.js` 200; bundle scanned — **no provider key** (`nvapi-`) present | Built `index.html` references the served hashed asset names (same names in `dist/` and in the HTTP response) | **PASS** | Build is a client build only; type/lint gate not re-run (no source change in this milestone) |
| **Docker deployment** | `librechat-deploy/docker-compose.yml`, `shavi-admin/Dockerfile`, `librechat/Dockerfile`, `librechat-deploy/.env.example` | `docker compose config -q` → **exit 0** with 8 services (`api, admin, caddy, mongodb, backup, meilisearch, vectordb, rag_api`); `api` now **builds from `../librechat`** instead of the stock registry image, because the SHAVI branding (`client/src/components/BrandMark.tsx`, `logo.svg`, `shavi-mark.svg`) exists only in the local tree and the Dockerfile runs `npm run frontend`; the panel image has a lockfile for `npm ci --omit=dev`; mongodb has a ping healthcheck; `backup` runs `mongodump --gzip` on `BACKUP_INTERVAL_HOURS` with `BACKUP_KEEP_DAYS` retention | Not applicable (server-side stack) | **PARTIAL — configuration verified, containers not started** | No Docker daemon in this VM (`docker info` → exit 1, socket is root-only), so `up -d --build` could not be executed. The same stack was verified natively (Mongo 8, LibreChat, panel, Caddy) — open item 1 |
| **HTTPS** | `librechat-deploy/Caddyfile`, compose `caddy` service (ports 80/443/tcp+udp, `caddy_data`/`caddy_config` volumes) | `caddy validate --config Caddyfile` (v2.10.0) → **“Valid configuration”**, automatic HTTP→HTTPS redirects enabled; live TLS run with the same directives (self-signed cert for the test, `flush_interval -1`): app over HTTPS → **HTTP/2 200** with `strict-transport-security` + `x-content-type-options: nosniff`; panel over HTTPS → **200** `{"status":"ok","mongo":true,…}` with `X-Frame-Options: DENY` | Both hostnames are served through the same reverse proxy the browser would hit | **PASS for TLS termination/proxy; ACME issuance not exercised** | Let's Encrypt needs public DNS + ports 80/443; the VM has neither (port 80 bind is refused), so certificate issuance/renewal is configuration-only here (open item 2) |
| **Backup** | `tools/backup-mongo.mjs`, compose `backup` service | Live dump: **77 collections, 993 documents, 90 upload files**, manifest written with the source URI and per-collection counts; re-runnable, timestamped directory | — | **PASS** | The containerized `mongodump` loop is configuration-only (no daemon); the Node dump is what was actually executed |
| **Recovery** | `tools/restore-mongo.mjs` | Restore of that dump into a **separate database** (`LibreChatRecoveryCheck`) → every collection count matched → `RECOVERY CHECK OK — 77 collections, 993 documents restored`; original `LibreChat` database untouched | — | **PASS** | Restore was verified into a scratch DB; a restore **over** production (with `--drop`) was not executed on purpose. Uploads are only restored with `--uploads` |
| **Log/privacy hygiene** | LibreChat loggers, panel logger | Both service logs scanned: the chat token never appears (prompt text is not logged); panel responses carry no provider key | — | **PASS** | — |

### M12 test log (`tools/librechat-dev/m12-e2e-test.mjs`, live stack)

```
PASS API health endpoint answers — GET /health -> 200
PASS production bundle is served (SPA shell + hashed JS asset) — /assets/index.BWdvrzJr.js -> 200
PASS built bundle carries no provider key — index.html scanned
PASS admin panel service is up — mongo=true
PASS registration creates an account — register -> 200
PASS login issues a JWT — login -> 200
PASS admin login issues a JWT — admin@shavi.local
PASS chat request is accepted and starts a generation — conversation 3efe93b6-…
PASS the model answers through the real provider — reply: M12QACHK1795100895953
PASS conversation and messages are persisted in MongoDB — 1 assistant message(s)
PASS token usage is recorded for the model call — tokenCount=14
PASS conversation appears in the history API — 1 conversation(s)
PASS memory create/list works through the real API — 1 memories
PASS memory delete works — 200
PASS admin panel data is admin-only — admin 200, user 403
PASS audit hash chain verifies — {ok:true, checked:34, range:{firstSeq:1,…}}
PASS per-user message rate limit denies a burst — 3/5 denied
PASS data export matches the database rows for this account — export 3/4 vs mongo 3/4
PASS account deletion cascades (user + messages removed) — user=gone, messages=0
PASS MongoDB backup completes — 77 collections, 993 documents, uploads 90 files | RECOVERY CHECK OK
PASS backup restores into a clean database and counts match — 993 documents restored
PASS prompt text never reaches the service logs — both logs scanned

22/22 checks passed
```

M11 suite re-run on the same stack after the predicate fix: **39/39 checks passed** (was 37/39).

```
$ docker compose -f librechat-deploy/docker-compose.yml config -q        # exit 0
$ caddy validate --config librechat-deploy/Caddyfile --adapter caddyfile # Valid configuration
$ curl -sk https://127.0.0.1:8443/health   # HTTP/2 200, hsts + nosniff, app behind caddy
$ curl -sk https://127.0.0.1:9443/health   # 200 {"status":"ok","mongo":true,…}
$ node tools/backup-mongo.mjs  → 77 collections, 993 documents, 90 uploads
$ node tools/restore-mongo.mjs <dir> --db …/LibreChatRecoveryCheck → RECOVERY CHECK OK
```

### M12 — open items (not hidden, not fixed)

1. **Containers were not started.** The Docker socket is root-only in this VM (`docker info` → exit 1), so the stack
   was verified as configuration (`compose config`), by component parity with the native stack, and by running the
   real Caddy binary. On a Docker host the gate is `docker compose up -d --build` + `docker compose ps` healthy.
2. **ACME/Let's Encrypt was not exercised** — needs public DNS for both hostnames and ports 80/443. Until then HTTPS
   is proven only up to TLS termination + header/streaming behaviour with a self-signed certificate.
3. **No interactive browser click-through** of the built SPA or the panel in this milestone; verification was HTTP +
   API level. A screenshot/UX pass is still owed and is the only unverified layer.
4. **Rate-limit counters are per process** (`USE_REDIS` off): restarting the API resets windows and multiple replicas
   would not share them — set `USE_REDIS=true` + a Redis service before scaling out.
5. **Deployment needs the patched LibreChat tree on the host** (the API image builds from `../librechat`); the vendor
   directory is gitignored, so a fresh clone must clone LibreChat v0.8.9 and re-apply the branding step (M03) before
   `compose build`.
6. **Panel origin** still needs a real hostname in `ADMIN_PANEL_URL`/`SHAVI_ADMIN_DOMAIN` (Caddy route is ready,
   DNS is not).

---

## 1m. M13 — YouTube Studio (the Jakeschincariol/youtube-agent-skill pack, running here)

Request: take <https://github.com/Jakeschincariol/youtube-agent-skill> (MIT, eleven Claude skills + six
dependency-free Python tools) and make it usable on this site for day-to-day YouTube work. The pack is
vendored unchanged; what was built around it is the surface that makes it run on *this* stack, because a
Claude skill folder assumes a filesystem agent with bash and there is no such agent inside the web app.

| Requirement | Implementation files | Backend verification | Frontend verification | Test result | Remaining issues |
| --- | --- | --- | --- | --- | --- |
| **The eleven skills** | `shavi-youtube/skills/yt-{script,package,edit,comment,plan,viral,retention,shorts,seo,chapters,audit}/SKILL.md` (vendored byte-for-byte, `LICENSE` + `UPSTREAM-README.md` kept) | `GET /api/skills` returns all 11 with parsed `name`/`description` and body; frontmatter `description: >-` folding parsed correctly | Sidebar lists all eleven by command name, description clipped to two lines | **PASS** | Skills are prompts, not agents: they cannot browse or publish, and the pack says so itself |
| **The six Python tools** | `skills/yt-*/{hookscore,title,deadair,chapters,retention,swipe}.py`, executed by `service.mjs` (`spawnSync('python3', …)`, 60 s timeout, temp input file, `--json`) | All six executed on real sample input: hook panel (`SPECIFICITY/ADDRESS/STAKES/CURIOSITY/BREVITY` + verdict 41 “WEAK”), title pairing (`score 76`, `no-number`, `duplicate`), EDL (filler `um`, 3.5 s dead gap, repeated take), chapters (`valid:true`, 5 chapters from 98 s), retention (`hook_leak 48`, cliffs, `slide_per_unit 0.053`), swipe (`multiple 16`, channel median computed) | Each tool skill shows “Tool चलाओ”; result JSON rendered in the output pane and passed into the model prompt | **PASS (6/6 tools, 32–48 ms each)** | Retention needs Studio's CSV export; chapters/EDL need a timestamped transcript (SRT/VTT/JSON) |
| **Real model, not a mock** | `service.mjs` `askSkill()` → `POST https://integrate.api.nvidia.com/v1/chat/completions`, model `nvidia/nemotron-3-ultra-550b-a55b`, key from `SHAVI_AI_KEY`/`ai-key.txt` (never logged) | `POST /api/run` for `yt-package` → **HTTP 200, 1,528 tokens**, answer followed the skill: refused to invent a voice because `voice.md` is still the template, asked for three videos, listed the exact next steps | “SHAVI AI से बनवाओ” streams the answer into the pane with elapsed time, model and token count | **PASS** | 30–90 s per answer (Nemotron); one request at a time in this UI |
| **voice.md** | `shavi-youtube/voice.md` (template copied from `templates/voice.md`), `GET/PUT /api/voice`, editor dialog | `PUT /api/voice` writes the file; every `/api/run` re-reads it and injects it as the voice profile | “मेरी आवाज़ (voice.md)” opens the editor, saves, confirms | **PASS** | Still the unfilled template — the first thing to do is paste three of your own transcripts there |
| **Usable from the site** | `tools/start-shavi-youtube.sh`, `shavi-youtube/Dockerfile`, compose service `youtube`, Caddy block `{$SHAVI_YOUTUBE_DOMAIN}` with **basic auth** (the studio spends credits) | `docker compose config -q` → exit 0 with **9 services**; `caddy validate` → “Valid configuration” for all three hostnames | Page served on port 3000 for the preview; `GET /` 200 (8,872 b), `app.js` 200, `style.css` 200, `/health` `{skills:11,key:true,python:"Python 3.12.3"}` | **PASS (config + local run)** | Public hostname/DNS not set; containers not started (no Docker daemon, same as M12) |
| **Not published by the pack** | — | Nothing in the pack or in `service.mjs` uploads to YouTube; the six tools only read pasted text | Output ends in the pack's own “ship it, or change it?” block | **PASS** | Publishing still means uploading yourself — that is deliberate in the upstream pack |

**How it is used:** `bash tools/start-shavi-youtube.sh` → open the studio → pick a command → paste the idea,
transcript or CSV → *Tool चलाओ* (numbers from the pack's own scripts) → *SHAVI AI से बनवाओ*. Fill `voice.md`
once and every skill writes in your voice. In Docker the same thing is `SHAVI_YOUTUBE_DOMAIN` + the basic-auth
user/hash in `.env`, then `docker compose up -d --build`.

**M13 open items**

1. The studio is not behind LibreChat's login — it is a separate service protected by Caddy basic auth on its own
   hostname. If you would rather have it inside the app's sidebar, that is a LibreChat client change, not a
   config one; say so and it becomes its own milestone.
2. Hostname + DNS + ACME still outstanding (same blocker as M12 item 2).
3. `voice.md` is unedited template text, so skills correctly refuse to write “in your voice” until you fill it.
4. No conversation history: each answer replaces the previous one in the pane. The skill output is copy-paste
   material, not a saved project.

### M13b — same pack, live on the site (`https://vktechlearn.site/youtube/`)

GitHub Pages cannot run the Node service from §1m, so the pack was re-shipped as a **static page**
that needs no server of ours:

| Piece | How it works now | Evidence |
| --- | --- | --- |
| Six Python tools | run **unmodified** in the visitor's browser via Pyodide 0.26.4 (CDN); scripts are fetched from `youtube/skills/*.py` and executed with `runpy`, `sys.argv`, real cwd — including `chapters.py`/`retention.py` importing `deadair` | hookscore (verdict 41 “WEAK”), title (`score 76`), deadair (EDL with cuts), chapters (`valid:true`) and retention (`hook_leak 48`), swipe (`multiple 16`) all executed on the **live** page in a browser |
| Eleven skills | `SKILL.md` fetched per skill, frontmatter parsed for the sidebar, body injected into the prompt | sidebar shows all 11 with their descriptions |
| Model | the **existing** `ai-worker` (`/api/chat`, same backend as `/shavi-ai/`), already CORS-allowed for `vktechlearn.site` | live run streamed a real answer from the production origin (`# YouTube Packaging — 3 Free AI Tools…`); worker’s 30 questions/hour limit applies |
| voice.md | `localStorage` (per browser, no account) | "मेरी आवाज़" dialog loads the template, saves locally |
| Entry point | homepage nav → Tools → **YouTube Studio** (`index.html`) | `curl https://vktechlearn.site/` shows `href="/youtube/"`, and `GET /youtube/` → 200 with `app.js`, `SKILL.md`, `hookscore.py` all 200 |

Pushed to `main`; GitHub Actions deployed it (404 → 200 on the second poll). Nothing on the existing site
changed apart from one nav item. The Node studio from §1m still exists for the Docker path (basic auth,
`youtube.<domain>`), but the site now has a working copy without any deployment at all.

**M13b limitations:** first tool run downloads the Pyodide runtime (~10 MB, CDN); answers are capped by the
Worker's 30/hour per-IP limit; `voice.md` is per browser, not an account; the page is public (the pack writes
nothing and publishes nothing, so the only cost surface is the Worker, which is already public).

---

### M13c — Auto Pilot: एक channel link, पूरा package (live)

Request: “ऐसा tool बने जो 11 agents खुद use करे, मेरे channel का data लेकर सब feed करके रखे, मैं सिर्फ़ post करूँ”.

| टुकड़ा | कैसे काम करता है | सबूत |
| --- | --- | --- |
| Channel data | नया Worker endpoint `GET /api/yt/channel?u=…` — `@handle`/link/`UC…` resolve करता है (चैनल पेज का `externalId`), फिर public RSS पढ़ता है; नतीजे: 15 हाल के videos, views, median, upload cadence, आख़िरी upload; 15 मिनट cache | live: `@MrBeast` → 15 videos, median 101,324,771, gap 5.9 दिन; `mkbhd` → “Marques Brownlee”, median 9,232,071, gap 3.8 दिन |
| Pipeline | Auto Pilot पर एक click → audit → (topic) → 5 hooks → hookscore.py → 10 titles → title.py → script → SEO → Shorts → 7-दिन plan; हर step क्रम से, बीच में tool के असली नतीजे अगले prompt में जाते हैं | live run पूरा हुआ: 9/9 steps done, **16,486 अक्षर** का package (audit + scored hooks + linted titles + script + SEO + Shorts + plan) |
| Tools pipeline में | Pyodide में `hookscore.py`/`title.py` चलकर model की lines को score करते हैं (model का अंदाज़ा नहीं) | hooks का top score 32 (WEAK) — tool ने सच बताया, model की तारीफ़ नहीं की |
| Output | एक markdown package: **Download .md**, Copy, और localStorage में पिछला package | download/copy ਬਟन, `पिछला package खोलो` |
| Deploy | Worker (preview + production) पर नया endpoint; page `youtube/` में Auto Pilot | worker deploy receipts `succeeded`; live page पर channel card + audit step चलते देखा गया |

**सीमाएँ (साफ़ शब्दों में):**

1. **“Viral” की कोई गारंटी नहीं** — कोई tool नहीं दे सकता। यह आपके channel के अपने proven patterns + pack के heuristics
   पर बनाता है, पर पहला दर्शक आपका ही होगा।
2. Pipeline में **6–7 model calls** होते हैं → एक run 4–6 मिनट, और Worker की **30 सवाल/घंटा** सीमा में गिने जाते हैं।
3. Channel data सिर्फ़ **public RSS** (आख़िरी 15 videos) — private analytics, CTR, retention CSV नहीं आते; retention के लिए
   आपको Studio से CSV डालनी होगी (Manual mode).
4. **Transcript नहीं होता**, इसलिए chapters/EDL अपने आप नहीं बनते — वे तब बनते हैं जब आप transcript दें।
5. **Upload नहीं होता** — YouTube Data API से अपलोड अलग OAuth काम है; अभी आप ही post करेंगे (यही pack का इरादा भी है)।
6. Browser cache: assets अब `?v=` के साथ माँगे जाते हैं, वरना पुराना `app.js` नया button नहीं चलाता (यह bug live पर मिला और ठीक हुआ).

---

---

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

---

## 9. M13d — channel connect + auto-publish (2026-11-20)

**Ask:** "main chahta hun ki main channel connect kar du ek baar ye khud viral videos ki clip publish kare."

**What was built**

- `ai-worker/worker.js` — `/api/yt/oauth/start` + `/api/yt/oauth/callback` (Google OAuth, HMAC-signed state,
  return-URL allowlist), `/api/yt/status` (public, `no-store`, never returns tokens), `/api/yt/token`
  (Bearer `AUTOPILOT_KEY` **or** GitHub OIDC JWT: RS256 signature checked against
  `token.actions.githubusercontent.com/.well-known/jwks`, `aud=shavi-autopilot`,
  `repository=VKKMANAGE1/vktechlearn`), `/api/yt/ledger`, `/api/yt/log`, `/api/yt/run` (workflow_dispatch via
  optional `GH_TOKEN`, 10 min/IP). Refresh token + run history + dedupe ledger in D1 binding `DB`.
- `tools/yt-autopilot/autopilot.py` — own-channel uploads → captions API (yt-dlp auto-subs fallback) → model
  moment picking + deterministic heuristic fallback → yt-dlp section download → ffmpeg 1080×1920 (blurred bed,
  centred source, burned SRT captions, loudnorm −14 LUFS) → resumable `videos.insert` as `#Shorts` → ledger.
  `--self-test` runs everything except Google; `--dry-run` builds clips without publishing.
- `.github/workflows/yt-autopilot.yml` — cron `40 3,15 * * *` (09:10 / 21:10 IST) + manual dispatch with a
  `dry_run` input; installs ffmpeg + Noto fonts + yt-dlp; mints an OIDC token, so no secret is stored in GitHub.
- `youtube/` — "Channel जोड़ें" panel: connect button, अभी चलाओ / Test run, channel card, last runs, last
  Shorts, setup hints when the Google keys or `GH_TOKEN` are missing. Assets bumped to `?v=3`.
- `tools/yt-autopilot/README.md` + `config.json` — one-time setup, settings table, honest limits.

**Scope decision (copyright):** clips are cut only from the connected channel's own uploads (`mine=true`).
Republishing other creators' videos was not implemented — that is a copyright-strike path, not a feature.

**Verified here**

```
python3 -m py_compile autopilot.py            OK
node --check worker.js (as .mjs)              OK
node --check youtube/app.js (as .mjs)         OK
autopilot.py --self-test                      clip-1.mp4 1080x1920 32.0s 9.4 MB, captions burned
frame at 8s                                   blurred bed + centred 16:9 + bold outlined caption
worker routes (node:sqlite D1 shim)           status 200 + flags; token 401 (missing/wrong key);
                                              oauth start 302 with 3 scopes; bad state 400;
                                              foreign return URL rejected; denied → /youtube/?yt=denied;
                                              log 200 → ledger sources [VID1] → status published 1;
                                              run without GH_TOKEN 502 with actionable message
live production worker                        /health 200; /api/yt/status {"connected":false,
                                              "oauth":false,"storage":true,...}; /api/yt/oauth/start 503
                                              (keys not set yet); /api/yt/token 401;
                                              /api/yt/channel?u=@mkbhd 200
bug found on first live deploy                D1 exec() splits on newlines → CREATE TABLE failed;
                                              now one prepare().run() per statement (`end` → `end_s`)
```

**Not verified / still open**

- End-to-end publish: needs the Google OAuth client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in
  Sites → Secrets, redirect `https://site-d28594350583452e987524c38e89b7a9.freebuff.page/api/yt/oauth/callback`)
  and one Connect click. Nothing has been uploaded to YouTube from here — no credentials existed in this workspace.
- Caption burn was proven locally with DejaVu + a hand-written fontconfig; this VM ships zero fonts, so the
  runner's own run is the first place the `fonts-noto-*` path executes.
- `GH_TOKEN` (fine-grained PAT, Actions: write) is not set → "अभी चलाओ" returns 502 with instructions; the
  Actions tab "Run workflow" is the fallback path.
- YouTube quota: `videos.insert` ≈1600 units → 4–6 uploads/day; `clips_per_run` stays 2.
- Not a viral guarantee: the pipeline reuses proven moments and posts consistently; reach is the audience's call.

## 10. M13e — per-user Google login (2026-11-20)

Studio अब सिर्फ़ एक owner के लिए नहीं. हर user अपनी Google OAuth client (client id + secret)
studio के box में एक बार सेव करता है और एक बार channel connect करता है; उसके बाद page खोलने पर
उसका channel अपने आप दिखता है और दोबारा keys डालनी नहीं पड़तीं.

- `POST /api/yt/keys` — keys को D1 में रखता है: पहले browser-scoped `yt_setups` row + signed
  `shavi_setup` cookie, connect के बाद उसी user के `yt_users` row में. client secret कभी वापस
  नहीं भेजा जाता — response में सिर्फ़ client id. keys बदलने पर पुराना refresh token हट जाता है
  (`needsReconnect`), क्योंकि दूसरी client की keys से वह token काम नहीं करता.
- signed httpOnly `shavi_uid` cookie — HMAC key D1 के `yt_settings` में एक बार बनती है, इसलिए
  Worker में `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` सेट किए बिना भी सब चलता है (env keys
  सिर्फ़ default fallback हैं). callback `SameSite=None; Secure; HttpOnly` cookie सेट करता है.
- schema: `yt_users` (uid, channel, email, client keys, refresh token), `yt_runs.uid`,
  `yt_clips.uid`; status/ledger/log/run सब उसी uid के हिसाब से — एक user का data दूसरे को नहीं.
- `GET /api/yt/users` (GitHub OIDC या `AUTOPILOT_KEY`) + `autopilot.py --all-users`: schedule हर
  जुड़े channel को एक-एक करके चलाता है; `--user <uid>` से सिर्फ़ एक. `/api/yt/run` भी उसी
  cookie वाले user का channel dispatch करता है.
- studio UI: redirect URI का readonly box + Copy, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` के
  box + Save, keys सेव होने पर ही connect active. Assets `?v=4`.

**Verified locally** (node:sqlite D1 shim): bad client id → 400; foreign origin → 403; keys save →
200 + `shavi_setup` cookie; status उसी cookie पर → `oauth:true, keysSource:"browser"`; oauth start
→ 302 Google पर उसी client id और 3 scopes के साथ; keys न होने पर 503; forged `shavi_uid` →
`loggedIn:false`; असली uid cookie → channel + runs + clips + shorts URL; `/api/yt/users` बिना key
401 / key के 200; ledger uid-scoped; run बिना cookie → 409; वही keys दोबारा → `needsReconnect:false`,
बदली keys → `true` और `connected:false`.

**Not verified:** असली Google consent + callback (live keys नहीं हैं), असली publish, और page
browser में खोलकर नहीं देखा गया — सिर्फ़ syntax, worker routes और markup.

## 11. M13f — login token, keys दोबारा डालने की ज़रूरत नहीं (2026-11-20)

M13e में पहचान `shavi_uid` cookie से थी, पर वह Worker के दूसरे domain (freebuff.page) की
third-party cookie है — Safari/Firefox और third-party cookies block करने वाले Chrome में वह सेव
ही नहीं होती, इसलिए keys हर बार दोबारा डालनी पड़ती थीं. अब असली पहचान login token है.

- `POST /api/yt/keys` अब हमेशा account-scoped है: uid न हो तो बनता है, keys उसी `yt_users` row
  में जाती हैं, और response में एक बार **login token** (`token`) आता है. client secret वापस
  नहीं भेजा जाता; बदली keys पर `needsReconnect:true` और refresh token हट जाता है.
- page token को first-party `localStorage` (`shavi-yt-login-v1`) में रखता है और हर call में
  `X-YT-Token` header भेजता है (status/keys/run). CORS preflight में वह header allowed है.
  Worker की cookie अब सिर्फ़ fallback है — token पहले देखा जाता है.
- नया `POST /api/yt/login` — दूसरे browser/device पर “Login code” डालने से वही खाता (keys +
  channel) मिल जाता है; गलत code 401, दूसरे origin से 403. पुराना/गलत token मिलने पर status
  `loggedIn:false` देता है और page उसे localStorage से हटा देता है.
- नया `POST /api/yt/connect`: Google पर navigation में header नहीं जा सकता, इसलिए एक बार का
  ticket देता है; `/api/yt/oauth/start?t=…` ticket से uid निकालकर OAuth state में `u` रखता है
  और ticket तुरंत मिटा देता है. Callback channel + refresh token उसी uid में लिखता है; वही
  channel पहले किसी दूसरे uid में हो तो उस पुरानी row से channel/token हटा दिए जाते हैं.
- studio UI: “Google login — keys सिर्फ़ एक बार”, login state line, “Login code copy करें”, और
  “दूसरे browser/device पर login” का code box. Assets `?v=5`.

**Verified locally** (node:sqlite D1 shim, 44 checks): preflight में `X-YT-Token`; बिना cookie
keys सेव → 200 + token + HttpOnly cookie; सिर्फ़ token header से status → `loggedIn:true,
keysSaved:true, keysSource:"account", clientId`; वही keys दोबारा → वही token और
`needsReconnect:false`; बिना token/cookie → logged out; forged token → logged out; connect
ticket → 302 Google पर user के client id + 3 scopes, state में uid, दूसरी बार वही ticket → 503;
login सही code 200 / गलत 401 / foreign origin 403; दूसरे uid के runs/clips नहीं दिखते; run
बिना login 409, login के साथ dispatch तक (GH_TOKEN नहीं → 502), foreign origin 403; uid cookie
अब भी वही खाता देती है; बदली keys → `needsReconnect:true` + `connected:false`; mocked Google
callback → 302 `yt=connected`, channel उसी login खाते में, दूसरे uid का duplicate channel हटा.

**Live (preview + production deploy `succeeded`):** anon status में नए fields, preflight में
`X-YT-Token`, forged token → `loggedIn:false`, गलत login code → 401, बिना keys connect → 409.

**Not verified:** असली Google consent + callback + publish (live Google keys नहीं), और page
browser में खोलकर नहीं देखा गया.
