---
title: Shavi AI
emoji: 🤖
colorFrom: purple
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
---

# Shavi AI (Python backend)

`vktechlearn.site` is a static site on GitHub Pages, so it cannot run Python itself.
This folder is the small FastAPI service behind **Shavi AI**: it keeps the API key on
the server, streams answers to the browser and serves the chat page too.

## Files

| File | What it does |
|---|---|
| `app.py` | FastAPI app: `POST /api/chat` (streaming), `GET /health`, rate limit, CORS |
| `static/index.html` | The chat screen (same glass theme as the site) |
| `requirements.txt` | fastapi + uvicorn + httpx |
| `Dockerfile` | Runs anywhere, including Hugging Face Spaces |
| `render.yaml` | Render blueprint for a free web service |

## Run locally

```bash
cd ai
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

AI_DEMO=1 uvicorn app:app --reload --port 8000   # demo answers, no key needed
# or, with a real key:
AI_API_KEY=your_key AI_BASE_URL=https://api.groq.com/openai/v1 uvicorn app:app --port 8000
```

Open <http://127.0.0.1:8000/>.

## Environment variables

| Name | Default | Purpose |
|---|---|---|
| `AI_API_KEY` | — | Provider key. Without it the service answers in demo mode. |
| `AI_BASE_URL` | `https://api.groq.com/openai/v1` | Any OpenAI-compatible endpoint. Gemini: `https://generativelanguage.googleapis.com/v1beta/openai/` |
| `AI_MODEL` | `llama-3.3-70b-versatile` | Model name for that provider |
| `AI_ALLOWED_ORIGINS` | the live site + localhost | Comma separated origins allowed by CORS |
| `AI_RATE_LIMIT` | `30` | Questions per hour per IP |
| `AI_DEMO` | `0` | `1` forces demo answers |

## Deploy

**Render (free):** New → Blueprint → pick this repo → it reads `ai/render.yaml`.
Then open the service → Environment → add `AI_API_KEY` (never commit it). The URL is
`https://shavi-ai.onrender.com` (free instances sleep after ~15 min idle; the first
message may take ~30s to wake up).

**Hugging Face Spaces (free, no card) — current choice:**

1. huggingface.co → **New → Space** → name `shavi-ai` → SDK **Docker** → *Blank* → Public → Create.
2. In the new Space: **Files → Add file → Upload files** and upload everything in this
   folder (`app.py`, `requirements.txt`, `Dockerfile`, `static/index.html`, `README.md`).
   This README already carries the `sdk: docker` frontmatter and `app_port: 7860`, so the
   Space builds straight away.
3. **Settings → Variables and secrets → New secret**: name `AI_API_KEY`, value = your Groq key.
   (Optional variables: `AI_BASE_URL=https://api.groq.com/openai/v1`,
   `AI_MODEL=llama-3.3-70b-versatile`, `AI_ALLOWED_ORIGINS=https://vktechlearn.site,https://www.vktechlearn.site`.)
4. Wait for the build to finish; the app opens at `https://<your-username>-shavi-ai.hf.space`.
5. Check `https://<your-username>-shavi-ai.hf.space/health` — it should say `"demo": false`.
6. Send that URL to be wired into the site's Shavi AI links (nav, quick links, footer, tool list).

After the service is live, point the site at it: open `index.html`, find
`shavi-ai.lovable.app` and replace the three links with your new URL, or serve the chat
from `ai/static/index.html` at `https://vktechlearn.site/shavi-ai/` and keep `/api/chat`
on the hosted service (set `API_BASE` there).

## Safety

- The key lives only in the host's environment; the browser never sees it.
- Every question is trimmed to 2,000 characters and only the last 12 turns are sent.
- `/api/chat` allows only the site's origins, so other sites cannot spend your credits.
- Rate limit is in memory per instance — enough for a personal site; move it to Redis if
  you ever run several instances.

## साइट पर चैट पेज जोड़ना (ज़रूरी आख़िरी कदम)

साइट का पेज `shavi-ai/` (सोर्स: `shavi-ai-app/`) इसी सेवा से बात करता है। Space लाइव होने के बाद:

1. `shavi-ai/config.js` खोलें और एक लाइन भरें:

   ```js
   window.SHAVI_API = "https://<username>-shavi-ai.hf.space";
   ```

2. यही फ़ाइल `shavi-ai-app/public/config.js` में भी बदल दें, ताकि अगली बिल्ड में बना रहे।
3. साइट का पेज खोलकर एक सवाल पूछें — जवाब स्ट्रीम होना चाहिए।

Space के **Settings → Variables and secrets** में ये डालें:

| नाम | उदाहरण |
| --- | --- |
| `AI_API_KEY` | Groq key, या NVIDIA key (`nvapi-…`) |
| `AI_BASE_URL` | `https://api.groq.com/openai/v1` या `https://integrate.api.nvidia.com/v1` |
| `AI_MODEL` | `llama-3.3-70b-versatile` या `nvidia/nemotron-3-ultra-550b-a55b` |
| `AI_ALLOWED_ORIGINS` | `https://vktechlearn.site,https://www.vktechlearn.site` |

`/health` पर `"demo": false` दिखे तो key ठीक लगी है।
