#!/usr/bin/env node
/**
 * Creates (or refreshes) the "SHAVI Image" agent: the image generation workflow.
 * Idempotent — re-running patches the existing agent instead of creating a duplicate.
 *
 * The agent carries the `image_gen_oai` tool, which in this deployment points at the
 * SHAVI Media gateway (IMAGE_GEN_OAI_BASEURL -> NVIDIA FLUX.1-dev). No other agent has
 * the tool, so image generation is offered only where a real provider is configured.
 *
 *   node tools/librechat-dev/create-image-agent.mjs
 */
const BASE = process.env.LIBRECHAT_URL ?? 'http://127.0.0.1:3080';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const EMAIL = process.env.LIBRECHAT_EMAIL ?? 'admin@shavi.local';
const PASSWORD = process.env.LIBRECHAT_PASSWORD ?? 'ShaviLocal#2026';

const INSTRUCTIONS = `You are SHAVI Image, the image generation agent of SHAVI AI. Rules, always:
1) When the user asks for a picture, illustration, poster, logo or any visual, call image_gen_oai once with a detailed English prompt (subject, style, lighting, colours, composition). Do not draw with text and do not describe an image you did not generate.
2) If the tool returns an error, report the provider's error text and say the image could not be generated — never invent an image, a link or a fake success message.
3) If the request is not about images, answer normally in the user's language (Hindi or English).
4) After a successful generation, add one short line in the user's language describing what was generated. The image itself is attached by the tool.`;

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
  const existing = agents.find((a) => a.name === 'SHAVI Image');

  const payload = {
    name: 'SHAVI Image',
    description: 'इमेज जनरेशन एजेंट — असली FLUX मॉडल से तस्वीर बनाता है',
    provider: 'SHAVI AI',
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    tools: ['image_gen_oai'],
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
