/**
 * Shavi AI — chat backend as a Cloudflare Worker.
 *
 * Same behaviour as ai/app.py but runs on the edge, so no Python host is needed.
 * The site (GitHub Pages) calls POST /api/chat and receives a simple SSE stream:
 *   data: {"delta": "..."}   ...   data: {"done": true}
 *
 * Secrets / variables (set in Freebuff Sites → Secrets):
 *   AI_API_KEY   provider key (required for real answers)
 *   AI_BASE_URL  default https://integrate.api.nvidia.com/v1
 *   AI_MODEL     default nvidia/nemotron-3-ultra-550b-a55b
 *   EXA_API_KEY  optional — enables the web search tool
 *   ALLOWED_ORIGINS optional comma separated override
 */

const DEFAULT_BASE = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
const LIMIT_PER_HOUR = 30;
const MAX_CHARS = 8000;
const MAX_TURNS = 20;
const MAX_TOKENS = 3000;

const SYSTEM_PROMPT = `तुम "ShâVì Ai" हो — एक आम, पूरी तरह काम का AI सहायक, जिसे Vïnâý Kúshwâhå ने VK Tech Learn के लिए बनाया है।
तुम्हें किसी एक विषय तक सीमित नहीं रहना है। लोग तुमसे कोडिंग, गणित, पढ़ाई, लिखाई, अनुवाद, करियर,
टेक्नोलॉजी, व्यापार, रोज़मर्रा के सवाल और रिसर्च — कुछ भी पूछ सकते हैं। ChatGPT जैसा पूरा सहायक बनो,
पर अपनी पहचान ShâVì Ai ही रखो।

## जवाब कैसे दो
- यूज़र की भाषा में जवाब दो। हिंदी में पूछे तो आसान हिंदी (टेक्निकल शब्द अंग्रेज़ी में), English में पूछे तो English.
- सवाल जितना बड़ा, जवाब उतना विस्तृत। छोटे सवाल का छोटा जवाब; "पूरी गाइड/कोड लिखो/समझाओ" पर पूरा और क्रम में।
- Markdown ठीक से: छोटे पैराग्राफ, ज़रूरत पर सूची/टेबल/स्टेप्स, कोड हमेशा भाषा-टैग वाले code block में।
- कोडिंग में पहले संक्षेप में समझाओ, फिर चलने लायक पूरा कोड, फिर उदाहरण/आउटपुट और ध्यान देने वाली बातें।
- गणित/लॉजिक स्टेप-दर-स्टेप, आख़िर में साफ़ जवाब।

## ईमानदारी और सुरक्षा
- ताज़ा/बदलती जानकारी (खबर, कीमत, तारीख़, नया वर्ज़न) का पक्का पता न हो तो साफ़ कहो। लिंक, आँकड़े, API बनाकर मत बताओ।
- अगर वेब सर्च का नतीजा दिया गया है, उसी के आधार पर जवाब दो और अंत में "स्रोत" में URLs लिखो।
- पासवर्ड, OTP, बैंक/कार्ड नंबर या किसी की निजी जानकारी माँगो मत।
- मेडिकल/कानूनी/बड़े पैसे के फ़ैसलों में सामान्य जानकारी दो और विशेषज्ञ से मिलने को कहो।
- धोखाधड़ी, हैकिंग, मैलवेयर या गैरकानूनी काम में मदद मत करो; सुरक्षित विकल्प बताओ।
- खुद को Google/OpenAI/NVIDIA का AI मत बताओ। तुम ShâVì Ai हो।`;

const SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the live web for fresh facts: news, prices, releases, schedules, sports, current events, or anything that may have changed recently.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Short, specific search query (2-8 words)." } },
      required: ["query"],
    },
  },
};

const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const bucket = (hits.get(ip) || []).filter((time) => now - time < 3600_000);
  if (bucket.length >= LIMIT_PER_HOUR) {
    hits.set(ip, bucket);
    return true;
  }
  bucket.push(now);
  hits.set(ip, bucket);
  if (hits.size > 5000) hits.clear();
  return false;
}

function cors(env, request) {
  const configured = (env.ALLOWED_ORIGINS || "https://vktechlearn.site,https://www.vktechlearn.site").split(",").map((value) => value.trim()).filter(Boolean);
  const origin = request.headers.get("Origin") || "";
  const allowed = configured.includes(origin) || origin.endsWith(".style.dev") || origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1");
  return {
    "Access-Control-Allow-Origin": allowed ? origin : configured[0],
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`;

function pickText(messages) {
  return messages
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content || "").slice(0, MAX_CHARS).trim(),
    }))
    .filter((message) => message.content)
    .slice(-MAX_TURNS);
}

async function exaSearch(query, env) {
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": env.EXA_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: query.slice(0, 300),
      type: "auto",
      numResults: 5,
      contents: { highlights: { numSentences: 3, highlightsPerUrl: 1 } },
    }),
  });
  if (!response.ok) return "वेब खोज अभी उपलब्ध नहीं है; अपनी जानकारी से जवाब दो और साफ़ बताओ कि ताज़ा जानकारी नहीं मिली।";
  const data = await response.json();
  const lines = (data.results || []).slice(0, 5).map((item) => {
    const snippet = (item.highlights || []).join(" ").slice(0, 500);
    return `- ${item.title || ""} (${item.url || ""}): ${snippet}`;
  });
  return lines.join("\n") || "कोई उपयोगी नतीजा नहीं मिला।";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = cors(env, request);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    const base = (env.AI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
    const model = env.AI_MODEL || DEFAULT_MODEL;

    if (url.pathname === "/health") {
      return Response.json(
        { status: "ok", model, demo: !env.AI_API_KEY, search: Boolean(env.EXA_API_KEY) },
        { headers },
      );
    }

    if (url.pathname !== "/api/chat" || request.method !== "POST") {
      return new Response("Shavi AI API. POST /api/chat", { status: 404, headers });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (rateLimited(ip)) {
      return Response.json({ error: `एक घंटे में ${LIMIT_PER_HOUR} सवाल की सीमा पूरी हो गई। थोड़ी देर बाद कोशिश करें।` }, { status: 429, headers });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "कृपया पहले कुछ लिखें।" }, { status: 400, headers });
    }
    const messages = pickText(Array.isArray(body.messages) ? body.messages : []);
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return Response.json({ error: "कृपया पहले कुछ लिखें।" }, { status: 400, headers });
    }

    if (!env.AI_API_KEY) {
      const demo =
        "नमस्ते! मैं ShâVì Ai हूँ। सर्वर पर अभी `AI_API_KEY` सेट नहीं है, इसलिए सच्चा जवाब नहीं दे पा रहा। चाबी लगते ही कोडिंग, पढ़ाई, लिखाई और रिसर्च — सब चलने लगेगा।";
      return new Response(sse({ delta: demo }) + sse({ done: true }), {
        headers: { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }

    const auth = { Authorization: `Bearer ${env.AI_API_KEY}`, "Content-Type": "application/json" };
    let working = [{ role: "system", content: SYSTEM_PROMPT }, ...messages];

    if (env.EXA_API_KEY) {
      try {
        const probe = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            model,
            messages: working,
            tools: [SEARCH_TOOL],
            tool_choice: "auto",
            temperature: 0.2,
            max_tokens: 200,
          }),
        });
        if (probe.ok) {
          const plan = await probe.json();
          const message = plan.choices?.[0]?.message;
          const calls = message?.tool_calls || [];
          if (calls.length) {
            working = [...working, message];
            for (const call of calls.slice(0, 2)) {
              let query = messages[messages.length - 1].content;
              try {
                query = JSON.parse(call.function?.arguments || "{}").query || query;
              } catch {
                /* keep the user message as the query */
              }
              const result = await exaSearch(query, env);
              working.push({ role: "tool", tool_call_id: call.id || "search", name: "web_search", content: result });
            }
          }
        }
      } catch {
        /* search is optional — answer without it */
      }
    }

    const upstream = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model, messages: working, temperature: 0.7, max_tokens: MAX_TOKENS, stream: true }),
    });

    if (!upstream.ok || !upstream.body) {
      const detail = (await upstream.text().catch(() => "")).slice(0, 300);
      return new Response(sse({ error: `AI सेवा ने ${upstream.status} लौटाया। ${detail}` }), {
        headers: { ...headers, "Content-Type": "text/event-stream" },
      });
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let buffer = "";
        let reasoningId = null;
        let textId = null;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() || "";
            for (const part of parts) {
              const line = part.trim();
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              let chunk;
              try {
                chunk = JSON.parse(data);
              } catch {
                continue;
              }
              const delta = chunk.choices?.[0]?.delta || {};
              if (delta.reasoning_content) {
                if (!reasoningId) {
                  reasoningId = "r1";
                  controller.enqueue(encoder.encode(sse({ reasoning_start: reasoningId })));
                }
                controller.enqueue(encoder.encode(sse({ reasoning_delta: delta.reasoning_content })));
              }
              if (delta.content) {
                if (reasoningId) {
                  controller.enqueue(encoder.encode(sse({ reasoning_end: reasoningId })));
                  reasoningId = null;
                }
                controller.enqueue(encoder.encode(sse({ delta: delta.content })));
              }
            }
          }
          if (reasoningId) controller.enqueue(encoder.encode(sse({ reasoning_end: reasoningId })));
          controller.enqueue(encoder.encode(sse({ done: true })));
        } catch (error) {
          controller.enqueue(encoder.encode(sse({ error: "जवाब के बीच में दिक्कत आ गई।" })));
        }
        controller.close();
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });

    return new Response(stream, {
      headers: { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
    });
  },
};
