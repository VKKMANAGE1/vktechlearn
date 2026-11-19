#!/usr/bin/env node
/**
 * Creates (or refreshes) the "SHAVI Workspace" agent — the M10 agent that carries the
 * tool surface this milestone is about: file search over the user's own uploads,
 * a sandboxed code interpreter, real web search, and user-controlled memory.
 *
 * Idempotent: re-running patches the existing agent instead of creating a duplicate.
 *
 *   node tools/librechat-dev/create-workspace-agent.mjs
 *   node tools/librechat-dev/pin-agent-ids.mjs
 */
const BASE = process.env.LIBRECHAT_URL ?? 'http://127.0.0.1:3080';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const EMAIL = process.env.LIBRECHAT_EMAIL ?? 'admin@shavi.local';
const PASSWORD = process.env.LIBRECHAT_PASSWORD ?? 'ShaviLocal#2026';

const TOOLS = ['file_search', 'execute_code', 'web_search', 'memory'];

const INSTRUCTIONS = `You are SHAVI Workspace, the working agent of SHAVI AI (files, code, web, memory). Rules, always:
1) Questions about the user's uploaded documents: call file_search with a short natural-language query (not a URL, not a file name). Answer only from the returned excerpts and name the file and page you used. If nothing is returned, say the file does not contain it — never guess.
2) Any calculation, data wrangling, chart or generated file: call execute_code with lang "py". Write anything the user should keep to /mnt/data, print the numbers you rely on, and quote the real stdout. Never claim an execution you did not run.
3) Current web facts: call web_search with plain keywords only (never a URL), and cite only URLs that appear in the tool output.
4) Memory: when the user explicitly asks you to remember something, call set_memory with a short key and a one-line value. Never store passwords, API keys or other secrets. Do not invent memories.
5) Answer in the user's language (Hindi or English), short and concrete.`;

const json = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text.slice(0, 300) };
  }
};

const main = async () => {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`login failed ${login.status}`);
  const { token } = await login.json();
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': UA, 'Content-Type': 'application/json' };

  const list = await json(await fetch(`${BASE}/api/agents`, { headers }));
  const agents = Array.isArray(list) ? list : (list.data ?? []);
  const existing = agents.find((a) => a.name === 'SHAVI Workspace');

  const payload = {
    name: 'SHAVI Workspace',
    description: 'फाइल सर्च + सेफ कोड रनर + वेब सर्च + याद रखने की सुविधा',
    provider: 'SHAVI AI',
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    tools: TOOLS,
    instructions: INSTRUCTIONS,
  };

  const res = existing
    ? await fetch(`${BASE}/api/agents/${existing.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ instructions: payload.instructions, tools: payload.tools }),
      })
    : await fetch(`${BASE}/api/agents`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const body = await json(res);
  console.log(
    `${existing ? 'updated' : 'created'} ${res.status} agent=${body.id ?? existing?.id} tools=${JSON.stringify(
      body.tools ?? payload.tools,
    )}`,
  );
  if (!res.ok) process.exit(1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
