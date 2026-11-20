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
- जब तक नीचे सर्च नतीजे दिए न हों, यह मत कहो कि तुमने वेब सर्च किया, नतीजे देखे या कोई फ़ीड पढ़ी — ऐसा दावा झूठा होगा।
- पासवर्ड, OTP, बैंक/कार्ड नंबर या किसी की निजी जानकारी माँगो मत।
- मेडिकल/कानूनी/बड़े पैसे के फ़ैसलों में सामान्य जानकारी दो और विशेषज्ञ से मिलने को कहो।
- धोखाधड़ी, हैकिंग, मैलवेयर या गैरकानूनी काम में मदद मत करो; सुरक्षित विकल्प बताओ।
- खुद को Google/OpenAI/NVIDIA का AI मत बताओ। तुम ShâVì Ai हो।`;

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

const NEWS_HINT = /(खबर|ख़बर|समाचार|न्यूज़|न्यूज|news|ताज़ा|latest|breaking|headline|अपडेट|कीमत|price|मौसम|weather|स्कोर|score|रिज़ल्ट|result|चुनाव|election|शेयर|stock|nifty|sensex|bitcoin|crypto|क्या हुआ|आज क्या|what happened)/i;

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

function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function tagValue(block, name) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!match) return "";
  return decodeEntities(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim());
}

const NEWS_FEEDS = [
  { name: "BBC हिंदी", url: "https://feeds.bbci.co.uk/hindi/rss.xml" },
  { name: "NDTV", url: "https://feeds.feedburner.com/ndtvnews-top-stories" },
  { name: "Indian Express Tech", url: "https://indianexpress.com/section/technology/feed/" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
  { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
  { name: "Gadgets 360", url: "https://feeds.feedburner.com/gadgets360-latest" },
  { name: "अमर उजाला", url: "https://www.amarujala.com/rss/breaking-news.xml" },
  { name: "BBC हिंदी खेल", url: "https://feeds.bbci.co.uk/hindi/sport/rss.xml" },
  { name: "NDTV Sports", url: "https://feeds.feedburner.com/ndtvsports-latest" },
];

function parseFeed(xml, fallbackName) {
  const blocks = [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  const entries = blocks.length
    ? blocks
    : [...xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/g)].map((match) => match[1]);
  return entries.slice(0, 12).map((block) => {
    const published = tagValue(block, "pubDate") || tagValue(block, "published") || tagValue(block, "updated");
    const stamp = published ? new Date(published) : null;
    const linkTag = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i)?.[1] || tagValue(block, "link");
    return {
      title: tagValue(block, "title"),
      url: linkTag,
      source: fallbackName,
      date: stamp && !Number.isNaN(stamp.valueOf()) ? stamp.toISOString().slice(0, 10) : "",
    };
  });
}

const TOPIC_FEEDS = {
  tech: ["Indian Express Tech", "The Verge", "TechCrunch", "Gadgets 360"],
  टेक: ["Indian Express Tech", "The Verge", "TechCrunch", "Gadgets 360", "BBC हिंदी"],
  cricket: ["BBC हिंदी खेल", "NDTV Sports", "BBC हिंदी"],
  क्रिकेट: ["BBC हिंदी खेल", "NDTV Sports", "BBC हिंदी"],
  खेल: ["BBC हिंदी खेल", "NDTV Sports"],
  sports: ["BBC हिंदी खेल", "NDTV Sports"],
};

function feedsFor(query) {
  const lower = query.toLowerCase();
  for (const key of Object.keys(TOPIC_FEEDS)) {
    if (lower.includes(key)) {
      const names = TOPIC_FEEDS[key];
      const picked = NEWS_FEEDS.filter((feed) => names.includes(feed.name));
      if (picked.length) return picked;
    }
  }
  return NEWS_FEEDS;
}

async function feedNews(feeds = NEWS_FEEDS) {
  const settled = await Promise.allSettled(
    feeds.map(async (feed) => {
      const response = await fetch(feed.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ShaviAI/1.0)", Accept: "application/rss+xml, application/xml" },
      });
      if (!response.ok) return [];
      return parseFeed(await response.text(), feed.name);
    }),
  );
  return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

/** GDELT ka public news API — topic ke hisaab se taaza articles. */
async function gdeltNews(query) {
  const hindi = /[\u0900-\u097F]/.test(query);
  const lang = hindi ? "sourcelang:hindi" : "sourcelang:english";
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`${query.slice(0, 110)} ${lang}`)}&mode=artlist&format=json&maxrecords=8&timespan=2d&sort=datedesc`;
  const read = async () => {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ShaviAI/1.0)" } });
    if (!response.ok) return [];
    const text = await response.text();
    if (!text.trim().startsWith("{")) return [];
    try {
      const data = JSON.parse(text);
      return (data.articles || []).slice(0, 8).map((item) => {
        const raw = item.seendate || "";
        const stamp = raw ? new Date(raw.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z")) : null;
        return {
          title: (item.title || "").trim(),
          url: item.url || "",
          source: item.domain || (hindi ? "GDELT हिंदी" : "GDELT"),
          date: stamp && !Number.isNaN(stamp.valueOf()) ? stamp.toISOString().slice(0, 10) : "",
        };
      });
    } catch {
      return [];
    }
  };
  return read();
}

const STOP_WORDS = new Set(["आज", "की", "के", "का", "क्या", "है", "हैं", "और", "में", "से", "को", "par", "the", "and", "for", "with", "news", "latest", "today", "khabar", "खबरें", "खबर", "बताओ", "बड़ी", "3", "तीन"]);

const SYNONYMS = {
  tech: ["tech", "technology", "टेक", "गैजेट", "मोबाइल", "स्मार्टफोन", "iphone", "android", "एआई", "ai", "चिप"],
  टेक: ["टेक", "technology", "tech", "गैजेट", "मोबाइल", "स्मार्टफोन", "ai", "चिप"],
  cricket: ["cricket", "क्रिकेट", "ipl", "आईपीएल", "विराट", "रोहित", "बल्ले", "विकेट", "test match"],
  क्रिकेट: ["क्रिकेट", "cricket", "ipl", "आईपीएल", "विराट", "रोहित", "विकेट"],
  ai: ["ai", "एआई", "artificial intelligence", "chatgpt", "openai", "gemini", "मशीन लर्निंग"],
  share: ["share", "शेयर", "stock", "market", "nifty", "sensex", "बाज़ार"],
  शेयर: ["शेयर", "share", "stock", "nifty", "sensex", "बाज़ार"],
};

function keywordsOf(query) {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
  const expanded = new Set(words);
  for (const word of words) {
    for (const extra of SYNONYMS[word] || []) expanded.add(extra.toLowerCase());
  }
  return [...expanded];
}

async function newsSearch(query) {
  const items = [];
  try {
    items.push(...(await gdeltNews(query)));
  } catch {
    /* gdelt skip */
  }
  try {
    const words = keywordsOf(query);
    const chosen = feedsFor(query);
    const topicalNames = new Set(chosen === NEWS_FEEDS ? [] : chosen.map((feed) => feed.name));
    const feeds = await feedNews(chosen).then((all) =>
      all.map((item) => ({
        ...item,
        _score:
          (topicalNames.has(item.source) ? 1 : 0) +
          words.reduce((sum, word) => (item.title.toLowerCase().includes(word) ? sum + 1 : sum), 0),
      })),
    );
    items.push(...feeds);
  } catch {
    /* feed skip */
  }

  const seen = new Set();
  return items
    .filter((item) => {
      if (!item.title || !item.url) return false;
      const key = item.title.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => ((b._score || 0) - (a._score || 0)) || (b.date || "").localeCompare(a.date || ""))
    .slice(0, 6)
    .map(({ _score, ...item }) => item);
}

function formatNews(items) {
  return items
    .map((item, index) => `[${index + 1}] ${item.title}\nURL: ${item.url}\nस्रोत: ${item.source}${item.date ? ` · ${item.date}` : ""}`)
    .join("\n\n");
}

async function webSearch(query, env) {
  const sections = [];
  try {
    const news = await newsSearch(query);
    if (news.length) {
      const words = keywordsOf(query);
      const matched = words.some((word) => news.some((item) => item.title.toLowerCase().includes(word)));
      const note = words.length && !matched
        ? "ध्यान दो: इन फ़ीड्स में इस सवाल से सीधा जुड़ा कोई नतीजा नहीं मिला — जो नीचे है वह आज की सामान्य खबरें हैं, इन्हें इस सवाल का जवाब मत बनाओ। साफ़ बताओ कि इस विषय की पक्की लाइव जानकारी नहीं मिली।\n\n"
        : "";
      sections.push(`${note}ताज़ा खबरें (सार्वजनिक न्यूज़ फ़ीड्स — आज की):\n\n${formatNews(news)}`);
    }
  } catch {
    /* news skip */
  }
  if (env.EXA_API_KEY) {
    const result = await exaSearch(query, env);
    if (result !== SEARCH_EMPTY) sections.push(`वेब नतीजे:\n\n${result}`);
  } else if (env.TAVILY_API_KEY) {
    const result = await tavilySearch(query, env);
    if (result !== SEARCH_EMPTY) sections.push(`वेब नतीजे:\n\n${result}`);
  }
  return sections.join("\n\n") || SEARCH_EMPTY;
}

/* ------------------------------------------------------------------ youtube
 *
 * The YouTube Studio page (site /youtube/) reads a creator's PUBLIC channel data through this
 * Worker: browsers cannot fetch youtube.com directly (no CORS), and the studio should work
 * without a YouTube API key. Only public RSS + the public channel page are used; nothing is
 * logged in, scraped behind auth, or posted.
 */
const channelCache = new Map();
const CHANNEL_TTL = 15 * 60_000;

async function resolveChannelId(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("channel link या @handle भेजें");
  const direct = /(UC[0-9A-Za-z_-]{22})/.exec(raw);
  if (direct) return direct[1];

  let target = raw;
  if (!/^https?:\/\//i.test(raw)) {
    target = raw.startsWith("@") ? `https://www.youtube.com/${raw}` : `https://www.youtube.com/@${raw}`;
  }
  const res = await fetch(target, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ShaviAi/1.0; +https://vktechlearn.site)" },
  });
  if (!res.ok) throw new Error(`channel page ने ${res.status} लौटाया`);
  const html = await res.text();
  const found =
    /"externalId":"(UC[0-9A-Za-z_-]{22})"/.exec(html) ||
    /channel_id=(UC[0-9A-Za-z_-]{22})/.exec(html) ||
    /"browseId":"(UC[0-9A-Za-z_-]{22})"/.exec(html);
  if (!found) throw new Error("channel id नहीं मिला — पूरा channel link भेजें");
  return found[1];
}

function xmlText(block, tag) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
  return match ? match[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
}

async function readChannel(channelId) {
  const cached = channelCache.get(channelId);
  if (cached && Date.now() - cached.at < CHANNEL_TTL) return cached.data;

  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ShaviAi/1.0; +https://vktechlearn.site)" },
  });
  if (!res.ok) throw new Error(`RSS ने ${res.status} लौटाया`);
  const xml = await res.text();

  const channelTitle = xmlText(xml.split("<entry>")[0], "title");
  const videos = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const block = match[1];
    const views = /<media:statistics\s+views="(\d+)"/.exec(block);
    videos.push({
      id: xmlText(block, "yt:videoId"),
      title: xmlText(block, "title"),
      url: xmlText(block, "link") || (match[0].match(/<link[^>]*href="([^"]+)"/) || [])[1] || "",
      published: xmlText(block, "published"),
      views: views ? Number(views[1]) : null,
    });
  }

  const withViews = videos.filter((video) => typeof video.views === "number");
  const sorted = [...withViews].sort((a, b) => b.views - a.views);
  const viewList = withViews.map((video) => video.views).sort((a, b) => a - b);
  const median = viewList.length ? viewList[Math.floor(viewList.length / 2)] : null;
  const dates = videos.map((video) => Date.parse(video.published)).filter((value) => !Number.isNaN(value)).sort((a, b) => a - b);
  const gaps = dates.slice(1).map((value, index) => (value - dates[index]) / 86_400_000);
  const data = {
    channelId,
    title: channelTitle || channelId,
    url: `https://www.youtube.com/channel/${channelId}`,
    fetched_at: new Date().toISOString(),
    stats: {
      videos: videos.length,
      medianViews: median,
      averageViews: withViews.length ? Math.round(withViews.reduce((sum, video) => sum + video.views, 0) / withViews.length) : null,
      averageGapDays: gaps.length ? Math.round((gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length) * 10) / 10 : null,
      lastPublished: videos[0]?.published ?? null,
    },
    videos: sorted,
  };
  channelCache.set(channelId, { at: Date.now(), data });
  if (channelCache.size > 200) channelCache.clear();
  return data;
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
        { status: "ok", model, vision: env.AI_VISION_MODEL || DEFAULT_VISION_MODEL, image: IMAGE_MODEL, demo: !env.AI_API_KEY, search: true, news: "gdelt+rss", exa: Boolean(env.EXA_API_KEY), tavily: Boolean(env.TAVILY_API_KEY) },
        { headers },
      );
    }

    if (url.pathname === "/api/yt/channel") {
      try {
        const channelId = await resolveChannelId(url.searchParams.get("u"));
        const channel = await readChannel(channelId);
        return Response.json(channel, { headers: { ...headers, "Cache-Control": "public, max-age=900" } });
      } catch (error) {
        return Response.json({ error: "channel data नहीं मिला: " + String(error.message || error) }, { status: 502, headers });
      }
    }

    if (url.pathname === "/api/news") {
      const query = url.searchParams.get("q") || "technology";
      try {
        const [gdelt, feeds, items] = await Promise.all([
          gdeltNews(query).then((value) => value.length).catch((error) => String(error).slice(0, 80)),
          feedNews().then((value) => value.length).catch((error) => String(error).slice(0, 80)),
          newsSearch(query),
        ]);
        return Response.json({ query, count: items.length, gdelt, feeds, items }, { headers });
      } catch (error) {
        return Response.json({ query, error: String(error).slice(0, 200) }, { status: 502, headers });
      }
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

    const latestQuestion = messages[messages.length - 1].content;
    const today = new Date().toISOString().slice(0, 10);

    if (!images.length && NEWS_HINT.test(latestQuestion)) {
      const direct = await webSearch(latestQuestion, env).catch(() => SEARCH_EMPTY);
      if (direct !== SEARCH_EMPTY) {
        const lastIndex = working.length - 1;
        working[lastIndex] = {
          role: "user",
          content: `${latestQuestion}\n\n---\nआज की तारीख: ${today}\nये अभी लिए गए लाइव सर्च नतीजे हैं (इन्हीं के आधार पर जवाब दो। हर खबर के नीचे उसका असली लिंक दो। अंत में "स्रोत" में हर लाइन ऐसे लिखो: [1] [शीर्षक](पूरा लिंक) — तारीख):\n\n${direct}`,
        };
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
