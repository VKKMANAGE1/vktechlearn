#!/usr/bin/env node
/**
 * M08 — web search, page extraction and citations proven end-to-end.
 *
 * Uses the "SHAVI Research" agent (tools: web_search) so the research workflow
 * is the thing under test. Checks every link of the chain against real systems:
 * the tool ran, the provider returned real URLs, the pages were really fetched
 * and turned into highlights, every citation marker in the answer resolves to a
 * URL the tool actually returned, those pages answer HTTP 200, and the whole
 * message (tool output + citations) is persisted in Mongo.
 *
 *   node tools/librechat-dev/m08-web-search-test.mjs [--dump] [--question "..."]
 */
import { MongoClient } from 'mongodb';

const BASE = 'http://127.0.0.1:3080';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MONGO = 'mongodb://127.0.0.1:27017/LibreChat';
const DUMP = process.argv.includes('--dump');
const qArg = process.argv.indexOf('--question');
const QUESTION =
  qArg > -1
    ? process.argv[qArg + 1]
    : 'वेब सर्च करके बताओ LibreChat v0.8.9 changelog में क्या नया जोड़ा गया? कम से कम दो स्रोत URL दो।';
const AGENT_NAME = 'SHAVI Research';

const json = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text.slice(0, 300) };
  }
};

const login = async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ email: 'admin@shavi.local', password: 'ShaviLocal#2026' }),
  });
  if (!res.ok) throw new Error(`login failed ${res.status}`);
  return (await res.json()).token;
};

const findAgent = async (token) => {
  const res = await fetch(`${BASE}/api/agents`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
  });
  const body = await json(res);
  const list = Array.isArray(body) ? body : (body.data ?? []);
  const agent = list.find((a) => a.name === AGENT_NAME);
  if (!agent) return { agentId: null, tools: [], count: list.length };
  /** the list endpoint omits tools; the detail endpoint has them */
  const detail = await json(
    await fetch(`${BASE}/api/agents/${agent.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
    }),
  );
  return { agentId: agent.id, tools: detail.tools ?? [], count: list.length };
};

const parts = (message) =>
  Array.isArray(message?.content)
    ? message.content
    : [{ type: 'text', text: String(message?.content ?? '') }];

const textOf = (message) =>
  parts(message)
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n');

const sendTurn = async (token, agentId, text) => {
  const res = await fetch(`${BASE}/api/agents/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': UA },
    body: JSON.stringify({
      text,
      sender: 'User',
      isCreatedByUser: true,
      parentMessageId: null,
      messageId: crypto.randomUUID(),
      conversationId: null,
      error: false,
      endpoint: 'SHAVI AI',
      endpointType: 'custom',
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      spec: 'shavi-nemotron',
      agent_id: agentId,
      isTemporary: false,
      isRegenerate: false,
      isContinued: false,
      timezone: 'Asia/Kolkata',
      generationProtocolVersion: 1,
    }),
  });
  return { status: res.status, body: await json(res) };
};

const waitForReply = async (token, conversationId, timeoutMs = 260000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 4000));
    const res = await fetch(`${BASE}/api/messages/${conversationId}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
    });
    if (!res.ok) continue;
    const messages = await res.json();
    const assistant = messages.filter((m) => !m.isCreatedByUser).at(-1);
    if (!assistant) continue;
    if (textOf(assistant).trim() || assistant.error) return assistant;
  }
  return null;
};

/** turn0search0 style anchors the client renders as footnotes. */
const anchorsOf = (text) => [...new Set(text.match(/turn(\d+)(search|news|ref|file)(\d+)/g) ?? [])];

const main = async () => {
  const token = await login();
  const { agentId, tools, count } = await findAgent(token);
  console.log(`agent "${AGENT_NAME}": ${agentId ?? 'missing'} | tools=${JSON.stringify(tools)} | total agents=${count}`);
  if (!agentId) {
    console.error('FAIL the research agent does not exist');
    process.exit(1);
  }

  const turn = await sendTurn(token, agentId, QUESTION);
  console.log('chat', turn.status, JSON.stringify(turn.body).slice(0, 120));
  if (turn.status !== 200 || !turn.body?.conversationId) process.exit(1);

  const reply = await waitForReply(token, turn.body.conversationId);
  if (!reply) {
    console.error('FAIL timeout waiting for the answer');
    process.exit(1);
  }
  if (DUMP) console.log('--- assistant message ---\n' + JSON.stringify(reply, null, 2).slice(0, 7000));

  const all = parts(reply);
  const text = textOf(reply);
  console.log('\nanswer:', text.replace(/\n/g, ' ').slice(0, 600));

  const toolParts = all.filter((p) => JSON.stringify(p).includes('"web_search"'));
  const toolOutput = toolParts
    .map((p) => (typeof p.tool_call?.output === 'string' ? p.tool_call.output : ''))
    .join('\n');
  const queries = toolParts
    .map((p) => {
      try {
        return JSON.parse(p.tool_call?.args ?? '{}').query;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const toolUrls = [...new Set(toolOutput.match(/^URL: (https?:\/\/\S+)$/gm) ?? [])].map((line) =>
    line.replace(/^URL: /, '').trim(),
  );
  const anchorPairs = [...toolOutput.matchAll(/Anchor: [^\n]*?(turn\d+(?:search|news|ref|file)\d+)\nURL: (https?:\S+)/g)].map(
    (m) => ({ anchor: m[1], url: m[2] }),
  );
  const citedUrls = [...new Set(text.match(/https?:\/\/[^\s)\]>"'`,]+/g) ?? [])].map((u) =>
    u.replace(/[.,;:]+$/, ''),
  );
  const citedAnchors = anchorsOf(text);

  console.log('queries:', JSON.stringify(queries));
  console.log('tool output chars:', toolOutput.length, '| result URLs:', toolUrls.length, '| anchors:', anchorPairs.length);
  console.log('answer anchors:', JSON.stringify(citedAnchors), '| answer URLs:', citedUrls.length);

  const unreachable = [];
  for (const url of (citedUrls.length ? citedUrls : toolUrls).slice(0, 3)) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });
      unreachable.push({ url, status: res.status, ok: res.ok });
    } catch (error) {
      unreachable.push({ url, status: 'error', ok: false, error: String(error).slice(0, 80) });
    }
  }
  console.log('page reachability:', JSON.stringify(unreachable));

  const knownAnchors = new Set(anchorPairs.map((p) => p.anchor));
  const knownUrls = new Set([...toolUrls, ...anchorPairs.map((p) => p.url)]);
  const fabricatedAnchors = citedAnchors.filter((a) => !knownAnchors.has(a));
  const fabricatedUrls = citedUrls.filter(
    (u) => ![...knownUrls].some((k) => k === u || k.startsWith(u) || u.startsWith(k)),
  );

  const client = await MongoClient.connect(MONGO);
  const stored = await client.db().collection('messages').findOne({ messageId: reply.messageId });
  await client.close();
  const storedContent = JSON.stringify(stored?.content ?? '');
  const storedHasToolOutput = storedContent.includes('"web_search"') && storedContent.includes('URL: http');
  const storedHasAnchors = /turn\d+search\d+/.test(storedContent);

  const checks = {
    'research agent exists with web_search': tools.includes('web_search'),
    'search tool executed': toolParts.length > 0,
    'query is keywords, not a URL': queries.length > 0 && queries.every((q) => !/^https?:\/\//.test(q) && !q.includes('://')),
    'real search results (>=2 URLs)': toolUrls.length >= 2,
    'page extraction (summaries + highlights)':
      toolOutput.includes('Summary:') && toolOutput.includes('Highlights') && toolOutput.length > 2000,
    'answer carries citation markers': citedAnchors.length >= 1,
    'no fabricated citation markers': citedAnchors.length >= 1 && fabricatedAnchors.length === 0,
    'no fabricated URLs in answer': fabricatedUrls.length === 0,
    'cited/source pages reachable': unreachable.length > 0 && unreachable.every((r) => r.ok),
    'tool output + citations stored in Mongo': storedHasToolOutput && storedHasAnchors,
  };

  console.log('\n--- checks ---');
  let failed = 0;
  for (const [name, pass] of Object.entries(checks)) {
    if (!pass) failed += 1;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  }
  if (fabricatedAnchors.length) console.log('fabricated anchors:', fabricatedAnchors);
  if (fabricatedUrls.length) console.log('fabricated urls:', fabricatedUrls);
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} conversation=${turn.body.conversationId}`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
