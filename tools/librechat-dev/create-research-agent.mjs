#!/usr/bin/env node
/**
 * Creates (or refreshes) the "SHAVI Research" agent: the web search / research
 * workflow of the deployment. Idempotent — re-running patches the existing agent
 * instead of creating a duplicate.
 *
 *   node tools/librechat-dev/create-research-agent.mjs
 */
const BASE = process.env.LIBRECHAT_URL ?? 'http://127.0.0.1:3080';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const EMAIL = process.env.LIBRECHAT_EMAIL ?? 'admin@shavi.local';
const PASSWORD = process.env.LIBRECHAT_PASSWORD ?? 'ShaviLocal#2026';

const INSTRUCTIONS = `You are SHAVI Research, the web research agent of SHAVI AI. Rules, always:
1) When a question needs current web information, call web_search with a short plain KEYWORD query (for example: "LibreChat changelog 0.8.9"). NEVER pass a URL, a domain, or a JSON snippet as the query.
2) Only state facts that appear in the tool output. If the tool returns no usable results, say "सर्च उपलब्ध नहीं" and stop — never invent facts, links, versions, numbers or dates.
3) Cite with the citation markers the tool output provides, and never write a URL you did not see in the tool output.
4) Answer in the user's language (Hindi or English): a short summary, then a "स्रोत:" section with the full URLs from the tool output that you used, one per line.`;

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
  const existing = agents.find((a) => a.name === 'SHAVI Research');

  const payload = {
    name: 'SHAVI Research',
    description: 'वेब रिसर्च एजेंट — असली सर्च, पेज एक्सट्रैक्शन और स्रोत के साथ',
    provider: 'SHAVI AI',
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    tools: ['web_search'],
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
