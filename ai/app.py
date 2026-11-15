"""Shavi AI — the chatbot behind vktechlearn.site.

A small FastAPI service that talks to any OpenAI-compatible chat API and streams
the answer back to the browser. The site itself is static (GitHub Pages), so this
runs separately and the page calls it over HTTPS.

The assistant is general purpose (coding, study, writing, research, everyday
questions), not tied to this site. When a search key is present the model can
call a web search tool before answering, so "latest" questions get real sources.

Environment variables
---------------------
AI_API_KEY          required for real answers (provider key)
AI_BASE_URL         default https://api.groq.com/openai/v1
                    (Gemini: https://generativelanguage.googleapis.com/v1beta/openai/)
                    (NVIDIA: https://integrate.api.nvidia.com/v1)
AI_MODEL            default llama-3.3-70b-versatile
AI_MAX_TOKENS       answer length cap, default 3000
AI_ALLOWED_ORIGINS  comma separated origins allowed to call the API
AI_RATE_LIMIT       requests per hour per IP, default 30
SEARCH_API_KEY      optional Tavily key — enables the web search tool
AI_DEMO             "1" forces demo answers (used for local testing)

Run locally:
    pip install -r requirements.txt
    AI_DEMO=1 uvicorn app:app --reload --port 8000
"""

import asyncio
import json
import os
import time
from collections import defaultdict, deque

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

API_KEY = os.getenv("AI_API_KEY", "").strip()
BASE_URL = os.getenv("AI_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
MODEL = os.getenv("AI_MODEL", "llama-3.3-70b-versatile")
MAX_TOKENS = int(os.getenv("AI_MAX_TOKENS", "3000"))
DEMO = os.getenv("AI_DEMO", "0") == "1" or not API_KEY
LIMIT = int(os.getenv("AI_RATE_LIMIT", "30"))
WINDOW = 3600
MAX_CHARS = 8000
MAX_TURNS = 20
SEARCH_KEY = (os.getenv("SEARCH_API_KEY") or os.getenv("TAVILY_API_KEY") or "").strip()
SEARCH_ENDPOINT = "https://api.tavily.com/search"

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "AI_ALLOWED_ORIGINS",
        "https://vktechlearn.site,https://www.vktechlearn.site,"
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000",
    ).split(",")
    if origin.strip()
]

SYSTEM_PROMPT = """तुम "ShâVì Ai" हो — एक आम, पूरी तरह काम का AI सहायक, जिसे Vïnâý Kúshwâhå ने VK Tech Learn के लिए बनाया है।
तुम्हें किसी एक विषय तक सीमित नहीं रहना है। लोग तुमसे कोडिंग, गणित, पढ़ाई, लिखाई, अनुवाद,
करियर, टेक्नोलॉजी, व्यापार, रोज़मर्रा के सवाल और रिसर्च — कुछ भी पूछ सकते हैं। ChatGPT जैसा
पूरा सहायक बनो, पर अपनी पहचान ShâVì Ai ही रखो।

## जवाब कैसे दो
- **यूज़र की भाषा में जवाब दो।** हिंदी में पूछे तो हिंदी (आसान, बोलचाल की; टेक्निकल शब्द अंग्रेज़ी में),
  English में पूछे तो English, Hinglish में पूछे तो Hinglish.
- सवाल जितना बड़ा है, जवाब उतना विस्तृत दो। छोटे सवाल का छोटा सीधा जवाब; "पूरी गाइड", "कोड लिखो",
  "समझाओ" जैसी माँग पर पूरा, ठीक-ठीक और क्रम में जवाब दो। बेवजह लंबा न करो।
- Markdown का सही इस्तेमाल करो: छोटे पैराग्राफ, जहाँ मदद करे वहाँ सूची/टेबल/स्टेप्स, और कोड हमेशा
  भाषा-टैग वाले code block में (```python, ```js, ```html आदि)। कोड चलने लायक और पूरा लिखो।
- कोडिंग में पहले संक्षेप में समझाओ, फिर कोड, फिर ज़रूरत हो तो उदाहरण/आउटपुट और ध्यान देने वाली बातें।
- गणित/लॉजिक में स्टेप-दर-स्टेप सोच दिखाओ, आख़िर में साफ़ जवाब दो।

## ईमानदारी और सुरक्षा
- जो पक्का न पता हो या बदलता रहता है (ताज़ा खबर, कीमत, तारीख़, नए वर्ज़न), साफ़ कहो कि तुम्हें
  पक्का नहीं पता या तुम्हारी जानकारी पुरानी हो सकती है। लिंक, आँकड़े, API, कीमत बनाकर मत बताओ।
- अगर वेब सर्च का नतीजा दिया गया है, उसी के आधार पर जवाब दो और आख़िर में "स्रोत" के रूप में
  उन URLs को लिखो। नतीजे में जो नहीं है, उसे नतीजे से जोड़कर मत बताओ।
- पासवर्ड, OTP, बैंक/कार्ड नंबर, किसी की निजी जानकारी माँगो मत और न ही लिखवाओ।
- मेडिकल, कानूनी या बड़े पैसे के फ़ैसलों में सामान्य जानकारी दो और विशेषज्ञ से मिलने को कहो।
- नुकसान पहुँचाने वाला, धोखाधड़ी वाला या गैरकानूनी काम (हैकिंग, मैलवेयर, किसी का अकाउंट चुराना,
  नकली दस्तावेज़) करने में मदद मत करो — साफ़ मना करो और सुरक्षित विकल्प बताओ।
- खुद को Google, OpenAI, Meta या किसी और कंपनी का AI मत बताओ। तुम ShâVì Ai हो।

आज की तारीख़ के बारे में अंदाज़ा मत लगाओ; तारीख़ पूछे जाने पर कहो कि तुम्हारी जानकारी सीमित है।
"""

SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "Search the live web. Use for fresh facts: news, prices, releases, schedules, "
        "sports, current events, or anything that may have changed recently.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Short, specific search query (2-8 words).",
                }
            },
            "required": ["query"],
        },
    },
}

app = FastAPI(title="Shavi AI", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    max_age=600,
)

_hits = defaultdict(deque)


def allowed(ip):
    now = time.time()
    bucket = _hits[ip]
    while bucket and now - bucket[0] > WINDOW:
        bucket.popleft()
    if len(bucket) >= LIMIT:
        return False
    bucket.append(now)
    return True


def client_ip(request):
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class Message(BaseModel):
    role: str
    content: str


class ChatIn(BaseModel):
    messages: list[Message] = Field(default_factory=list)


def sse(payload):
    return "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"


DEMO_REPLY = (
    "नमस्ते! मैं ShâVì Ai हूँ — कोडिंग, पढ़ाई, लिखाई और रिसर्च के लिए तुम्हारा AI सहायक।\n\n"
    "अभी सेवा डेमो मोड में है, यानी सर्वर पर `AI_API_KEY` सेट नहीं है, इसलिए सच्चा जवाब नहीं दे पा रहा। "
    "चाबी लगते ही मैं कोड लिखना, समझाना, अनुवाद, सारांश और वेब सर्च — सब करने लगूँगा।\n\n"
    "तब तक साइट के मुफ़्त टूल्स काम आ सकते हैं:\n\n"
    "- [PDF टूल्स](https://vktechlearn.site/pdf/)\n"
    "- [इमेज टूल्स](https://vktechlearn.site/img/)\n\n"
    "आपने पूछा: "
)


async def demo_stream(question):
    text = DEMO_REPLY + (question[:160] or "…")
    for chunk in [text[i : i + 18] for i in range(0, len(text), 18)]:
        await asyncio.sleep(0.02)
        yield sse({"delta": chunk})
    yield sse({"done": True})


async def run_search(query, client):
    """Ask Tavily for a handful of results and flatten them into readable text."""
    response = await client.post(
        SEARCH_ENDPOINT,
        json={
            "api_key": SEARCH_KEY,
            "query": query[:300],
            "max_results": 5,
            "search_depth": "basic",
            "include_answer": True,
        },
    )
    response.raise_for_status()
    data = response.json()
    lines = []
    if data.get("answer"):
        lines.append("सार: " + str(data["answer"])[:800])
    for item in (data.get("results") or [])[:5]:
        title = (item.get("title") or "").strip()
        url = (item.get("url") or "").strip()
        snippet = (item.get("content") or "").strip().replace("\n", " ")[:500]
        lines.append(f"- {title} ({url}): {snippet}")
    return "\n".join(lines) or "कोई उपयोगी नतीजा नहीं मिला।"


async def provider_stream(messages):
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    timeout = httpx.Timeout(120.0, connect=15.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            working = [{"role": "system", "content": SYSTEM_PROMPT}] + messages

            # Step 1: does this question need a fresh web lookup?
            if SEARCH_KEY:
                probe = {
                    "model": MODEL,
                    "messages": working,
                    "tools": [SEARCH_TOOL],
                    "tool_choice": "auto",
                    "temperature": 0.2,
                    "max_tokens": 200,
                    "stream": False,
                }
                try:
                    plan = await client.post(f"{BASE_URL}/chat/completions", json=probe, headers=headers)
                except httpx.HTTPError:
                    plan = None
                if plan is not None and plan.status_code == 200:
                    message = (plan.json().get("choices") or [{}])[0].get("message") or {}
                    calls = message.get("tool_calls") or []
                    if calls:
                        working.append(message)
                        for call in calls[:2]:
                            arguments = call.get("function", {}).get("arguments") or "{}"
                            try:
                                query = json.loads(arguments).get("query") or messages[-1]["content"]
                            except json.JSONDecodeError:
                                query = messages[-1]["content"]
                            yield sse({"status": f"वेब पर खोज रहा हूँ: {query[:60]}"})
                            try:
                                result = await run_search(query, client)
                            except httpx.HTTPError:
                                result = "वेब खोज अभी उपलब्ध नहीं है; अपनी जानकारी से जवाब दो और साफ़ बताओ कि ताज़ा जानकारी नहीं मिली।"
                            working.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": call.get("id", "search"),
                                    "name": "web_search",
                                    "content": result,
                                }
                            )

            # Step 2: stream the real answer.
            payload = {
                "model": MODEL,
                "messages": working,
                "temperature": 0.7,
                "max_tokens": MAX_TOKENS,
                "stream": True,
            }
            async with client.stream("POST", f"{BASE_URL}/chat/completions", json=payload, headers=headers) as response:
                if response.status_code != 200:
                    body = (await response.aread()).decode("utf-8", "replace")[:300]
                    yield sse({"error": f"AI सेवा ने {response.status_code} लौटाया। {body}"})
                    return
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    delta = (chunk.get("choices") or [{}])[0].get("delta", {}).get("content")
                    if delta:
                        yield sse({"delta": delta})
    except httpx.HTTPError as error:
        yield sse({"error": f"AI सेवा से कनेक्ट नहीं हो सका ({type(error).__name__})।"})
        return
    yield sse({"done": True})


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL, "demo": DEMO, "search": bool(SEARCH_KEY)}


@app.post("/api/chat")
async def chat(payload: ChatIn, request: Request):
    if not allowed(client_ip(request)):
        return JSONResponse(
            {"error": f"एक घंटे में {LIMIT} सवाल की सीमा पूरी हो गई। थोड़ी देर बाद कोशिश करें।"},
            status_code=429,
        )
    messages = [
        {"role": message.role if message.role in ("user", "assistant") else "user", "content": message.content[:MAX_CHARS].strip()}
        for message in payload.messages[-MAX_TURNS:]
        if message.content.strip()
    ]
    if not messages or messages[-1]["role"] != "user":
        return JSONResponse({"error": "कृपया पहले कुछ लिखें।"}, status_code=400)

    if DEMO:
        return StreamingResponse(demo_stream(messages[-1]["content"]), media_type="text/event-stream")
    return StreamingResponse(provider_stream(messages), media_type="text/event-stream")


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
