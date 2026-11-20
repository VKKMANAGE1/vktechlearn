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

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || "https://vktechlearn.site,https://www.vktechlearn.site")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function originOk(env, origin) {
  if (!origin) return true;
  return (
    allowedOrigins(env).includes(origin) ||
    origin.endsWith(".style.dev") ||
    origin.endsWith(".freebuff.page") ||
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1")
  );
}

function cors(env, request) {
  const configured = allowedOrigins(env);
  const origin = request.headers.get("Origin") || "";
  const allowed = originOk(env, origin);
  return {
    "Access-Control-Allow-Origin": allowed && origin ? origin : configured[0],
    ...(allowed && origin ? { "Access-Control-Allow-Credentials": "true" } : {}),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-YT-Token",
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

/* ---------------------------------------------- youtube autopilot: connect once
 *
 * Studio का "Channel connect" बटन /api/yt/oauth/start खोलता है. Google की सहमति के बाद
 * /api/yt/oauth/callback code को refresh token में बदलकर D1 में रखता है — browser को कभी
 * token नहीं मिलता. उसके बाद GitHub Actions वाला autopilot (tools/yt-autopilot/) हर run में
 * /api/yt/token से छोटा access token लेता है, अपने ही channel के videos से clips बनाकर
 * upload करता है और /api/yt/log में हिसाब लिखता है.
 *
 * हर user का अपना खाता: वह studio में अपनी Google OAuth client (client id + secret) एक बार
 * सेव करता है, Google से जुड़ता है, और उसका channel + refresh token उसी uid के नीचे D1 में
 * रहता है. पहचान एक signed httpOnly cookie ("shavi_uid") से होती है — secret D1 में बनता है,
 * इसलिए Worker में कोई Google key सेट किए बिना भी कई users चल सकते हैं. client secret
 * browser को कभी वापस नहीं भेजा जाता.
 *
 * Secrets (Sites → Secrets) — सब optional:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  default OAuth client (user अपनी न डाले तो)
 *   YT_STATE_KEY                            optional, OAuth state/cookie sign करने के लिए
 *   AUTOPILOT_KEY                           optional shared key (GitHub OIDC न हो तो)
 *   GH_TOKEN, GH_REPO                       optional, "अभी चलाओ" बटन workflow चलाने के लिए
 * Binding: DB (D1) — हर user की keys, token, run history और dedupe ledger.
 *
 * Actions किसी secret के बिना खुद को साबित करता है: workflow GitHub OIDC token भेजता है
 * (audience shavi-autopilot) और यहाँ JWT की signature, issuer, audience और repository
 * जाँची जाती है. इसलिए GitHub में कुई key रखने की ज़रूरत नहीं.
 */
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const YT_API = "https://www.googleapis.com/youtube/v3";
const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];
// D1 का exec एक-एक line को अलग statement मानता है, इसलिए हर statement अलग prepare().run().
// yt_auth सिर्फ़ पुराने (single-channel) setup के लिए बचा है; नया सब कुछ yt_users में uid के नीचे.
const YT_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS yt_auth (id INTEGER PRIMARY KEY, channel_id TEXT, channel_title TEXT, channel_thumb TEXT, refresh_token TEXT, connected_at TEXT)",
  "CREATE TABLE IF NOT EXISTS yt_users (uid TEXT PRIMARY KEY, channel_id TEXT, channel_title TEXT, channel_thumb TEXT, email TEXT, client_id TEXT, client_secret TEXT, refresh_token TEXT, connected_at TEXT, updated_at TEXT)",
  "CREATE TABLE IF NOT EXISTS yt_setups (sid TEXT PRIMARY KEY, client_id TEXT, client_secret TEXT, created_at TEXT)",
  "CREATE TABLE IF NOT EXISTS yt_settings (key TEXT PRIMARY KEY, value TEXT)",
  "CREATE TABLE IF NOT EXISTS yt_logins (token TEXT PRIMARY KEY, uid TEXT, created_at TEXT, last_seen TEXT)",
  "CREATE TABLE IF NOT EXISTS yt_tickets (ticket TEXT PRIMARY KEY, uid TEXT, created_at TEXT)",
  "CREATE TABLE IF NOT EXISTS yt_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, source_id TEXT, source_title TEXT, status TEXT, note TEXT, clips INTEGER DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS yt_clips (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, source_id TEXT, source_title TEXT, start_s REAL, end_s REAL, video_id TEXT, title TEXT)",
  "ALTER TABLE yt_runs ADD COLUMN uid TEXT",
  "ALTER TABLE yt_clips ADD COLUMN uid TEXT",
];

let ytSchemaReady = false;
let ytCookieKey = "";
const runHits = new Map();

async function ytDb(env) {
  if (!env.DB) throw new Error("D1 binding 'DB' नहीं है — Sites → Storage में database जोड़ें");
  if (!ytSchemaReady) {
    for (const sql of YT_SCHEMA) {
      try {
        await env.DB.prepare(sql).run();
      } catch (error) {
        if (!/duplicate column|already exists/i.test(String(error?.message || error))) throw error;
      }
    }
    ytSchemaReady = true;
  }
  return env.DB;
}

/* ---- पहचान: signed httpOnly cookie; signing key D1 में एक बार बनती है ---- */

const COOKIE_UID = "shavi_uid";
const COOKIE_SETUP = "shavi_setup";
const COOKIE_AGE = 365 * 24 * 3600;

function parseCookies(request) {
  const jar = {};
  for (const part of String(request.headers.get("Cookie") || "").split(";")) {
    const cut = part.indexOf("=");
    if (cut < 1) continue;
    const name = part.slice(0, cut).trim();
    const raw = part.slice(cut + 1).trim();
    try {
      jar[name] = decodeURIComponent(raw);
    } catch {
      jar[name] = raw;
    }
  }
  return jar;
}

async function cookieSecret(env) {
  if (ytCookieKey) return ytCookieKey;
  const db = await ytDb(env);
  let row = await db.prepare("SELECT value FROM yt_settings WHERE key = 'cookie_secret'").first();
  if (!row?.value) {
    await db
      .prepare("INSERT INTO yt_settings (key, value) VALUES ('cookie_secret', ?1) ON CONFLICT(key) DO NOTHING")
      .bind(b64url(crypto.getRandomValues(new Uint8Array(32))))
      .run();
    row = await db.prepare("SELECT value FROM yt_settings WHERE key = 'cookie_secret'").first();
  }
  ytCookieKey = String(row?.value || "");
  if (!ytCookieKey) throw new Error("session key नहीं बन पाई");
  return ytCookieKey;
}

async function signCookie(env, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(await cookieSecret(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return `${value}.${signature}`;
}

async function readCookie(env, request, name) {
  const raw = parseCookies(request)[name];
  if (!raw) return "";
  const cut = raw.lastIndexOf(".");
  if (cut < 1) return "";
  const value = raw.slice(0, cut);
  if ((await signCookie(env, value)) !== raw) return "";
  return value;
}

function cookieHeader(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`;
}

/* ---- login token: page इसे localStorage में रखता है, हर request में header से भेजता है ----
 *
 * cookie तीसरे domain (Worker) की होती है, इसलिए Safari/Firefox और third-party cookies block
 * करने वाले Chrome में वह अक्सर सेव ही नहीं होती — और user को keys हर बार दोबारा डालनी पड़ती थीं.
 * इसलिए असली पहचान token है: keys सेव करते समय एक बार बनता है, page उसे first-party
 * localStorage में रखता है, और हर call में X-YT-Token header से भेजता है. वही token “login code”
 * है जो दूसरे device/browser पर एक बार डालकर वही खाता मिल जाता है. cookie सिर्फ़ fallback रहती है.
 */
const LOGIN_HEADER = "X-YT-Token";

async function loginUid(env, request) {
  const token = (request.headers.get(LOGIN_HEADER) || "").trim();
  if (token.length < 20) return "";
  try {
    const db = await ytDb(env);
    const row = await db.prepare("SELECT uid FROM yt_logins WHERE token = ?1").bind(token).first();
    if (!row?.uid) return "";
    const user = await db.prepare("SELECT uid FROM yt_users WHERE uid = ?1").bind(row.uid).first();
    if (!user) return "";
    await db.prepare("UPDATE yt_logins SET last_seen = ?2 WHERE token = ?1").bind(token, new Date().toISOString()).run();
    return row.uid;
  } catch {
    return "";
  }
}

/** इस खाते का login token — है तो वही, नहीं तो नया (एक बार). */
async function issueLogin(env, uid) {
  if (!uid) return "";
  const db = await ytDb(env);
  const existing = await db.prepare("SELECT token FROM yt_logins WHERE uid = ?1 ORDER BY created_at LIMIT 1").bind(uid).first();
  if (existing?.token) return existing.token;
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO yt_logins (token, uid, created_at, last_seen) VALUES (?1, ?2, ?3, ?3)").bind(token, uid, now).run();
  return token;
}

async function currentUid(env, request) {
  const byToken = await loginUid(env, request);
  if (byToken) return byToken;
  try {
    const uid = await readCookie(env, request, COOKIE_UID);
    if (!uid) return "";
    const row = await (await ytDb(env)).prepare("SELECT uid FROM yt_users WHERE uid = ?1").bind(uid).first();
    return row ? uid : "";
  } catch {
    return "";
  }
}

const cleanKey = (value, limit = 300) => String(value || "").replace(/\s+/g, "").slice(0, limit);

async function userKeys(env, uid) {
  if (!uid) return null;
  const row = await (await ytDb(env)).prepare("SELECT client_id, client_secret FROM yt_users WHERE uid = ?1").bind(uid).first();
  if (row?.client_id && row?.client_secret) return { id: row.client_id, secret: row.client_secret, source: "account" };
  return null;
}

async function setupKeys(env, request) {
  try {
    const sid = await readCookie(env, request, COOKIE_SETUP);
    if (!sid) return null;
    const row = await (await ytDb(env)).prepare("SELECT sid, client_id, client_secret FROM yt_setups WHERE sid = ?1").bind(sid).first();
    if (row?.client_id && row?.client_secret) return { id: row.client_id, secret: row.client_secret, source: "browser", sid: row.sid };
  } catch {
    /* ignore */
  }
  return null;
}

/** इस request के लिए कौन-सी OAuth client: खाते की → इस browser की → Worker env की. */
async function clientFor(env, request) {
  const uid = await currentUid(env, request);
  const own = await userKeys(env, uid);
  if (own) return { ...own, uid };
  const setup = await setupKeys(env, request);
  if (setup) return { ...setup, uid };
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET, source: "worker", uid };
  }
  return { id: "", secret: "", source: "", uid };
}

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const unb64url = (text) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0)),
  );

async function stateHmac(env, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.YT_STATE_KEY || (await cookieSecret(env))),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

async function signState(env, data) {
  const payload = JSON.stringify({ ...data, t: Date.now() });
  return `${b64url(new TextEncoder().encode(payload))}.${await stateHmac(env, payload)}`;
}

async function verifyState(env, state) {
  const [encoded, signature] = String(state || "").split(".");
  if (!encoded || !signature) throw new Error("OAuth state अधूरा है");
  const payload = unb64url(encoded);
  if ((await stateHmac(env, payload)) !== signature) throw new Error("OAuth state का हस्ताक्षर गलत है");
  const data = JSON.parse(payload);
  if (Date.now() - Number(data.t) > 30 * 60_000) throw new Error("OAuth state पुराना है, दोबारा connect करें");
  return { r: String(data.r || ""), s: String(data.s || ""), u: String(data.u || "") };
}

function ytRedirect(url) {
  return `${url.origin}/api/yt/oauth/callback`;
}

function isReturnUrl(value) {
  const text = String(value || "");
  return (
    /^https:\/\/(vktechlearn\.site|www\.vktechlearn\.site|[a-z0-9-]+\.style\.dev|[a-z0-9-]+\.freebuff\.page)\//i.test(text) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(text)
  );
}

/** Google खाते का email — सिर्फ़ दिखाने के लिए; scope न मिले तो खाली छोड़ दो. */
async function googleEmail(access) {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${access}` } });
    if (!res.ok) return "";
    const data = await res.json();
    return String(data.email || "").slice(0, 160);
  } catch {
    return "";
  }
}

async function googleToken(env, body) {
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${data.error || res.status}: ${data.error_description || "token नहीं मिला"}`);
  }
  return data;
}

async function ytIdentity(access) {
  const res = await fetch(`${YT_API}/channels?part=snippet,statistics&mine=true`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`channels.list ${res.status}: ${JSON.stringify(data).slice(0, 160)}`);
  const channel = (data.items || [])[0];
  if (!channel) throw new Error("इस Google खाते से कोई YouTube channel जुड़ा नहीं है");
  return {
    id: channel.id,
    title: channel.snippet?.title || channel.id,
    thumb: channel.snippet?.thumbnails?.default?.url || "",
    subscribers: channel.statistics?.subscriberCount ?? null,
  };
}

const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const OIDC_AUDIENCE = "shavi-autopilot";
const OIDC_REPO = "VKKMANAGE1/vktechlearn";
let oidcKeys = { at: 0, list: [] };

const fromB64url = (text) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));

async function oidcJwks() {
  if (oidcKeys.list.length && Date.now() - oidcKeys.at < 6 * 3600_000) return oidcKeys.list;
  const res = await fetch(`${OIDC_ISSUER}/.well-known/jwks`);
  if (!res.ok) throw new Error(`JWKS ${res.status}`);
  const data = await res.json();
  oidcKeys = { at: Date.now(), list: Array.isArray(data.keys) ? data.keys : [] };
  return oidcKeys.list;
}

/** GitHub Actions से आया OIDC token सिर्फ़ इसी repo का, इसी audience का, और ज़िंदा होना चाहिए. */
async function oidcOk(request, env) {
  const token = (request.headers.get("X-Shavi-Oidc") || "").trim();
  const [rawHeader, rawPayload, rawSig] = token.split(".");
  if (!rawHeader || !rawPayload || !rawSig) return false;
  try {
    const header = JSON.parse(new TextDecoder().decode(fromB64url(rawHeader)));
    const jwk = (await oidcJwks()).find((key) => key.kid === header.kid);
    if (!jwk || jwk.kty !== "RSA") return false;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      fromB64url(rawSig),
      new TextEncoder().encode(`${rawHeader}.${rawPayload}`),
    );
    if (!valid) return false;
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(rawPayload)));
    return (
      claims.iss === OIDC_ISSUER &&
      claims.aud === OIDC_AUDIENCE &&
      claims.repository === (env.GH_REPO || OIDC_REPO) &&
      Number(claims.exp) > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

async function authorized(request, env) {
  const supplied = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const expected = String(env.AUTOPILOT_KEY || "").trim();
  if (expected && supplied.length === expected.length) {
    let diff = 0;
    for (let index = 0; index < expected.length; index += 1) diff |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
    if (diff === 0) return true;
  }
  return oidcOk(request, env);
}

async function dispatchAutopilot(env, dryRun, uid) {
  if (!env.GH_TOKEN) throw new Error("GH_TOKEN सेट नहीं है — Actions tab से ‘Run workflow’ चलाएँ");
  const repo = env.GH_REPO || "VKKMANAGE1/vktechlearn";
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/yt-autopilot.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "ShaviAutopilot/1.0",
    },
    body: JSON.stringify({ ref: env.GH_REF || "main", inputs: { dry_run: dryRun ? "true" : "false", user: String(uid || "") } }),
  });
  if (res.status !== 204) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`GitHub ने ${res.status} लौटाया ${detail}`);
  }
  return `https://github.com/${repo}/actions/workflows/yt-autopilot.yml`;
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

    if (url.pathname === "/api/yt/keys") {
      if (request.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405, headers });
      if (!originOk(env, request.headers.get("Origin") || "")) {
        return Response.json({ error: "इस origin से keys सेव नहीं हो सकतीं" }, { status: 403, headers });
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "JSON body चाहिए" }, { status: 400, headers });
      }
      const clientId = cleanKey(body.client_id, 220);
      const clientSecret = cleanKey(body.client_secret, 220);
      if (clientId.length < 20 || !clientId.includes(".apps.googleusercontent.com")) {
        return Response.json({ error: "client ID गलत लग रहा है — वह …apps.googleusercontent.com पर खत्म होता है" }, { status: 400, headers });
      }
      if (clientSecret.length < 10) {
        return Response.json({ error: "client secret छोटा/खाली है — Google Cloud में बनाई गई GOCSPX-… value डालें" }, { status: 400, headers });
      }
      try {
        const db = await ytDb(env);
        const now = new Date().toISOString();
        let uid = await currentUid(env, request);
        if (!uid) {
          uid = b64url(crypto.getRandomValues(new Uint8Array(12)));
          await db.prepare("INSERT INTO yt_users (uid, updated_at) VALUES (?1, ?2)").bind(uid, now).run();
        }
        const current = await db
          .prepare("SELECT client_id, client_secret, refresh_token FROM yt_users WHERE uid = ?1")
          .bind(uid)
          .first();
        // पुरानी keys से मिला refresh token नई keys के साथ काम नहीं करेगा — बदली keys पर reconnect.
        const changed = Boolean(current && (current.client_id !== clientId || current.client_secret !== clientSecret));
        await db
          .prepare("UPDATE yt_users SET client_id = ?2, client_secret = ?3, refresh_token = ?4, updated_at = ?5 WHERE uid = ?1")
          .bind(uid, clientId, clientSecret, changed ? null : current?.refresh_token ?? null, now)
          .run();
        // login token: page इसे localStorage में रखता है, इसलिए cookie block होने पर भी keys नहीं पूछी जातीं.
        const token = await issueLogin(env, uid);
        return Response.json(
          { saved: true, scope: "account", clientId, uid, token, needsReconnect: changed && Boolean(current?.refresh_token) },
          {
            headers: {
              ...headers,
              "Cache-Control": "no-store",
              "Set-Cookie": cookieHeader(COOKIE_UID, await signCookie(env, uid), COOKIE_AGE),
            },
          },
        );
      } catch (error) {
        return Response.json({ error: String(error.message || error) }, { status: 500, headers });
      }
    }

    if (url.pathname === "/api/yt/login") {
      if (request.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405, headers });
      if (!originOk(env, request.headers.get("Origin") || "")) {
        return Response.json({ error: "इस origin से login नहीं हो सकता" }, { status: 403, headers });
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "JSON body चाहिए" }, { status: 400, headers });
      }
      const token = String(body.token || "").trim();
      if (token.length < 20) return Response.json({ error: "login code अधूरा है — पूरा code copy करें" }, { status: 400, headers });
      try {
        const db = await ytDb(env);
        const row = await db.prepare("SELECT uid FROM yt_logins WHERE token = ?1").bind(token).first();
        if (!row?.uid) return Response.json({ error: "यह login code नहीं मिला — पुराने device से दोबारा copy करें" }, { status: 401, headers });
        const keys = await userKeys(env, row.uid);
        return Response.json(
          { ok: true, keysSaved: Boolean(keys?.id), clientId: keys?.id || "" },
          {
            headers: {
              ...headers,
              "Cache-Control": "no-store",
              "Set-Cookie": cookieHeader(COOKIE_UID, await signCookie(env, row.uid), COOKIE_AGE),
            },
          },
        );
      } catch (error) {
        return Response.json({ error: String(error.message || error) }, { status: 500, headers });
      }
    }

    if (url.pathname === "/api/yt/connect") {
      if (request.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405, headers });
      if (!originOk(env, request.headers.get("Origin") || "")) {
        return Response.json({ error: "इस origin से connect नहीं हो सकता" }, { status: 403, headers });
      }
      const keys = await clientFor(env, request);
      if (!keys.id || !keys.secret) {
        return Response.json({ error: "पहले अपनी GOOGLE_CLIENT_ID और GOOGLE_CLIENT_SECRET सेव करें" }, { status: 409, headers });
      }
      let body = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }
      const requested = String(body.return || "");
      const returnUrl = isReturnUrl(requested) ? requested : "https://vktechlearn.site/youtube/";
      try {
        const db = await ytDb(env);
        const now = new Date().toISOString();
        // Google पर जाने वाला URL navigation है (header नहीं भेज सकते), इसलिए एक बार का ticket.
        const ticket = b64url(crypto.getRandomValues(new Uint8Array(18)));
        await db.prepare("INSERT INTO yt_tickets (ticket, uid, created_at) VALUES (?1, ?2, ?3)").bind(ticket, keys.uid || null, now).run();
        await db.prepare("DELETE FROM yt_tickets WHERE created_at < ?1").bind(new Date(Date.now() - 30 * 60_000).toISOString()).run();
        return Response.json(
          { url: `${url.origin}/api/yt/oauth/start?t=${ticket}&return=${encodeURIComponent(returnUrl)}` },
          { headers: { ...headers, "Cache-Control": "no-store" } },
        );
      } catch (error) {
        return Response.json({ error: String(error.message || error) }, { status: 500, headers });
      }
    }

    if (url.pathname === "/api/yt/oauth/start") {
      const ticket = String(url.searchParams.get("t") || "").trim();
      let ticketUid = "";
      let keys = null;
      if (ticket) {
        try {
          const db = await ytDb(env);
          const row = await db.prepare("SELECT uid FROM yt_tickets WHERE ticket = ?1").bind(ticket).first();
          if (row) {
            ticketUid = String(row.uid || "");
            await db.prepare("DELETE FROM yt_tickets WHERE ticket = ?1").bind(ticket).run();
            keys = await userKeys(env, ticketUid);
          }
        } catch {
          /* ticket काम न आए तो नीचे सामान्य रास्ता */
        }
      }
      if (!keys) keys = await clientFor(env, request);
      if (!keys.id || !keys.secret) {
        return Response.json(
          { error: "पहले अपनी GOOGLE_CLIENT_ID और GOOGLE_CLIENT_SECRET नीचे box में डालकर Save करें — फिर channel connect होगा" },
          { status: 503, headers },
        );
      }
      const fallback = "https://vktechlearn.site/youtube/";
      const requested = url.searchParams.get("return") || fallback;
      const returnUrl = isReturnUrl(requested) ? requested : fallback;
      const state = await signState(env, { r: returnUrl, s: keys.source === "browser" ? keys.sid : "", u: ticketUid || keys.uid || "" });
      const target = new URL(GOOGLE_AUTH);
      target.searchParams.set("client_id", keys.id);
      target.searchParams.set("redirect_uri", ytRedirect(url));
      target.searchParams.set("response_type", "code");
      target.searchParams.set("scope", YT_SCOPES.join(" "));
      target.searchParams.set("access_type", "offline");
      target.searchParams.set("prompt", "consent");
      target.searchParams.set("include_granted_scopes", "true");
      target.searchParams.set("state", state);
      return Response.redirect(target.toString(), 302);
    }

    if (url.pathname === "/api/yt/oauth/callback") {
      let state;
      try {
        state = await verifyState(env, url.searchParams.get("state"));
      } catch (error) {
        return Response.json({ error: String(error.message || error) }, { status: 400, headers });
      }
      const returnUrl = isReturnUrl(state.r) ? state.r : "https://vktechlearn.site/youtube/";
      const denied = url.searchParams.get("error");
      if (denied) {
        return new Response(null, { status: 302, headers: { Location: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}yt=denied` } });
      }
      const code = url.searchParams.get("code");
      if (!code) return Response.json({ error: "code नहीं मिला" }, { status: 400, headers });
      try {
        const db = await ytDb(env);
        let keys = null;
        if (state.s) {
          const setup = await db.prepare("SELECT client_id, client_secret FROM yt_setups WHERE sid = ?1").bind(state.s).first();
          if (setup?.client_id) keys = { id: setup.client_id, secret: setup.client_secret };
        }
        if (!keys) keys = await userKeys(env, state.u || (await currentUid(env, request)));
        if (!keys && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
          keys = { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET };
        }
        if (!keys) throw new Error("OAuth keys नहीं मिलीं — दोबारा keys सेव करके connect करें");
        const tokens = await googleToken(env, {
          code,
          client_id: keys.id,
          client_secret: keys.secret,
          redirect_uri: ytRedirect(url),
          grant_type: "authorization_code",
        });
        if (!tokens.refresh_token) throw new Error("Google ने refresh token नहीं दिया — दोबारा connect करें");
        const channel = await ytIdentity(tokens.access_token);
        const email = await googleEmail(tokens.access_token);
        const existing = await db.prepare("SELECT uid FROM yt_users WHERE channel_id = ?1").bind(channel.id).first();
        // इसी login (state.u) में channel जोड़ो, ताकि keys और channel एक ही खाते में रहें.
        const uid = state.u || existing?.uid || b64url(crypto.getRandomValues(new Uint8Array(12)));
        const now = new Date().toISOString();
        if (existing?.uid && existing.uid !== uid) {
          // वही channel दो खातों में न दिखे — पुरानी row से channel/token हटा दो.
          await db
            .prepare("UPDATE yt_users SET channel_id = NULL, channel_title = NULL, channel_thumb = NULL, refresh_token = NULL, updated_at = ?2 WHERE uid = ?1")
            .bind(existing.uid, now)
            .run();
        }
        await db
          .prepare(
            `INSERT INTO yt_users (uid, channel_id, channel_title, channel_thumb, email, client_id, client_secret, refresh_token, connected_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
             ON CONFLICT(uid) DO UPDATE SET channel_id = ?2, channel_title = ?3, channel_thumb = ?4,
               email = COALESCE(?5, email), client_id = ?6, client_secret = ?7, refresh_token = ?8, updated_at = ?9`,
          )
          .bind(uid, channel.id, channel.title, channel.thumb, email || null, keys.id, keys.secret, tokens.refresh_token, now)
          .run();
        const response = new Response(null, {
          status: 302,
          headers: { Location: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}yt=connected&ch=${encodeURIComponent(channel.title)}` },
        });
        response.headers.append("Set-Cookie", cookieHeader(COOKIE_UID, await signCookie(env, uid), COOKIE_AGE));
        if (state.s) {
          response.headers.append("Set-Cookie", cookieHeader(COOKIE_SETUP, "", 0));
          await db.prepare("DELETE FROM yt_setups WHERE sid = ?1").bind(state.s).run();
        }
        return response;
      } catch (error) {
        return Response.json({ error: `connect पूरा नहीं हुआ: ${String(error.message || error)}` }, { status: 502, headers });
      }
    }

    if (url.pathname === "/api/yt/status") {
      const ytBase = {
        connected: false,
        oauth: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        storage: Boolean(env.DB),
        dispatch: Boolean(env.GH_TOKEN),
        loggedIn: false,
        keysSaved: false,
        keysSource: "",
        clientId: "",
        redirectUri: ytRedirect(url),
      };
      try {
        const db = await ytDb(env);
        const uid = await currentUid(env, request);
        const keys = await clientFor(env, request);
        const auth = uid
          ? await db
              .prepare("SELECT uid, channel_id, channel_title, channel_thumb, email, connected_at, refresh_token FROM yt_users WHERE uid = ?1")
              .bind(uid)
              .first()
          : null;
        const live = Boolean(auth?.refresh_token);
        const runs = uid
          ? (await db.prepare("SELECT at, source_title, status, note, clips FROM yt_runs WHERE uid = ?1 ORDER BY id DESC LIMIT 5").bind(uid).all()).results || []
          : [];
        const clips = uid
          ? (await db.prepare("SELECT at, source_title, start_s AS start, end_s AS end, video_id, title FROM yt_clips WHERE uid = ?1 ORDER BY id DESC LIMIT 12").bind(uid).all()).results || []
          : [];
        const totals = uid ? await db.prepare("SELECT COUNT(*) AS clips FROM yt_clips WHERE uid = ?1").bind(uid).first() : null;
        return Response.json(
          {
            ...ytBase,
            oauth: Boolean(keys.id && keys.secret),
            loggedIn: Boolean(uid),
            keysSaved: Boolean(keys.id),
            keysSource: keys.source,
            clientId: keys.id || "",
            connected: live,
            channel: live
              ? { id: auth.channel_id, title: auth.channel_title, thumb: auth.channel_thumb, email: auth.email, connectedAt: auth.connected_at }
              : null,
            published: totals?.clips ?? 0,
            runs,
            clips: clips.map((clip) => ({ ...clip, url: clip.video_id ? `https://youtube.com/shorts/${clip.video_id}` : "" })),
          },
          { headers: { ...headers, "Cache-Control": "no-store" } },
        );
      } catch (error) {
        return Response.json({ ...ytBase, error: String(error.message || error) }, { headers: { ...headers, "Cache-Control": "no-store" } });
      }
    }

    if (url.pathname === "/api/yt/users") {
      if (!(await authorized(request, env))) return Response.json({ error: "unauthorized" }, { status: 401, headers });
      try {
        const db = await ytDb(env);
        const rows =
          (await db
            .prepare("SELECT uid, channel_id, channel_title FROM yt_users WHERE refresh_token IS NOT NULL AND client_id IS NOT NULL ORDER BY connected_at")
            .all()).results || [];
        return Response.json({ users: rows }, { headers: { ...headers, "Cache-Control": "no-store" } });
      } catch (error) {
        return Response.json({ error: String(error.message || error) }, { status: 500, headers });
      }
    }

    if (url.pathname === "/api/yt/token") {
      if (!(await authorized(request, env))) return Response.json({ error: "unauthorized" }, { status: 401, headers });
      try {
        const uid = String(url.searchParams.get("u") || "").trim();
        const db = await ytDb(env);
        const auth = uid
          ? await db
              .prepare("SELECT uid, channel_id, channel_title, refresh_token, client_id, client_secret FROM yt_users WHERE uid = ?1")
              .bind(uid)
              .first()
          : await db
              .prepare("SELECT channel_id, channel_title, refresh_token, client_id, client_secret FROM yt_auth WHERE id = 1")
              .first();
        if (!auth?.refresh_token) {
          return Response.json({ error: "channel connect नहीं है — studio में Google से जोड़ें" }, { status: 409, headers });
        }
        const clientId = auth.client_id || env.GOOGLE_CLIENT_ID;
        const clientSecret = auth.client_secret || env.GOOGLE_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          return Response.json({ error: "इस channel के Google keys नहीं हैं — studio में दोबारा जोड़ें" }, { status: 409, headers });
        }
        let tokens;
        try {
          tokens = await googleToken(env, {
            refresh_token: auth.refresh_token,
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "refresh_token",
          });
        } catch (error) {
          return Response.json({ error: `reconnect: ${String(error.message || error)}` }, { status: 409, headers });
        }
        return Response.json(
          {
            access_token: tokens.access_token,
            expires_in: tokens.expires_in ?? 3600,
            uid: auth.uid ?? null,
            channel_id: auth.channel_id,
            channel_title: auth.channel_title,
          },
          { headers: { ...headers, "Cache-Control": "no-store" } },
        );
      } catch (error) {
        return Response.json({ error: String(error.message || error) }, { status: 500, headers });
      }
    }

    if (url.pathname === "/api/yt/ledger") {
      if (!(await authorized(request, env))) return Response.json({ error: "unauthorized" }, { status: 401, headers });
      try {
        const uid = String(url.searchParams.get("u") || "").trim();
        const db = await ytDb(env);
        const sources = uid
          ? await db.prepare("SELECT DISTINCT source_id FROM yt_clips WHERE uid = ?1 AND source_id IS NOT NULL").bind(uid).all()
          : await db.prepare("SELECT DISTINCT source_id FROM yt_clips WHERE uid IS NULL AND source_id IS NOT NULL").all();
        const clips = uid
          ? await db.prepare("SELECT source_id, start_s AS start, end_s AS end FROM yt_clips WHERE uid = ?1 ORDER BY id DESC LIMIT 200").bind(uid).all()
          : await db.prepare("SELECT source_id, start_s AS start, end_s AS end FROM yt_clips WHERE uid IS NULL ORDER BY id DESC LIMIT 200").all();
        return Response.json({ sources: (sources.results || []).map((row) => row.source_id), clips: clips.results || [] }, { headers });
      } catch (error) {
        return Response.json({ error: String(error.message || error) }, { status: 500, headers });
      }
    }

    if (url.pathname === "/api/yt/log") {
      if (!(await authorized(request, env))) return Response.json({ error: "unauthorized" }, { status: 401, headers });
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "JSON body चाहिए" }, { status: 400, headers });
      }
      try {
        const db = await ytDb(env);
        const now = new Date().toISOString();
        const uid = String(body.u || "").trim() || null;
        const run = body.run || {};
        await db
          .prepare("INSERT INTO yt_runs (at, source_id, source_title, status, note, clips, uid) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
          .bind(now, run.source_id ?? null, run.source_title ?? null, run.status ?? "unknown", String(run.note ?? "").slice(0, 400), Number(run.clips ?? 0), uid)
          .run();
        for (const clip of Array.isArray(body.clips) ? body.clips : []) {
          await db
            .prepare("INSERT INTO yt_clips (at, source_id, source_title, start_s, end_s, video_id, title, uid) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
            .bind(now, clip.source_id ?? null, clip.source_title ?? null, Number(clip.start ?? 0), Number(clip.end ?? 0), clip.video_id ?? null, String(clip.title ?? "").slice(0, 200), uid)
            .run();
        }
        return Response.json({ ok: true }, { headers });
      } catch (error) {
        return Response.json({ error: String(error.message || error) }, { status: 500, headers });
      }
    }

    if (url.pathname === "/api/yt/run") {
      if (request.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405, headers });
      if (!originOk(env, request.headers.get("Origin") || "")) {
        return Response.json({ error: "इस origin से run नहीं हो सकता" }, { status: 403, headers });
      }
      const uid = await currentUid(env, request);
      if (!uid) return Response.json({ error: "पहले अपनी Google keys सेव करके channel जोड़ें — फिर ‘अभी चलाओ’ काम करेगा" }, { status: 409, headers });
      const db = await ytDb(env);
      const auth = await db.prepare("SELECT refresh_token FROM yt_users WHERE uid = ?1").bind(uid).first();
      if (!auth?.refresh_token) return Response.json({ error: "channel जुड़ा नहीं — पहले खाते से Google जोड़ें" }, { status: 409, headers });
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const last = runHits.get(ip) || 0;
      if (Date.now() - last < 10 * 60_000) {
        return Response.json({ error: "अभी-अभी चलाया है — 10 मिनट बाद या Actions tab से चलाएँ" }, { status: 429, headers });
      }
      let dryRun = false;
      try {
        dryRun = Boolean((await request.json()).dry_run);
      } catch {
        dryRun = false;
      }
      try {
        const link = await dispatchAutopilot(env, dryRun, uid);
        runHits.set(ip, Date.now());
        if (runHits.size > 2000) runHits.clear();
        return Response.json({ dispatched: true, dry_run: dryRun, actions: link }, { headers });
      } catch (error) {
        return Response.json({ error: String(error.message || error) }, { status: 502, headers });
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
