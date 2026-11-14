"""Shavi AI — the chatbot behind vktechlearn.site.

A small FastAPI service that talks to any OpenAI-compatible chat API and streams
the answer back to the browser. The site itself is static (GitHub Pages), so this
runs separately and the page calls it over HTTPS.

Environment variables
---------------------
AI_API_KEY          required for real answers (provider key)
AI_BASE_URL         default https://api.groq.com/openai/v1
                    (Gemini: https://generativelanguage.googleapis.com/v1beta/openai/)
AI_MODEL            default llama-3.3-70b-versatile
AI_ALLOWED_ORIGINS  comma separated origins allowed to call the API
AI_RATE_LIMIT       requests per hour per IP, default 30
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
DEMO = os.getenv("AI_DEMO", "0") == "1" or not API_KEY
LIMIT = int(os.getenv("AI_RATE_LIMIT", "30"))
WINDOW = 3600
MAX_CHARS = 2000
MAX_TURNS = 12

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "AI_ALLOWED_ORIGINS",
        "https://vktechlearn.site,https://www.vktechlearn.site,"
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000",
    ).split(",")
    if origin.strip()
]

SYSTEM_PROMPT = """तुम "Shavi AI" हो — VK Tech Learn (vktechlearn.site) का हिंदी AI सहायक।
तुम्हारा काम है आम लोगों को टेक्नोलॉजी, कंप्यूटर और इस साइट के टूल्स में मदद करना।

नियम:
- जवाब आसान हिंदी (Hinglish) में दो, टेक्निकल शब्द अंग्रेज़ी में रखो। ज़रूरत हो तो छोटी सूची या स्टेप्स दो।
- छोटा और काम का जवाब दो — आमतौर पर 120 शब्दों से कम, जब तक यूज़र पूरी गाइड न मांगे।
- जो पक्का न पता हो, साफ़ कहो कि जानकारी नहीं है; कोई लिंक, कीमत, तारीख़ या फ़ीचर बनाकर मत बताओ।
- इस साइट के मुफ़्त टूल्स याद रखो: /pdf/ पर 35 PDF टूल (मर्ज, स्प्लिट, कंप्रेस, PDF↔Word/Excel/PPT, OCR, प्रोटेक्ट, अनलॉक, साइन, वॉटरमार्क) और
  /img/ पर 13 इमेज टूल (कंप्रेस, रीसाइज़, क्रॉप, रोटेट, JPG↔PNG, वॉटरमार्क, मीम, अपस्केल, बैकग्राउंड हटाना, फेस ब्लर)। ये सब ब्राउज़र में चलते हैं, फ़ाइल अपलोड नहीं होती।
- साइट के पेज: /about.html, /profile.html, /contact.html, /privacy-policy.html, /terms-conditions.html
- किसी की निजी जानकारी, पासवर्ड, बैंक/OTP या गैरकानूनी काम में मदद मत करो। मेडिकल/कानूनी/वित्तीय सलाह की जगह विशेषज्ञ से मिलने को कहो।
- खुद को Google, OpenAI या किसी और कंपनी का AI मत बताओ; तुम VK Tech Learn के Shavi AI हो।
"""

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
    "नमस्ते! मैं Shavi AI हूँ — VK Tech Learn का हिंदी सहायक।\n\n"
    "अभी सेवा डेमो मोड में चल रही है, इसलिए सच्चा AI जवाब नहीं दे पा रहा। "
    "सर्वर पर AI_API_KEY सेट होते ही मैं पूरी तरह काम करने लगूँगा।\n\n"
    "तब तक ये काम की चीज़ें देख लें:\n"
    "• PDF के 35 टूल — https://vktechlearn.site/pdf/\n"
    "• इमेज के 13 टूल — https://vktechlearn.site/img/\n\n"
    "आपने पूछा: "
)


async def demo_stream(question):
    text = DEMO_REPLY + (question[:160] or "…")
    for chunk in [text[i : i + 18] for i in range(0, len(text), 18)]:
        await asyncio.sleep(0.02)
        yield sse({"delta": chunk})
    yield sse({"done": True})


async def provider_stream(messages):
    payload = {
        "model": MODEL,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
        "temperature": 0.6,
        "max_tokens": 700,
        "stream": True,
    }
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    timeout = httpx.Timeout(60.0, connect=15.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
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
    return {"status": "ok", "model": MODEL, "demo": DEMO}


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
