#!/usr/bin/env node
/**
 * M09 — image generation, image understanding, speech-to-text and text-to-speech,
 * proven end-to-end against real providers. No mocks, no stubs:
 *
 *   image generation   "SHAVI Image" agent -> image_gen_oai -> SHAVI Media gateway
 *                      -> NVIDIA NIM FLUX.1-dev -> real JPEG -> stored file + Mongo
 *   image understanding upload a PNG with a unique token -> vision model must read it
 *   text-to-speech     LibreChat TTS route -> gateway -> Piper -> real WAV bytes
 *   speech-to-text     LibreChat STT route <- webm/opus-like audio -> gateway ->
 *                      faster-whisper -> transcript checked against what was spoken
 *   capabilities       only configured providers advertise features (speech config
 *                      + the agent tool list), and the gateway reports its own state
 *
 *   node tools/librechat-dev/m09-media-test.mjs [--dump]
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const BASE = 'http://127.0.0.1:3080';
const GATEWAY = process.env.SHAVI_MEDIA_URL ?? 'http://127.0.0.1:4123';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MONGO = 'mongodb://127.0.0.1:27017/LibreChat';
const DUMP = process.argv.includes('--dump');
const IMAGE_AGENT = 'SHAVI Image';
const IMAGE_SPEC = 'shavi-image';
const VISION_SPEC = 'shavi-vision';
const VISION_MODEL = 'nvidia/nemotron-3.5-super-vl-120b-a12b';
const ARTIFACTS = path.resolve('artifacts/design');
const FIXTURE_DIR = path.resolve('artifacts/m09-fixtures');

const json = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text.slice(0, 400) };
  }
};

const login = async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ email: 'admin@shavi.local', password: 'ShaviLocal#2026' }),
  });
  if (!res.ok) throw new Error(`login failed ${res.status}`);
  /** `/images/*` is authorized from the session cookie, not the bearer token. */
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  return { token: (await res.json()).token, cookie };
};

const parts = (message) =>
  Array.isArray(message?.content) ? message.content : [{ type: 'text', text: String(message?.content ?? '') }];

const textOf = (message) =>
  parts(message)
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n');

const imageUrlsOf = (message) =>
  parts(message)
    .filter((p) => p.type === 'image_url')
    .map((p) => p.image_url?.url ?? p.image_url)
    .filter(Boolean);

const waitForReply = async (token, conversationId, timeoutMs = 300000) => {
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

const chat = async (token, payload, timeoutMs) => {
  const res = await fetch(`${BASE}/api/agents/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': UA },
    body: JSON.stringify({
      text: payload.text,
      sender: 'User',
      isCreatedByUser: true,
      parentMessageId: null,
      messageId: crypto.randomUUID(),
      conversationId: payload.conversationId ?? null,
      error: false,
      endpoint: payload.endpoint ?? 'SHAVI AI',
      endpointType: 'custom',
      model: payload.model ?? 'nvidia/nemotron-3-ultra-550b-a55b',
      spec: payload.spec ?? 'shavi-nemotron',
      ...(payload.agent_id ? { agent_id: payload.agent_id } : {}),
      ...(payload.files ? { files: payload.files } : {}),
      isTemporary: false,
      isRegenerate: false,
      isContinued: false,
      timezone: 'Asia/Kolkata',
      generationProtocolVersion: 1,
    }),
  });
  const body = await json(res);
  if (res.status !== 200 || !body?.conversationId) {
    return { status: res.status, body, reply: null };
  }
  const reply = await waitForReply(token, body.conversationId, timeoutMs);
  return { status: res.status, body, reply };
};

/** Upload a file the same way the composer does. */
const mimeFor = (filePath) =>
  ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf' })[
    path.extname(filePath).toLowerCase()
  ] ?? 'application/octet-stream';

const uploadFile = async (token, filePath, { toolResource, agentId } = {}) => {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(filePath)], { type: mimeFor(filePath) }), path.basename(filePath));
  form.append('file_id', crypto.randomUUID());
  form.append('endpoint', 'SHAVI AI');
  form.append('endpointType', 'custom');
  form.append('model', VISION_MODEL);
  if (agentId) form.append('agent_id', agentId);
  if (toolResource) {
    form.append('tool_resource', toolResource);
  } else if (agentId) {
    form.append('tool_resource', 'image_edit');
  } else {
    form.append('message_file', 'true');
  }
  const res = await fetch(`${BASE}/api/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
    body: form,
  });
  return { status: res.status, body: await json(res) };
};

const findAgent = async (token, name) => {
  const list = await json(
    await fetch(`${BASE}/api/agents`, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA } }),
  );
  const agents = Array.isArray(list) ? list : (list.data ?? []);
  const agent = agents.find((a) => a.name === name);
  if (!agent) return null;
  const detail = await json(
    await fetch(`${BASE}/api/agents/${agent.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
    }),
  );
  return { id: agent.id, tools: detail.tools ?? [], provider: detail.provider, model: detail.model };
};

/** Real speech audio: ask the gateway (Piper) to say a sentence we can check. */
const makeSpeech = async (text, voice, outPath) => {
  const res = await fetch(`${GATEWAY}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text, voice, model: 'shavi-tts' }),
  });
  if (!res.ok) throw new Error(`gateway TTS failed ${res.status}: ${await res.text()}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buffer);
  return buffer;
};

const main = async () => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const checks = {};
  const detail = {};
  const session = await login();
  const token = session.token;
  const auth = { Authorization: `Bearer ${token}`, 'User-Agent': UA };

  /* ---------------------------------------------------------------- capabilities */
  const health = await json(await fetch(`${GATEWAY}/health`));
  detail.gateway = health;
  const speechConfig = await json(await fetch(`${BASE}/api/files/speech/config/get`, { headers: auth }));
  detail.speechConfig = speechConfig;
  const voices = await json(await fetch(`${BASE}/api/files/speech/tts/voices`, { headers: auth }));
  detail.voices = voices;
  const imageAgent = await findAgent(token, IMAGE_AGENT);
  detail.imageAgent = imageAgent;
  const researchAgent = await findAgent(token, 'SHAVI Research');

  checks['gateway reports all three capabilities configured'] =
    health?.capabilities?.imageGeneration?.configured === true &&
    health?.capabilities?.textToSpeech?.configured === true &&
    health?.capabilities?.speechToText?.configured === true;
  checks['LibreChat advertises external STT and TTS'] =
    speechConfig?.sttExternal === true && speechConfig?.ttsExternal === true;
  checks['configured TTS voices are listed'] =
    Array.isArray(voices) && voices.includes('hi-IN-Pratham') && voices.includes('en-US-Lessac');
  checks['image tool exists only on the image agent'] =
    imageAgent?.tools?.includes('image_gen_oai') === true &&
    (researchAgent ? !researchAgent.tools.includes('image_gen_oai') : true);

  /* ------------------------------------------------------------ image generation */
  const imagePrompt =
    'Generate an image: a watercolor illustration of a small Himalayan village at sunrise with prayer flags, 1024x1024.';
  const imageTurn = await chat(token, {
    text: imagePrompt,
    spec: IMAGE_SPEC,
    endpoint: 'agents',
    ...(imageAgent?.id ? { agent_id: imageAgent.id } : {}),
  });
  const imageReply = imageTurn.reply;
  if (DUMP && imageReply) console.log(JSON.stringify(imageReply, null, 2).slice(0, 6000));
  const imageParts = imageReply ? parts(imageReply) : [];
  const toolCallParts = imageParts.filter((p) => JSON.stringify(p).includes('image_gen_oai'));
  const replyText = imageReply ? textOf(imageReply) : '';
  const inlineImages = imageReply ? imageUrlsOf(imageReply) : [];
  const savedImage = inlineImages.find((url) => url.startsWith('data:image/'));
  if (savedImage) {
    const base64 = savedImage.split(',')[1] ?? '';
    const bytes = Buffer.from(base64, 'base64');
    fs.writeFileSync(path.join(ARTIFACTS, 'm09-generated-image.jpg'), bytes);
    detail.generatedImageBytes = bytes.length;
    detail.generatedImageMagic = bytes.slice(0, 3).toString('hex');
  }

  const client = await MongoClient.connect(MONGO);
  const db = client.db();
  const storedImageMessage = imageReply
    ? await db.collection('messages').findOne({ messageId: imageReply.messageId })
    : null;
  const storedImageText = JSON.stringify(storedImageMessage?.content ?? '');
  /** The tool prints `generated_image_id: "<file_id>"`; that id is the stored file. */
  const generatedId = /generated_image_id:\s*\\?"([0-9a-f-]{36})\\?"/.exec(
    imageParts.map((p) => p.tool_call?.output ?? '').join('\n'),
  )?.[1];
  detail.generatedId = generatedId ?? null;
  const generatedFile = generatedId
    ? await db.collection('files').findOne({ file_id: generatedId })
    : null;
  detail.generatedFile = generatedFile
    ? { file_id: generatedFile.file_id, type: generatedFile.type, bytes: generatedFile.bytes, filepath: generatedFile.filepath }
    : null;
  // The stored image must really be served by the app, not just present in Mongo.
  let servedImage = null;
  if (generatedFile?.filepath) {
    const imageRes = await fetch(`${BASE}${generatedFile.filepath}`, {
      headers: { ...auth, ...(session.cookie ? { cookie: session.cookie } : {}) },
    });
    const imageBytes = Buffer.from(await imageRes.arrayBuffer());
    servedImage = {
      status: imageRes.status,
      contentType: imageRes.headers.get('content-type'),
      bytes: imageBytes.length,
      magic: imageBytes.slice(0, 3).toString('hex'),
    };
    if (imageRes.ok) fs.writeFileSync(path.join(ARTIFACTS, 'm09-generated-image.jpg'), imageBytes);
  }
  detail.servedImage = servedImage;

  checks['image tool was executed'] = toolCallParts.length > 0;
  checks['image generated by FLUX (real JPEG bytes)'] =
    generatedFile?.type === 'image/jpeg' &&
    generatedFile.bytes > 20000 &&
    servedImage?.magic === 'ffd8ff' &&
    servedImage?.bytes === generatedFile.bytes;
  checks['generated image stored and served by the app'] =
    servedImage?.status === 200 &&
    String(servedImage?.contentType).startsWith('image/') &&
    storedImageText.includes('image_gen_oai') &&
    storedImageText.includes(generatedFile?.file_id ?? '\u0000');

  /* -------------------------------------------------------- image understanding */
  // A PNG that carries a token the model can only know by looking at it.
  const understandingToken = `TOKEN-VISION-${Math.floor(1000 + Math.random() * 9000)}`;
  const pngPath = path.join(FIXTURE_DIR, 'vision-note.png');
  const { execFileSync } = await import('node:child_process');
  execFileSync('python3', ['tools/make-m09-fixtures.py', understandingToken, pngPath]);
  const convert = fs.existsSync(pngPath) && fs.statSync(pngPath).size > 5000;
  detail.visionFixtureBytes = fs.statSync(pngPath).size;
  let upload = null;
  let visionReply = null;
  if (convert) {
    upload = await uploadFile(token, pngPath);
    detail.visionUpload = { status: upload.status, file: upload.body?.filename ?? upload.body?._raw };
    const fileId = upload.body?.file_id ?? upload.body?.id;
    const fileMime = upload.body?.type ?? 'image/png';
    const visionTurn = await chat(
      token,
      {
        text: 'इस इमेज में जो टोकन (TOKEN-...) लिखा है और कुल राशि क्या है? दोनों बताओ।',
        spec: VISION_SPEC,
        model: VISION_MODEL,
        ...(fileId ? { files: [{ file_id: fileId, type: fileMime }] } : {}),
      },
      240000,
    );
    visionReply = visionTurn.reply;
    if (DUMP && visionReply) console.log(JSON.stringify(visionReply, null, 2).slice(0, 5000));
  }
  const visionText = visionReply ? textOf(visionReply) : '';
  detail.visionAnswer = visionText.slice(0, 400);
  detail.visionFileRecord = upload?.body?.file_id
    ? await db.collection('files').findOne({ file_id: upload.body.file_id })
    : null;

  checks['image understanding reads the token from the image'] =
    visionText.toUpperCase().includes(understandingToken) && /445000|4,45,000/.test(visionText);

  /* --------------------------------------------------------------- text to speech */
  const ttsText = 'नमस्ते, यह SHAVI AI की आवाज़ है। आपका स्वागत है।';
  const ttsRes = await fetch(`${BASE}/api/files/speech/tts/manual`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: ttsText, voice: 'hi-IN-Pratham' }),
  });
  const ttsBuffer = Buffer.from(await ttsRes.arrayBuffer());
  const ttsPath = path.join(FIXTURE_DIR, 'tts-hindi.wav');
  if (ttsRes.ok) fs.writeFileSync(ttsPath, ttsBuffer);
  const ttsIsWav = ttsBuffer.slice(0, 4).toString() === 'RIFF' && ttsBuffer.length > 20000;
  detail.tts = { status: ttsRes.status, bytes: ttsBuffer.length, contentType: ttsRes.headers.get('content-type') };
  checks['text-to-speech returns real audio bytes'] = ttsRes.ok && ttsIsWav;

  /* --------------------------------------------------------------- speech to text */
  // Speak a known sentence, then transcribe it through LibreChat's own STT route.
  const spoken = 'गोरखपुर में आज मौसम बहुत अच्छा है';
  const speechPath = path.join(FIXTURE_DIR, 'stt-source.wav');
  await makeSpeech(spoken, 'hi-IN-Pratham', speechPath);
  const sttForm = new FormData();
  sttForm.append('audio', new Blob([fs.readFileSync(speechPath)], { type: 'audio/wav' }), 'audio.wav');
  sttForm.append('language', 'hi');
  const sttRes = await fetch(`${BASE}/api/files/speech/stt`, {
    method: 'POST',
    headers: auth,
    body: sttForm,
  });
  const sttBody = await json(sttRes);
  detail.stt = { status: sttRes.status, body: sttBody };
  const transcript = String(sttBody?.text ?? '');
  const normalise = (s) => s.replace(/[^\u0900-\u097Fa-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const words = normalise(spoken).split(' ');
  const heard = normalise(transcript);
  const matched = words.filter((w) => heard.includes(w));
  detail.sttWordMatch = `${matched.length}/${words.length}`;
  // Whisper-small on CPU makes mistakes on proper nouns ("गोरखपुर" -> "गुरक्पूर"),
  // so the bar is that most content words of the spoken sentence come back.
  checks['speech-to-text returns a transcript of the spoken words'] =
    sttRes.ok && transcript.length > 5 && matched.length >= Math.ceil(words.length * 0.5);

  /* ----------------------------------- only configured providers advertise features */
  // A second gateway with no NVIDIA key must refuse image generation and must not
  // list an image model — the UI/config surface has to follow the provider config.
  const { spawn } = await import('node:child_process');
  const barePort = 4124;
  const bare = spawn(process.execPath, [path.resolve('shavi-media/gateway.mjs')], {
    env: {
      ...process.env,
      SHAVI_MEDIA_PORT: String(barePort),
      SHAVI_AI_KEY: '',
      NVIDIA_API_KEY: '',
      SHAVI_MEDIA_RUNTIME: path.resolve('shavi-media/runtime'),
    },
    stdio: 'ignore',
  });
  let bareHealth = null;
  try {
    for (let attempt = 0; attempt < 20 && !bareHealth; attempt += 1) {
      await new Promise((r) => setTimeout(r, 500));
      bareHealth = await fetch(`http://127.0.0.1:${barePort}/health`).then(json).catch(() => null);
    }
    const bareModels = await fetch(`http://127.0.0.1:${barePort}/v1/models`).then(json).catch(() => ({}));
    const bareImage = await fetch(`http://127.0.0.1:${barePort}/v1/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    });
    const bareImageBody = await json(bareImage);
    detail.unconfiguredGateway = {
      imageConfigured: bareHealth?.capabilities?.imageGeneration?.configured,
      models: bareModels?.data?.map((m) => m.type),
      imageStatus: bareImage.status,
      errorCode: bareImageBody?.error?.code,
    };
    checks['unconfigured image provider is hidden and refused'] =
      bareHealth?.capabilities?.imageGeneration?.configured === false &&
      !bareModels?.data?.some((m) => m.type === 'image') &&
      bareImage.status === 503 &&
      bareImageBody?.error?.code === 'not_configured';
  } finally {
    bare.kill('SIGKILL');
  }

  await client.close();

  console.log('\n--- detail ---');
  console.log(JSON.stringify(detail, null, 2).slice(0, 4000));
  console.log('\n--- checks ---');
  let failed = 0;
  for (const [name, pass] of Object.entries(checks)) {
    if (!pass) failed += 1;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  }
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} ${Object.keys(checks).length - failed}/${Object.keys(checks).length} checks`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
