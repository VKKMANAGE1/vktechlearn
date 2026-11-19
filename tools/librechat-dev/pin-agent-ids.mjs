#!/usr/bin/env node
/**
 * Pins stable ids onto the agents that librechat.yaml names in its model specs.
 *
 * With `modelSpecs.enforce: true`, every chat must carry a spec, and a spec's
 * `preset.agent_id` is what actually equips an agent's tools — a bare `agent_id`
 * on the request is overwritten by the selected spec's preset. The agents are
 * created through the API (random ids), so this script rewrites their `id` to the
 * value the tracked config references, which keeps the config reproducible on a
 * fresh database. Idempotent: re-running only reports the existing pins.
 *
 *   node tools/librechat-dev/pin-agent-ids.mjs
 */
import { createRequire } from 'node:module';

/** LibreChat ships mongoose; the repo root does not need its own copy. */
const requireFromLibreChat = createRequire(new URL('../../librechat/package.json', import.meta.url));
const mongoose = requireFromLibreChat('mongoose');

const MONGO = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/LibreChat';

/** Agent name -> id referenced by librechat-deploy/librechat.yaml */
const PINNED_IDS = {
  'SHAVI Image': 'agent_shavi_image',
  'SHAVI Research': 'agent_shavi_research',
  'SHAVI Workspace': 'agent_shavi_workspace',
};

const main = async () => {
  await mongoose.connect(MONGO);
  const agents = mongoose.connection.db.collection('agents');
  let problems = 0;

  for (const [name, id] of Object.entries(PINNED_IDS)) {
    const agent = await agents.findOne({ name });
    if (!agent) {
      console.log(`MISSING  ${name} — run its create script first`);
      problems += 1;
      continue;
    }
    if (agent.id === id) {
      console.log(`OK       ${name} -> ${id}`);
      continue;
    }
    const clash = await agents.findOne({ id });
    if (clash) {
      console.log(`CONFLICT ${id} already belongs to ${clash.name}`);
      problems += 1;
      continue;
    }
    await agents.updateOne({ _id: agent._id }, { $set: { id } });
    console.log(`PINNED   ${name} ${agent.id} -> ${id}`);
  }

  await mongoose.disconnect();
  process.exit(problems === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
