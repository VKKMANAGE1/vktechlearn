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
const DEFAULT_VISION_MODEL = "meta/llama-3.2-90b-vision-instruct";
const IMAGE_MODEL = "black-forest-labs/flux.1-dev";
const IMAGE_ENDPOINT = `https://ai.api.nvidia.com/v1/genai/${IMAGE_MODEL}`;

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
- अगर वेब सर्च के नतीजे दिए गए हैं, तो उन्हीं के आधार पर जवाब दो और हर तथ्य के आगे [1], [2] जैसा नंबर लगाओ।
- जवाब के अंत में "**स्रोत**" शीर्षक के नीचे नंबर वार लिस्ट दो: [1] शीर्षक — लिंक — तारीख (जो नतीजे में दी हो)। लिंक हूबहू वही रखो, अपने से कोई URL मत बनाओ।
- नतीजों में न मिली बात अपनी जानकारी से दे सकते हो, पर उसे साफ़ अलग रखो और बताओ कि यह सर्च से नहीं है।
- अगर नतीजे कम या अधूरे हैं, साफ़ कहो कि पूरी पुष्टि नहीं हुई — अंदाज़ा मत लगाओ।
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

const SEARCH_EMPTY = "वेब खोज अभी उपलब्ध नहीं है; अपनी जानकारी से जवाब दो और साफ़ बताओ कि ताज़ा जानकारी नहीं मिली।";

function formatSources(results) {
  const lines = results.slice(0, 6).map((item, index) => {
    const date = item.publishedDate || item.published_date || "";
    const snippet = (item.highlights || []).join(" ").replace(/\s+/g, " ").slice(0, 600) || item.text?.slice(0, 600) || "";
    return `[${index + 1}] ${item.title || "(बिना शीर्षक)"}${date ? ` — ${String(date).slice(0, 10)}` : ""}\nURL: ${item.url || ""}\nसार: ${snippet}`;
  });
  return lines.join("\n\n") || "कोई उपयोगी नतीजा नहीं मिला।";
}

async function exaSearch(query, env) {
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": env.EXA_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: query.slice(0, 300),
      type: "auto",
      numResults: 6,
      contents: { highlights: { numSentences: 3, highlightsPerUrl: 2 } },
    }),
  });
  if (!response.ok) return SEARCH_EMPTY;
  const data = await response.json();
  return formatSources(Array.isArray(data.results) ? data.results : []);
}

async function tavilySearch(query, env) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: env.TAVILY_API_KEY,
      query: query.slice(0, 300),
      max_results: 6,
      search_depth: "advanced",
      include_answer: false,
    }),
  });
  if (!response.ok) return SEARCH_EMPTY;
  const data = await response.json();
  const results = (data.results || []).map((item) => ({
    title: item.title,
    url: item.url,
    publishedDate: item.published_date,
    text: item.content,
  }));
  return formatSources(results);
}

async function webSearch(query, env) {
  if (env.EXA_API_KEY) {
    const result = await webSearch(query, env);
    if (result !== SEARCH_EMPTY) return result;
  }
  if (env.TAVILY_API_KEY) return tavilySearch(query, env);
  return SEARCH_EMPTY;
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
        { status: "ok", model, vision: env.AI_VISION_MODEL || DEFAULT_VISION_MODEL, image: IMAGE_MODEL, demo: !env.AI_API_KEY, search: Boolean(env.EXA_API_KEY || env.TAVILY_API_KEY) },
        { headers },
      );
    }

    if (url.pathname === "/api/ocr") {
      if (request.method !== "POST") return new Response("Use POST", { status: 405, headers });
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      if (rateLimited(ip)) {
        return Response.json({ error: "एक घंटे की सीमा पूरी हो गई। थोड़ी देर बाद कोशिश करें।" }, { status: 429, headers });
      }
      let images = [];
      try {
        const body = await request.json();
        images = (Array.isArray(body.images) ? body.images : [])
          .filter((value) => typeof value === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(value))
          .slice(0, 6);
      } catch {
        return Response.json({ error: "इमेज भेजें।" }, { status: 400, headers });
      }
      if (!images.length) return Response.json({ texts: [] }, { headers });

      const model = env.AI_VISION_MODEL || DEFAULT_VISION_MODEL;
      const texts = new Array(images.length).fill("");
      const queue = images.map((_, index) => index);
      async function worker() {
        while (queue.length) {
          const index = queue.shift();
          try {
            const result = await fetch(`${env.AI_BASE_URL || "https://integrate.api.nvidia.com/v1"}/chat/completions`, {
              method: "POST",
              headers: { Authorization: `Bearer ${env.AI_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model,
                messages: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: "Transcribe every bit of text in this image exactly as written, keeping line breaks. If it is handwritten, transcribe it as best you can. If there is no text, reply with exactly: (कोई टेक्स्ट नहीं). Do not add commentary.",
                      },
                      { type: "image_url", image_url: { url: images[index] } },
                    ],
                  },
                ],
                temperature: 0.1,
                max_tokens: 1500,
              }),
            });
            if (result.ok) {
              const data = await result.json();
              texts[index] = (data.choices?.[0]?.message?.content || "").trim();
            }
          } catch {
            texts[index] = "";
          }
        }
      }
      await Promise.all([worker(), worker()]);
      return Response.json({ texts }, { headers });
    }

    if (url.pathname === "/api/image") {
      if (request.method !== "POST") return new Response("Use POST", { status: 405, headers });
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      if (rateLimited(ip)) {
        return Response.json({ error: "एक घंटे की सीमा पूरी हो गई। थोड़ी देर बाद कोशिश करें।" }, { status: 429, headers });
      }
      let prompt = "";
      try {
        prompt = String((await request.json()).prompt || "").trim().slice(0, 800);
      } catch {
        return Response.json({ error: "प्रॉम्प्ट भेजें।" }, { status: 400, headers });
      }
      if (!prompt) return Response.json({ error: "क्या बनाना है, लिखें।" }, { status: 400, headers });
      try {
        const result = await fetch(IMAGE_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.AI_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ prompt, steps: 8, seed: Math.floor(Math.random() * 100000) }),
        });
        if (!result.ok) {
          const detail = (await result.text().catch(() => "")).slice(0, 200);
          return Response.json({ error: `इमेज नहीं बन पाई (${result.status}). ${detail}` }, { status: 502, headers });
        }
        const data = await result.json();
        const artifact = (data.artifacts || [])[0];
        if (!artifact?.base64) return Response.json({ error: "इमेज खाली लौटी, दोबारा कोशिश करें।" }, { status: 502, headers });
        const mime = artifact.base64.startsWith("/9j/") ? "image/jpeg" : "image/png";
        return Response.json({ prompt, image: `data:${mime};base64,${artifact.base64}` }, { headers });
      } catch (error) {
        return Response.json({ error: "इमेज सेवा से कनेक्ट नहीं हो सका।" }, { status: 502, headers });
      }
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
    const images = (Array.isArray(body.images) ? body.images : [])
      .filter((value) => typeof value === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(value))
      .slice(0, 3);

    if (!env.AI_API_KEY) {
      const demo =
        "नमस्ते! मैं ShâVì Ai हूँ। सर्वर पर अभी `AI_API_KEY` सेट नहीं है, इसलिए सच्चा जवाब नहीं दे पा रहा। चाबी लगते ही कोडिंग, पढ़ाई, लिखाई और रिसर्च — सब चलने लगेगा।";
      return new Response(sse({ delta: demo }) + sse({ done: true }), {
        headers: { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }

    const auth = { Authorization: `Bearer ${env.AI_API_KEY}`, "Content-Type": "application/json" };
    let working = [{ role: "system", content: SYSTEM_PROMPT }, ...messages];

    if (images.length) {
      const last = messages[messages.length - 1];
      working = [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages.slice(0, -1),
        {
          role: "user",
          content: [
            { type: "text", text: last.content },
            ...images.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        },
      ];
    }

    if ((env.EXA_API_KEY || env.TAVILY_API_KEY) && !images.length) {
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
              const result = await webSearch(query, env);
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
      body: JSON.stringify({
        model: images.length ? env.AI_VISION_MODEL || DEFAULT_VISION_MODEL : model,
        messages: working,
        temperature: 0.7,
        max_tokens: MAX_TOKENS,
        stream: true,
      }),
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
