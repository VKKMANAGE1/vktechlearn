/* ShâVì YouTube Studio — static page.
 *
 * The eleven skills are prompts (SKILL.md, vendored unchanged from
 * Jakeschincariol/youtube-agent-skill, MIT). The six Python tools are executed for real
 * inside the browser with Pyodide, so nothing the user pastes leaves the page; only the
 * prompt goes to the ShâVì Ai Worker, which is the same backend the /shavi-ai/ app uses.
 */
const API_BASE = "https://site-d28594350583452e987524c38e89b7a9.freebuff.page";
const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const VOICE_KEY = "shavi-yt-voice-v1";

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

/* Which skills ship a python tool, how its input is fed, and how the CLI is called. */
const TOOLS = {
  "yt-script": { file: "hookscore.py", ext: "txt", hint: "एक hook प्रति line — 5 hooks लिखें" },
  "yt-package": {
    file: "title.py",
    hint: "Title",
    extra: { label: "Thumbnail text", placeholder: "AI RAN IT" },
  },
  "yt-edit": { file: "deadair.py", ext: "srt", hint: "SRT / VTT / whisper JSON transcript paste करें" },
  "yt-chapters": { file: "chapters.py", ext: "srt", hint: "Timestamped transcript (SRT / VTT / JSON)" },
  "yt-retention": { file: "retention.py", ext: "csv", hint: "Retention CSV (position,still watching)" },
  "yt-viral": { file: "swipe.py", ext: "json", hint: "Collected videos का JSON array" },
};

/* The tools call sys.exit(1) with a human message when the input is too thin ("too few cues to
 * chapter"); that must reach the user as that message, not as a traceback. */
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
const state = { skills: [], current: null, toolOutput: "", busy: false, pyodide: null, sources: {} };

function setStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.style.color = kind === "error" ? "var(--red)" : kind === "ok" ? "var(--green)" : "var(--muted)";
}

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
    const kv = /^name:\s*(.*)$/.exec(line);
    if (kv) continue;
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
  const skills = await Promise.all(
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
  state.skills = skills;
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
    const desc = btn.querySelector(".one-line");
    desc.textContent = skill.description.length > 96 ? `${skill.description.slice(0, 95)}…` : skill.description;
    btn.addEventListener("click", () => select(skill.id));
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
    : "जैसे: \"stock market basics पर 10 मिनट का वीडियो\" — जितना context देंगे, उतना अच्छा output";
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
  setStatus(tool ? "Tool + AI दोनों उपलब्ध" : "prompt-only skill");
}

/* --------------------------------------------------------------- pyodide */

async function ensurePyodide() {
  if (state.pyodide) return state.pyodide;
  setStatus("Python engine load हो रहा है (~10 MB, सिर्फ़ पहली बार)…");
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

/**
 * Every tool is written into the Pyodide filesystem up front: chapters.py and retention.py do
 * `sys.path.insert(…, "../yt-edit")` and import deadair.py, so a single tool directory on its
 * own would fail exactly the way it does outside the browser.
 */
async function prepareTools(py) {
  if (state.sources.ready) return;
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
  state.sources.ready = true;
}

async function runTool() {
  const skill = state.current;
  const tool = skill && TOOLS[skill.id];
  if (!tool || state.busy) return;
  const text = $("input").value;
  if (skill.id === "yt-package" ? !text.trim() : !text.trim()) {
    setStatus("पहले input भरें", "error");
    return;
  }
  state.busy = true;
  $("runTool").disabled = true;
  $("ask").disabled = true;
  const started = Date.now();
  try {
    const py = await ensurePyodide();
    setStatus("tool चल रहा है…");
    await prepareTools(py);
    const dir = `/yt/${skill.id}`;

    let argv;
    if (skill.id === "yt-package") {
      const thumb = $("extra").value.trim();
      argv = [tool.file, "--title", text.trim(), "--json"];
      if (thumb) argv.push("--thumb", thumb);
    } else {
      const inputPath = `${dir}/input.${tool.ext}`;
      py.FS.writeFile(inputPath, text);
      argv = [tool.file, inputPath, "--json"];
    }

    py.globals.set("yt_argv", argv);
    py.globals.set("yt_script", `${dir}/${tool.file}`);
    const [code, stdout] = await py.runPythonAsync(RUN_WRAPPER);

    let data = null;
    try {
      data = JSON.parse(stdout);
    } catch {
      data = null;
    }
    const rendered = data ? JSON.stringify(data, null, 2) : String(stdout ?? "").trim();
    if (!rendered) throw new Error("tool ने कुछ नहीं लौटाया");
    state.toolOutput = rendered;
    showOutput(rendered);
    setStatus(
      Number(code) === 0 ? `tool ठीक चला · ${Date.now() - started} ms` : "tool ने यह input ठीक नहीं माना",
      Number(code) === 0 ? "ok" : "error",
    );
  } catch (error) {
    state.toolOutput = "";
    showOutput(`Tool error: ${error.message}`);
    setStatus("tool fail हुआ", "error");
  } finally {
    state.busy = false;
    $("runTool").disabled = false;
    $("ask").disabled = false;
  }
}

/* ----------------------------------------------------------------- model */

function voiceText() {
  return localStorage.getItem(VOICE_KEY) ?? "";
}

function buildPrompt(skill, input, toolOutput) {
  const voice = voiceText().trim();
  return [
    `SYSTEM: तुम ShâVì Ai हो और अभी "${skill.id}" YouTube skill चला रहे हो। नीचे दिए SKILL निर्देश ही तुम्हारा असली काम हैं — उन्हें अक्षरश: मानो.`,
    "तुम यहाँ shell नहीं चला सकते, इसलिए tool खुद मत चलाने का दावा करो; अगर tool का output नीचे दिया है तो उसी के नंबर इस्तेमाल करो, वरना साफ़ कहो कि वह आंकड़ा tool से आएगा.",
    "कोई संख्या, result या source मत बनाओ. जो आंकड़ा नहीं है, उसके लिए पूछो या उसके बिना लिखो.",
    "जवाब उसी भाषा में दो जिसमें user ने लिखा है (Hindi/Hinglish ठीक है); YouTube के terms English में रखो.",
    "",
    "--- SKILL निर्देश ---",
    skill.body,
    "--- SKILL निर्देश ख़त्म ---",
    "",
    voice ? `--- निर्माता की आवाज़ (voice.md) ---\n${voice}\n--- आवाज़ ख़त्म ---` : "(voice.md अभी भरा नहीं है — अगर skill आवाज़ माँगती है तो पूछो, अनुमान मत लगाओ.)",
    "",
    "--- USER INPUT ---",
    input.trim() || "(खाली)",
    toolOutput ? `\n--- TOOL OUTPUT (पहले से चला हुआ, यही नंबर इस्तेमाल करो) ---\n${toolOutput}` : "",
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
  const out = $("out");
  out.hidden = false;
  out.textContent = "";
  $("copy").hidden = true;
  const started = Date.now();
  setStatus("ShâVì AI लिख रहा है…");

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: buildPrompt(skill, $("input").value, state.toolOutput) }] }),
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
          out.textContent = text;
          out.scrollTop = out.scrollHeight;
        }
      }
    }
    if (!text.trim()) throw new Error("खाली जवाब आया");
    $("copy").hidden = false;
    setStatus(`जवाब तैयार · ${Math.round((Date.now() - started) / 1000)}s`, "ok");
  } catch (error) {
    out.textContent = `${out.textContent}\n\nError: ${error.message}`.trim();
    setStatus("model call fail हुआ", "error");
  } finally {
    state.busy = false;
    $("ask").disabled = false;
    $("runTool").disabled = !TOOLS[state.current?.id];
  }
}

/* ----------------------------------------------------------------- voice */

async function openVoice() {
  if (!localStorage.getItem(VOICE_KEY)) {
    const template = await fetch("./voice.md").then((r) => (r.ok ? r.text() : "")).catch(() => "");
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

/* ------------------------------------------------------------------ boot */

async function boot() {
  $("health").textContent = "skills load हो रहे हैं…";
  try {
    await loadSkills();
    renderNav();
    $("health").textContent = `${state.skills.length} skills · 6 tools · Pyodide`;
    select("yt-script");
  } catch (error) {
    $("health").textContent = `load fail: ${error.message}`;
  }
}

$("runTool").addEventListener("click", runTool);
$("ask").addEventListener("click", ask);
$("voiceBtn").addEventListener("click", openVoice);
$("voiceSave").addEventListener("click", saveVoice);
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("out").textContent ?? "");
    setStatus("copied", "ok");
  } catch {
    setStatus("copy नहीं हुआ — manually select करें", "error");
  }
});

boot();
