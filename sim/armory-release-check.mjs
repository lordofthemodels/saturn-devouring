import assert from 'node:assert/strict';
import { FACTION } from '../shared/agentBuffer.js';
import { Sim } from './sim.js';

const releases = [];
for (let index = 0; index < 32; index++) {
  const sim = new Sim(`armory-release-${index}`);
  assert.ok(sim.armoryReleaseAt >= 5 * 60 && sim.armoryReleaseAt < 8 * 60,
    `seed ${index} must release between five and eight minutes`);
  releases.push(sim.armoryReleaseAt);
}
assert.ok(Math.max(...releases) - Math.min(...releases) > 2 * 60,
  'seeded release times must vary across most of the three-minute window');

const seed = 'armory-release-force-independence';
const first = new Sim(seed);
const replay = new Sim(seed);
assert.equal(first.armoryReleaseAt, replay.armoryReleaseAt,
  'the same seed must reproduce the same release time');

// Force makeup is deliberately irrelevant. Remove every Deck 1 marine and
// the seal must still wait for the seed timer, then open exactly on it.
for (const agent of first.agents) {
  if (agent.faction === FACTION.MARINE && first.graph.node(agent.node).deck === 1) {
    agent.dead = true;
    agent.hp = 0;
  }
}
first.t = first.armoryReleaseAt - 0.001;
first._armoryWatch();
assert.equal(first.armoryLocked, true, 'Deck 1 losses must not release the reserve early');

first.t = first.armoryReleaseAt;
first._armoryWatch();
assert.equal(first.armoryLocked, false, 'the seed timer must release the reserve');
const armory = first.graph.byId.get('armory');
assert.ok(first.graph.edges
  .filter((edge) => edge.a === armory || edge.b === armory)
  .every((edge) => !edge.locked), 'the timed release must open every armory seal');

console.log(`armory release check passed (${Math.min(...releases).toFixed(1)}s–${Math.max(...releases).toFixed(1)}s)`);
