/* ShâVì YouTube Studio — static page.
 *
 * Two modes share one page:
 *   Auto Pilot  channel link -> real public channel data -> audit -> hooks (scored by
 *               hookscore.py) -> titles (linted by title.py) -> script -> SEO -> Shorts ->
 *               plan, all run one after another and assembled into one downloadable package.
 *   Manual       the eleven skills and their six tools, one at a time.
 *
 * The Python tools run unmodified in the browser via Pyodide; the prompts go to the ShâVì Ai
 * Worker (same backend as /shavi-ai/). Nothing is published from here.
 */
const API_BASE = "https://site-d28594350583452e987524c38e89b7a9.freebuff.page";
const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const VOICE_KEY = "shavi-yt-voice-v1";
const PACKAGE_KEY = "shavi-yt-package-v1";

const SKILL_IDS = [
  "yt-script",
  "yt-package",
  "yt-edit",
  "yt-comment",
  "yt-plan",
  "yt-viral",
  "yt-retention",
  "yt-shorts",
  "yt-seo",
  "yt-chapters",
  "yt-audit",
];

const TOOLS = {
  "yt-script": { file: "hookscore.py", ext: "txt", hint: "एक hook प्रति line — 5 hooks लिखें" },
  "yt-package": { file: "title.py", hint: "Title", extra: { label: "Thumbnail text", placeholder: "AI RAN IT" } },
  "yt-edit": { file: "deadair.py", ext: "srt", hint: "SRT / VTT / whisper JSON transcript paste करें" },
  "yt-chapters": { file: "chapters.py", ext: "srt", hint: "Timestamped transcript (SRT / VTT / JSON)" },
  "yt-retention": { file: "retention.py", ext: "csv", hint: "Retention CSV (position,still watching)" },
  "yt-viral": { file: "swipe.py", ext: "json", hint: "Collected videos का JSON array" },
};

const RUN_WRAPPER = `
import sys, io, os, runpy
sys.argv = list(yt_argv)
os.chdir(os.path.dirname(yt_script))
_buf = io.StringIO()
_old = sys.stdout
sys.stdout = _buf
_code = 0
try:
    runpy.run_path(yt_script, run_name='__main__')
except SystemExit as _exit:
    try:
        _code = int(_exit.code or 0)
    except (TypeError, ValueError):
        _code = 1
finally:
    sys.stdout = _old
[_code, _buf.getvalue()]
`;

const $ = (id) => document.getElementById(id);

const state = {
  skills: [],
  tools: {},
  current: null,
  toolOutput: "",
  busy: false,
  pyodide: null,
  prepared: false,
  mode: "auto",
  package: "",
};

/* --------------------------------------------------------------- utilities */

function setStatus(el, text, kind = "") {
  el.textContent = text;
  el.style.color = kind === "error" ? "var(--red)" : kind === "ok" ? "var(--green)" : "var(--muted)";
}

const manualStatus = (text, kind) => setStatus($("status"), text, kind);
const pilotStatus = (text, kind) => setStatus($("pilotStatus"), text, kind);

function showOutput(text) {
  const out = $("out");
  out.hidden = false;
  out.textContent = text;
  $("copy").hidden = false;
}

function parseSkill(id, raw) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  const front = match ? match[1] : "";
  const body = (match ? match[2] : raw).trim();
  let description = "";
  let collecting = false;
  for (const line of front.split("\n")) {
    if (/^name:/.test(line)) continue;
    const desc = /^description:\s*(.*)$/.exec(line);
    if (desc) {
      description = desc[1].replace(/^[>|]-?\s*$/, "").trim();
      collecting = true;
      continue;
    }
    if (collecting) {
      if (/^\s+\S/.test(line)) description = `${description} ${line.trim()}`.trim();
      else collecting = false;
    }
  }
  return { id, description, body };
}

async function loadSkills() {
  state.skills = await Promise.all(
    SKILL_IDS.map(async (id) => {
      try {
        const raw = await fetch(`./skills/${id}/SKILL.md`).then((res) => {
          if (!res.ok) throw new Error(res.status);
          return res.text();
        });
        return parseSkill(id, raw);
      } catch {
        return { id, description: "SKILL.md load नहीं हुआ", body: "" };
      }
    }),
  );
}

const skillBody = (id) => state.skills.find((skill) => skill.id === id)?.body ?? "";

function voiceText() {
  return (localStorage.getItem(VOICE_KEY) ?? "").trim();
}

/* ------------------------------------------------------------------- modes */

function showMode(mode) {
  state.mode = mode;
  $("pilot").hidden = mode !== "auto";
  $("manual").hidden = mode !== "manual";
  $("autoBtn").classList.toggle("active", mode === "auto");
  document.querySelectorAll(".rail button").forEach((btn) => btn.classList.remove("active"));
  if (mode === "auto") $("autoBtn").classList.add("active");
}

function renderNav() {
  const nav = $("nav");
  nav.textContent = "";
  state.skills.forEach((skill) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.id = skill.id;
    btn.innerHTML = '<span class="cmd"></span><span class="one-line"></span>';
    btn.querySelector(".cmd").textContent = `/${skill.id}`;
    btn.querySelector(".one-line").textContent =
      skill.description.length > 96 ? `${skill.description.slice(0, 95)}…` : skill.description;
    btn.addEventListener("click", () => {
      showMode("manual");
      select(skill.id);
    });
    nav.appendChild(btn);
  });
}

function select(id) {
  const skill = state.skills.find((s) => s.id === id);
  if (!skill) return;
  state.current = skill;
  state.toolOutput = "";
  document.querySelectorAll(".rail button").forEach((b) => b.classList.toggle("active", b.dataset.id === id));

  const tool = TOOLS[id];
  $("skillName").textContent = `/${skill.id}`;
  $("skillDesc").textContent = skill.description;
  $("inputLabel").textContent = tool ? tool.hint : "क्या बनवाना है — idea, transcript या channel details";
  $("input").value = "";
  $("input").placeholder = tool
    ? tool.hint
    : 'जैसे: "stock market basics पर 10 मिनट का वीडियो" — जितना context देंगे, उतना अच्छा output';
  $("out").hidden = true;
  $("copy").hidden = true;
  $("runTool").hidden = !tool;
  $("runTool").disabled = false;
  $("ask").disabled = false;
  $("extraWrap").hidden = !tool?.extra;
  if (tool?.extra) {
    $("extraLabel").textContent = tool.extra.label;
    $("extra").placeholder = tool.extra.placeholder ?? "";
    $("extra").value = "";
  }
  manualStatus(tool ? "Tool + AI दोनों उपलब्ध" : "prompt-only skill");
}

/* ----------------------------------------------------------------- pyodide */

async function ensurePyodide() {
  if (state.pyodide) return state.pyodide;
  manualStatus("Python engine load हो रहा है (~10 MB, सिर्फ़ पहली बार)…");
  pilotStatus("Python engine load हो रहा है (~10 MB, सिर्फ़ पहली बार)…");
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${PYODIDE_BASE}pyodide.js`;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Pyodide load नहीं हुआ (network?)"));
    document.head.appendChild(script);
  });
  state.pyodide = await globalThis.loadPyodide({ indexURL: PYODIDE_BASE });
  return state.pyodide;
}

async function prepareTools(py) {
  if (state.prepared) return;
  await Promise.all(
    Object.entries(TOOLS).map(async ([id, tool]) => {
      const dir = `/yt/${id}`;
      await py.runPythonAsync(`import os\nos.makedirs('${dir}', exist_ok=True)`);
      const names = [tool.file];
      if (id === "yt-script") names.push("hooks.json");
      await Promise.all(
        names.map(async (name) => {
          const res = await fetch(`./skills/${id}/${name}`);
          if (!res.ok) throw new Error(`${id}/${name} load नहीं हुआ`);
          py.FS.writeFile(`${dir}/${name}`, await res.text());
        }),
      );
    }),
  );
  state.prepared = true;
}

/** Runs one of the pack's tools and returns its parsed JSON plus the raw text. */
async function executeTool(skillId, text, thumb = "") {
  const tool = TOOLS[skillId];
  if (!tool) throw new Error(`कोई tool नहीं: ${skillId}`);
  const py = await ensurePyodide();
  await prepareTools(py);
  const dir = `/yt/${skillId}`;

  let argv;
  if (skillId === "yt-package" && tool.extra) {
    argv = [tool.file, "--title", String(text ?? "").trim(), "--json"];
    if (String(thumb).trim()) argv.push("--thumb", String(thumb).trim());
  } else {
    if (!String(text ?? "").trim()) throw new Error("input खाली है");
    py.FS.writeFile(`${dir}/input.${tool.ext}`, text);
    argv = [tool.file, `${dir}/input.${tool.ext}`, "--json"];
  }

  py.globals.set("yt_argv", argv);
  py.globals.set("yt_script", `${dir}/${tool.file}`);
  const [code, stdout] = await py.runPythonAsync(RUN_WRAPPER);
  const raw = String(stdout ?? "").trim();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  if (!raw) throw new Error("tool ने कुछ नहीं लौटाया");
  return { code: Number(code), data, raw };
}

/* ------------------------------------------------------------------- tools */

async function runTool() {
  const skill = state.current;
  if (!skill || !TOOLS[skill.id] || state.busy) return;
  state.busy = true;
  $("runTool").disabled = true;
  $("ask").disabled = true;
  const started = Date.now();
  try {
    manualStatus("tool चल रहा है…");
    const { code, data, raw } = await executeTool(skill.id, $("input").value, $("extra").value);
    const rendered = data ? JSON.stringify(data, null, 2) : raw;
    state.toolOutput = rendered;
    showOutput(rendered);
    manualStatus(code === 0 ? `tool ठीक चला · ${Date.now() - started} ms` : "tool ने यह input ठीक नहीं माना", code === 0 ? "ok" : "error");
  } catch (error) {
    state.toolOutput = "";
    showOutput(`Tool error: ${error.message}`);
    manualStatus("tool fail हुआ", "error");
  } finally {
    state.busy = false;
    $("runTool").disabled = false;
    $("ask").disabled = false;
  }
}

/* ------------------------------------------------------------------- model */

async function streamChat(prompt, onDelta) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error ?? `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.error) throw new Error(event.error);
      if (event.delta) {
        text += event.delta;
        onDelta?.(text);
      }
    }
  }
  if (!text.trim()) throw new Error("खाली जवाब आया");
  return text.trim();
}

function skillPrompt(skillId, task, extra) {
  const voice = voiceText();
  return [
    `SYSTEM: तुम ShâVì Ai हो और "${skillId}" YouTube skill चला रहे हो। नीचे दिए SKILL निर्देश ही तुम्हारा असली काम हैं — उन्हें अक्षरश: मानो।`,
    "आप shell नहीं चला सकते; जो आंकड़े नीचे दिए हैं वही असली हैं, नए आंकड़े मत बनाओ।",
    "जवाब उसी भाषा में दो जिसमें user लिख रहा है (Hindi/Hinglish ठीक); YouTube के terms English में।",
    "",
    "--- SKILL निर्देश ---",
    skillBody(skillId),
    "--- ख़त्म ---",
    "",
    voice ? `--- निर्माता की आवाज़ (voice.md) ---\n${voice}\n--- ख़त्म ---` : "(voice.md खाली है — अगर skill आवाज़ माँगती है तो पूछो, अनुमान मत लगाओ.)",
    "",
    `--- काम ---\n${task}`,
    extra ? `\n--- CONTEXT ---\n${extra}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function ask() {
  const skill = state.current;
  if (!skill || state.busy) return;
  state.busy = true;
  $("ask").disabled = true;
  $("runTool").disabled = true;
  const started = Date.now();
  const out = $("out");
  out.hidden = false;
  out.textContent = "";
  $("copy").hidden = true;
  manualStatus("ShâVì AI लिख रहा है…");
  try {
    const prompt = skillPrompt(
      skill.id,
      $("input").value.trim() || "(खाली)",
      state.toolOutput ? `TOOL OUTPUT (यही नंबर इस्तेमाल करो):\n${state.toolOutput}` : "",
    );
    const text = await streamChat(prompt, (partial) => {
      out.textContent = partial;
      out.scrollTop = out.scrollHeight;
    });
    out.textContent = text;
    $("copy").hidden = false;
    manualStatus(`जवाब तैयार · ${Math.round((Date.now() - started) / 1000)}s`, "ok");
  } catch (error) {
    out.textContent = `${out.textContent}\n\nError: ${error.message}`.trim();
    manualStatus("model call fail हुआ", "error");
  } finally {
    state.busy = false;
    $("ask").disabled = false;
    $("runTool").disabled = !TOOLS[state.current?.id];
  }
}

/* --------------------------------------------------------------- auto pilot */

const PILOT_STEPS = [
  { id: "channel", label: "Channel का public data पढ़ा" },
  { id: "audit", label: "Audit: क्या चल रहा है, एक fix" },
  { id: "topic", label: "अगले video का topic" },
  { id: "hooks", label: "5 hooks + hookscore.py" },
  { id: "titles", label: "10 titles + title.py lint" },
  { id: "script", label: "पूरा spoken script" },
  { id: "seo", label: "Description, tags, queries" },
  { id: "shorts", label: "3 Shorts first lines के साथ" },
  { id: "plan", label: "7 दिन का plan" },
  { id: "package", label: "Package तैयार" },
];

function renderSteps() {
  const list = $("steps");
  list.hidden = false;
  list.textContent = "";
  PILOT_STEPS.forEach((step) => {
    const li = document.createElement("li");
    li.id = `step-${step.id}`;
    li.textContent = step.label;
    list.appendChild(li);
  });
}

function stepState(id, status, note = "") {
  const li = $(`step-${id}`);
  if (!li) return;
  li.className = status;
  if (note) li.textContent = `${PILOT_STEPS.find((s) => s.id === id)?.label ?? id} — ${note}`;
}

const fmt = (value) => (typeof value === "number" ? value.toLocaleString("en-IN") : "—");

function channelSummary(channel) {
  const videos = (channel.videos ?? []).slice(0, 5);
  const rows = videos
    .map(
      (video) =>
        `<li><a href="${video.url}" target="_blank" rel="noopener noreferrer">${video.title}</a> — ${fmt(video.views)} views</li>`,
    )
    .join("");
  return `
    <h3>${channel.title}</h3>
    <p class="muted">${fmt(channel.stats.videos)} हाल के videos · median ${fmt(channel.stats.medianViews)} views ·
      औसत gap ${channel.stats.averageGapDays ?? "—"} दिन · आख़िरी ${(channel.stats.lastPublished ?? "").slice(0, 10)}</p>
    <ol class="top-videos">${rows}</ol>`;
}

function channelFacts(channel) {
  const list = (channel.videos ?? []).slice(0, 12).map(
    (video) => `- "${video.title}" — ${video.views ?? "?"} views — ${String(video.published).slice(0, 10)}`,
  );
  return [
    `CHANNEL: ${channel.title} (${channel.url})`,
    `हाल के ${channel.stats.videos} videos, median ${channel.stats.medianViews} views, average gap ${channel.stats.averageGapDays} दिन.`,
    "सबसे ज़्यादा चले videos:",
    ...list,
  ].join("\n");
}

function section(title, body) {
  return `## ${title}\n\n${body.trim()}\n`;
}

async function runPilot() {
  const channelInput = $("channelUrl").value.trim();
  const idea = $("idea").value.trim();
  if (!channelInput) {
    pilotStatus("पहले channel link या @handle भरें", "error");
    $("channelUrl").focus();
    return;
  }
  if (state.busy) return;
  state.busy = true;
  $("startPilot").disabled = true;
  $("autoBtn").disabled = true;
  $("openLast").hidden = true;
  $("packageWrap").hidden = true;
  $("channelCard").hidden = true;
  renderSteps();

  const parts = {};
  try {
    pilotStatus("channel data आ रहा है…");
    stepState("channel", "run");
    const res = await fetch(`${API_BASE}/api/yt/channel?u=${encodeURIComponent(channelInput)}`);
    const channel = await res.json();
    if (!res.ok) throw new Error(channel.error ?? `channel HTTP ${res.status}`);
    stepState("channel", "done", `${channel.title} · ${channel.stats.videos} videos`);
    $("channelCard").innerHTML = channelSummary(channel);
    $("channelCard").hidden = false;
    const facts = channelFacts(channel);

    const step = async (id, prompt) => {
      pilotStatus(`${PILOT_STEPS.find((s) => s.id === id).label} चल रहा है…`);
      stepState(id, "run");
      const text = await streamChat(prompt);
      parts[id] = text.trim();
      stepState(id, "done");
      return parts[id];
    };

    parts.audit = await step(
      "audit",
      skillPrompt(
        "yt-audit",
        "इस channel का audit करो और आख़िर में सिर्फ़ ONE fix दो जो सबसे ज़्यादा फ़र्क़ करेगा. 250 शब्द से कम, bullets.",
        facts,
      ),
    );

    if (idea) stepState("topic", "done", "आपका idea");
    parts.topic = idea
      ? idea
      : await step(
          "topic",
          skillPrompt(
            "yt-plan",
            "ऊपर के data से अगले video का सबसे अच्छा topic चुनो. जवाब की पहली line ठीक इस तरह: IDEA: <topic> — फिर 3 bullets में क्यों.",
            `${facts}\n\nAUDIT:\n${parts.audit}`,
          ),
        );

    const topicLine = /IDEA:\s*(.+)/i.exec(parts.topic)?.[1]?.trim() ?? (idea || parts.topic.split("\n")[0]);

    const hooksText = await step(
      "hooks",
      skillPrompt(
        "yt-script",
        "इस topic के लिए ठीक 5 hooks लिखो (21 formulas से), पहले 15 second के लिए. hooks English में लिखो — hookscore.py का lexicon English है, इसलिए score तभी सही होगा. सिर्फ़ 5 lines, कोई numbering नहीं, कोई व्याख्या नहीं.",
        `TOPIC: ${topicLine}\nAUDIT:\n${parts.audit}`,
      ),
    );
    const hookLines = hooksText
      .split("\n")
      .map((line) => line.replace(/^\s*[-*\d.)\s]+/, "").trim())
      .filter((line) => line.length > 8)
      .slice(0, 5);
    const hookScores = await executeTool("yt-script", hookLines.join("\n"));
    const rankedHooks = Array.isArray(hookScores.data) ? hookScores.data : [];
    const bestHook = rankedHooks[0]?.hook ?? hookLines[0] ?? "";
    stepState("hooks", "done", rankedHooks[0] ? `top score ${rankedHooks[0].verdict} (${rankedHooks[0].band})` : "");

    const titlesText = await step(
      "titles",
      skillPrompt(
        "yt-package",
        "10 titles लिखो (60 characters से कम), और आख़िरी line ठीक ऐसे: THUMB: <2-4 शब्द जो title दोहराएँ नहीं>.",
        `TOPIC: ${topicLine}\nHOOK: ${bestHook}\nAUDIT:\n${parts.audit}`,
      ),
    );
    const thumbMatch = /THUMB:\s*(.+)/i.exec(titlesText);
    const thumbText = thumbMatch?.[1]?.trim() ?? "";
    const titleLines = titlesText
      .split("\n")
      .map((line) => line.replace(/^\s*[-*\d.)\s]+/, "").trim())
      .filter((line) => line && !/^THUMB:/i.test(line) && !/^#/.test(line))
      .slice(0, 10);
    const titleLint = await executeTool("yt-package", titleLines.join("\n"));
    const rankedTitles = Array.isArray(titleLint.data) ? titleLint.data : [];
    const bestTitle = rankedTitles[0]?.title ?? titleLines[0] ?? topicLine;
    stepState("titles", "done", rankedTitles[0] ? `top score ${rankedTitles[0].score}` : "");

    parts.script = await step(
      "script",
      skillPrompt(
        "yt-script",
        "पूरा spoken script लिखो (8–10 मिनट), hook से शुरू — CHOSEN HOOK को Hinglish में बोलने लायक बनाओ (अर्थ वही, शब्द वही जो आप बोलते हैं). हर beat पर [ON SCREEN: …] लिखो, अंत में payoff और एक सवाल. जो भी आंकड़ा नहीं है उसे मत बनाओ.",
        `TOPIC: ${topicLine}\nCHOSEN HOOK: ${bestHook}\nCHOSEN TITLE: ${bestTitle}\nHOOK SCORES: ${JSON.stringify(rankedHooks.slice(0, 3))}`,
      ),
    );

    parts.seo = await step(
      "seo",
      skillPrompt(
        "yt-seo",
        "Description (पहली 2 lines में keyword), 10 tags, और 3 queries जो यह video जीतनी चाहिए. Chapters की जगह [CHAPTERS] लिख दो.",
        `TITLE: ${bestTitle}\nTOPIC: ${topicLine}\nSCRIPT (summary के लिए):\n${parts.script.slice(0, 1500)}`,
      ),
    );

    parts.shorts = await step(
      "shorts",
      skillPrompt(
        "yt-shorts",
        "इस script से 3 Shorts निकालो — हर एक के लिए: कौन सा हिस्सा, नई पहली line, और caption.",
        `SCRIPT:\n${parts.script.slice(0, 2500)}`,
      ),
    );

    parts.plan = await step(
      "plan",
      skillPrompt(
        "yt-plan",
        "अगले 7 दिन का plan दो — इस channel की असली cadence और audit के हिसाब से. table में: दिन, काम, कितना समय.",
        `${facts}\n\nAUDIT:\n${parts.audit}\n\nTOPIC: ${topicLine}`,
      ),
    );

    const markdown = [
      `# YouTube package — ${channel.title}`,
      `_${new Date().toLocaleString("en-IN")} · ShâVì YouTube Studio_`,
      "",
      `**Channel:** ${channel.url}`,
      `**Median views:** ${fmt(channel.stats.medianViews)} · **Cadence:** ${channel.stats.averageGapDays ?? "—"} दिन`,
      "",
      section("इस बार का topic", topicLine),
      section("Audit — एक fix", parts.audit),
      section(
        "Hooks (hookscore.py से scored)",
        rankedHooks
          .map((h) => `- **${h.verdict}/100 (${h.band})** — ${h.hook}`)
          .join("\n") || hookLines.map((line) => `- ${line}`).join("\n"),
      ),
      section(
        "Titles (title.py से linted)",
        rankedTitles
          .map((t) => `- **${t.score}** — ${t.title}${t.issues?.length ? ` _(${t.issues.map((i) => i[0]).join(", ")})_` : ""}`)
          .join("\n") || titleLines.map((line) => `- ${line}`).join("\n"),
      ),
      `**Thumbnail text:** ${thumbText || "(model ने नहीं दिया)"}`,
      "",
      section("Script", parts.script),
      section("Description / SEO", parts.seo),
      section("Shorts", parts.shorts),
      section("7 दिन का plan", parts.plan),
      "---",
      "_कुछ भी publish नहीं हुआ — upload आप करेंगे._",
    ].join("\n");

    state.package = markdown;
    $("package").textContent = markdown;
    $("packageWrap").hidden = false;
    localStorage.setItem(PACKAGE_KEY, JSON.stringify({ markdown, at: Date.now(), channel: channel.title }));
    stepState("package", "done");
    pilotStatus("पूरा package तैयार — download या copy करें", "ok");
  } catch (error) {
    pilotStatus(`रुक गया: ${error.message}`, "error");
    const running = document.querySelector("#steps li.run");
    if (running) running.className = "fail";
  } finally {
    state.busy = false;
    $("startPilot").disabled = false;
    $("autoBtn").disabled = false;
    $("openLast").hidden = !localStorage.getItem(PACKAGE_KEY);
  }
}

function openLastPackage() {
  const saved = localStorage.getItem(PACKAGE_KEY);
  if (!saved) return;
  try {
    const data = JSON.parse(saved);
    state.package = data.markdown;
    $("package").textContent = data.markdown;
    $("packageWrap").hidden = false;
    pilotStatus(`${data.channel ?? "पिछला package"} · ${new Date(data.at).toLocaleString("en-IN")}`, "ok");
  } catch {
    pilotStatus("पिछला package पढ़ा नहीं जा सका", "error");
  }
}

function downloadPackage() {
  if (!state.package) return;
  const blob = new Blob([state.package], { type: "text/markdown;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `youtube-package-${new Date().toISOString().slice(0, 10)}.md`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ------------------------------------------------------- channel + publish */

const ACTIONS_URL = "https://github.com/VKKMANAGE1/vktechlearn/actions/workflows/yt-autopilot.yml";

function pubSay(text, kind) {
  setStatus($("pubStatus"), text || "", kind);
}

function pill(text, kind) {
  const el = $("pubPill");
  el.textContent = text;
  el.className = `pill ${kind}`;
}

function renderChannel(data) {
  const box = $("pubChannel");
  if (!data.connected || !data.channel) {
    box.innerHTML =
      '<p class="muted">अभी कोई channel जुड़ा नहीं है. नीचे Connect दबाएँ — Google खुलेगा, अपना channel चुनें और अनुमति दें. एक ही बार करना है.</p>';
    return;
  }
  const since = (data.channel.connectedAt || "").slice(0, 10);
  box.innerHTML = `
    ${data.channel.thumb ? `<img src="${data.channel.thumb}" alt="" width="44" height="44" />` : ""}
    <div>
      <strong>${data.channel.title}</strong>
      <p class="muted">${since} से जुड़ा · अब तक ${data.published ?? 0} Shorts publish हुईं</p>
    </div>`;
}

function renderList(el, rows, empty) {
  if (!rows.length) {
    el.innerHTML = `<li class="muted">${empty}</li>`;
    return;
  }
  el.innerHTML = rows
    .map((row) => {
      if (row.url) {
        return `<li><a href="${row.url}" target="_blank" rel="noopener noreferrer">${row.title || row.video_id}</a><span class="when">${(row.at || "").slice(0, 16).replace("T", " ")}</span></li>`;
      }
      const mark = row.status === "published" ? "✓" : row.status === "failed" ? "✕" : "·";
      return `<li>${mark} ${row.source_title || row.status}${row.note ? ` — ${row.note}` : ""}<span class="when">${(row.at || "").slice(0, 16).replace("T", " ")}</span></li>`;
    })
    .join("");
}

function renderPublish(data) {
  pill(data.connected ? "जुड़ा हुआ" : "जुड़ा नहीं", data.connected ? "ok" : "bad");
  renderChannel(data);
  $("pubConnect").textContent = data.connected ? "दोबारा connect करें" : "Channel connect करें";
  $("pubConnect").disabled = !data.oauth;
  $("pubRun").disabled = !data.connected;
  $("pubTest").disabled = !data.connected;
  renderList($("pubRuns"), data.runs || [], "अभी कोई run नहीं");
  renderList($("pubClips"), data.clips || [], "अभी कुछ publish नहीं हुआ");

  const notes = [];
  if (!data.oauth) {
    notes.push(
      `Worker में <code>GOOGLE_CLIENT_ID</code> / <code>GOOGLE_CLIENT_SECRET</code> सेट नहीं हैं. Google Cloud → APIs &amp; Services → Credentials → OAuth client (Web application) बनाइए, “Authorized redirect URI” में यह डालिए: <code>${API_BASE}/api/yt/oauth/callback</code> — फिर दोनों keys Sites → Secrets में जोड़ दीजिए.`,
    );
  }
  if (!data.storage) notes.push("Worker में <code>DB</code> (D1) binding नहीं है — token कहीं सेव नहीं हो पाएगा.");
  if (data.connected) {
    notes.push("Schedule: रोज़ 09:10 और 21:10 IST (GitHub Actions). Settings: <code>tools/yt-autopilot/config.json</code> — privacy, clips per run, length, hashtags.");
  }
  if (data.connected && !data.dispatch) {
    notes.push(`“अभी चलाओ” के लिए Worker में <code>GH_TOKEN</code> चाहिए — तब तक <a href="${ACTIONS_URL}" target="_blank" rel="noopener noreferrer">Actions tab</a> से Run workflow दबाएँ.`);
  }
  $("pubNotes").innerHTML = notes.map((line) => `<p>${line}</p>`).join("");
  $("pubNotes").hidden = notes.length === 0;
}

async function loadPublish() {
  try {
    const res = await fetch(`${API_BASE}/api/yt/status`, { cache: "no-store" });
    renderPublish(await res.json());
  } catch (error) {
    pill("Worker से कनेक्ट नहीं", "bad");
    pubSay(`status नहीं आया: ${error.message}`, "error");
  }
}

function connectChannel() {
  const here = location.origin + location.pathname;
  location.href = `${API_BASE}/api/yt/oauth/start?return=${encodeURIComponent(here)}`;
}

async function runAutopilot(dryRun) {
  $("pubRun").disabled = true;
  $("pubTest").disabled = true;
  pubSay("Actions पर भेजा जा रहा है…");
  try {
    const res = await fetch(`${API_BASE}/api/yt/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: Boolean(dryRun) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    $("pubActions").href = data.actions || ACTIONS_URL;
    pubSay(
      dryRun
        ? "Test run चल पड़ा — clips बनेंगे, publish नहीं होंगे (2–5 मिनट, Actions में देखें)"
        : "चल पड़ा — 2–5 मिनट में Shorts publish होंगी (Actions में progress देखें)",
      "ok",
    );
  } catch (error) {
    pubSay(error.message, "error");
  } finally {
    $("pubRun").disabled = false;
    $("pubTest").disabled = false;
  }
}

function readConnectResult() {
  const params = new URLSearchParams(location.search);
  const result = params.get("yt");
  if (!result) return;
  if (result === "connected") {
    pubSay(`channel जुड़ गया${params.get("ch") ? `: ${params.get("ch")}` : ""} — पहला run “अभी चलाओ” से या अगले schedule पर`, "ok");
  } else if (result === "denied") {
    pubSay("अनुमति नहीं मिली — दोबारा Connect दबाकर सारी permissions Allow करें", "error");
  }
  history.replaceState({}, "", location.origin + location.pathname);
}

/* ------------------------------------------------------------------- voice */

async function openVoice() {
  if (!localStorage.getItem(VOICE_KEY)) {
    const template = await fetch("./voice.md")
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => "");
    localStorage.setItem(VOICE_KEY, template);
  }
  $("voiceText").value = localStorage.getItem(VOICE_KEY) ?? "";
  $("voiceStatus").textContent = "";
  $("voiceDialog").showModal();
}

function saveVoice() {
  localStorage.setItem(VOICE_KEY, $("voiceText").value);
  $("voiceStatus").textContent = "saved (इस browser में)";
}

/* -------------------------------------------------------------------- boot */

async function boot() {
  $("health").textContent = "skills load हो रहे हैं…";
  try {
    await loadSkills();
    renderNav();
    $("health").textContent = `${state.skills.length} skills · 6 tools · Pyodide`;
    showMode("auto");
    $("autoBtn").classList.add("active");
    $("openLast").hidden = !localStorage.getItem(PACKAGE_KEY);
  } catch (error) {
    $("health").textContent = `load fail: ${error.message}`;
  }
  readConnectResult();
  loadPublish();
}

$("runTool").addEventListener("click", runTool);
$("ask").addEventListener("click", ask);
$("voiceBtn").addEventListener("click", openVoice);
$("voiceSave").addEventListener("click", saveVoice);
$("startPilot").addEventListener("click", runPilot);
$("pubConnect").addEventListener("click", connectChannel);
$("pubRun").addEventListener("click", () => runAutopilot(false));
$("pubTest").addEventListener("click", () => runAutopilot(true));
$("autoBtn").addEventListener("click", () => showMode("auto"));
$("openLast").addEventListener("click", openLastPackage);
$("downloadPkg").addEventListener("click", downloadPackage);
$("copyPkg").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.package);
    pilotStatus("पूरा package copy हो गया", "ok");
  } catch {
    pilotStatus("copy नहीं हुआ — manually select करें", "error");
  }
});
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("out").textContent ?? "");
    manualStatus("copied", "ok");
  } catch {
    manualStatus("copy नहीं हुआ — manually select करें", "error");
  }
});

boot();
