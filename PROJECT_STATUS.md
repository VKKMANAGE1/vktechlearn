# PROJECT_STATUS — ShâVì Ai (VK Tech Learn)

Last updated: 2026-11-16 · Current milestone: **Live news answers with cited sources**

## 1. Current architecture (what actually exists)

This project is **not** LibreChat, and LibreChat is **not installed**. It is a small, purpose-built
stack that already works in production:

| Layer | What it is | Files |
| --- | --- | --- |
| Frontend | Vite + React + TypeScript chat UI (shadcn/AI-Elements components, Streamdown markdown) | `shavi-ai-app/src/**` |
| Built output | Static bundle served by GitHub Pages at `/shavi-ai/` (base `/shavi-ai/`) | `shavi-ai/**` |
| Backend | Single Cloudflare Worker (ES module) — chat SSE, OCR, image, news, search | `ai-worker/worker.js` |
| AI provider | NVIDIA NIM (OpenAI-compatible) via server-side key | Worker env `AI_API_KEY`, `AI_MODEL`, `AI_VISION_MODEL` |
| Deploy (backend) | Freebuff Sites worker (`ai-worker/deploy.json`) | preview + production environments |
| Deploy (frontend) | GitHub Pages from `main` → Actions | `shavi-ai/` |
| Persistence | **Browser localStorage only** (chat threads). No server database, no accounts. | `shavi-ai-app/src/App.tsx` |

Repository rules (AGENTS.md) also require: static posts generated from Blogger, author byline
`by Vïnâý Kúshwâhå`, no hand-editing `posts/*.html`. The AI app must not break those.

## 2. Working features (verified)

| Feature | Verification done |
| --- | --- |
| Chat streaming (SSE) | `POST /api/chat` streamed real tokens on prod worker |
| OCR of scanned PDF | Real upload → "INVOICE 2026-114 / 4500 INR / 30 November 2026" |
| DOCX / XLSX / PPTX / CSV / TXT upload | Real files parsed and answered from content |
| Exports (PDF/DOCX/XLSX/PPTX) | Files opened/validated (Hindi PDF render checked) |
| Image generation | FLUX.1-dev, 1024×1024 image returned |
| Vision (image questions) | Llama 3.2 90B vision answered from uploaded image |
| **Live news + citations** (this milestone) | See §3 |
| Text-only wordmark logo | Live page checked: 3 logos, no emblem |

## 3. This milestone — live news (evidence)

**Requirement:** ask "आज की खबरें" / "latest news" → answer with real current headlines, dates, clickable sources.

| Check | Result |
| --- | --- |
| Implementation | `ai-worker/worker.js`: `NEWS_FEEDS`, `TOPIC_FEEDS`, `feedsFor()`, `feedNews()`, `gdeltNews()`, `newsSearch()`, `formatNews()`, `NEWS_HINT`, injection in `/api/chat`, debug route `/api/news` |
| Frontend | `shavi-ai-app/src/App.tsx`: `linkify()` (raw URLs → markdown links, code blocks skipped), `MessageResponse linkSafety={{enabled:false}}` so links render as real `<a>` |
| Backend live check | `GET /health` → `{"search":true,"news":"gdelt+rss", ...}` on production worker |
| Hindi news question | Prod `/api/chat` returned today's BBC हिंदी headlines with links + `— 2026-11-16` |
| English tech question | Returned Indian Express Tech headlines with links + dates |
| Topic routing | cricket/क्रिकेट → sports feeds first; tech/टेक → Indian Express Tech, The Verge, TechCrunch, Gadgets 360 |
| Irrelevant-topic guard | "आज दिल्ली का मौसम कैसा है?" → model states clearly that feeds have no weather data instead of inventing it |
| Non-news question | "आज मुझे Python सीखने का 3 दिन का प्लान बनाओ" → normal answer, no search, no filler citations |
| UI end-to-end (live site) | `https://vktechlearn.site/shavi-ai/` → asked news question → 4 clickable `<a target="_blank">` links to bbc.com articles, dates present, "स्रोत" section present |
| Fake-search guard | System prompt forbids claiming a search happened when no results were injected |
| Latency | News query ≈ 5–15 s (upstream feeds + model); no 5.5 s GDELT retry stall |

**Known limitation:** GDELT's API returns 0 results from the Cloudflare Worker egress (works from a VM),
so topics rely on the RSS feeds above; there is no Exa/Tavily key, so there is no general web-page search
(only news feeds). When the model has no matching item it says so — that is intended, not a bug.

## 4. Missing vs the SHAVI AI master brief (audit result)

Everything below is **not implemented**; nothing here is claimed as done.

- Accounts, login, roles/admin panel (no auth at all; no server DB — conversations are localStorage).
- Multi-provider model registry (DeepSeek/OpenAI/Gemini/Anthropic/OpenRouter/Groq/Mistral/Ollama);
  only NVIDIA NIM is wired.
- Server-side conversation persistence, search, rename/archive, share links.
- Deep research (multi-step), code interpreter sandbox, memory/personalization.
- Speech-to-text / text-to-speech.
- Paid-feature fallbacks: Exa/Tavily search, image editing (NVIDIA Kontext returns 422).

## 5. Technical risks

1. **No database** — history is per-browser; clearing storage loses chats. Any ChatGPT-parity milestone
   needs a real backend store (Workers + D1 or equivalent) before accounts.
2. **No auth** — `/api/chat`, `/api/ocr`, `/api/image` are public with a per-IP rate limit (30/hour) only.
3. **News quality** — headline relevance depends on feed coverage; GDELT blocked from Worker.
4. **Model reliability** — the model sometimes emits tool-call XML as text; the deterministic
   (non-tool-calling) search path was chosen deliberately to avoid that.
5. **Deploy coupling** — backend changes need a Sites deploy; frontend needs a Pages build (~100 s).

## 6. Recommended next milestone (needs approval)

**M1 — Persistence + accounts:** add a server data store (Sites D1) with conversations/messages,
API-key or magic-link auth, ownership checks on every read/write, and migrate localStorage threads.
Do not start until approved.

## 7. Test log (this milestone)

```
/health (prod)                       → search:true, news:"gdelt+rss", demo:false
/api/news?q=technology               → items include Indian Express Tech headlines (6 items)
/api/chat  "आज की 2 बड़ी खबरें…"      → BBC हिंदी headlines + links + 2026-11-16
/api/chat  "Give me 2 latest tech…"  → Indian Express Tech headlines + links
/api/chat  "आज मुझे Python सीखने…"    → plan only, no fake search claim
/api/chat  "आज दिल्ली का मौसम…"       → "इन नतीजों में मौसम की जानकारी नहीं है"
Live UI (Playwright, vktechlearn.site) → 4 anchors, dates, स्रोत section
```

Commits: `483cc40` (news feeds + ranking), `8df9df0` (clickable sources), plus this audit commit.
