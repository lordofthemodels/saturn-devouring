import assert from 'node:assert/strict';
import { FACTION } from '../shared/agentBuffer.js';
import { TASK } from './hive.js';
import { Sim } from './sim.js';

const sim = new Sim('navigation-check');
const form = sim.agents.find((agent) => agent.faction === FACTION.INFECTION);
const corpse = sim.agents.find((agent) => agent.faction === FACTION.CORPSE && !agent.dead);
assert.ok(form && corpse, 'navigation fixture needs an infection form and corpse');

const destination = sim.graph.node(corpse.pnode ?? corpse.node);
form.task = { kind: TASK.CONVERT, corpseId: corpse.id };
assert.deepEqual(sim._moveArrivalPoint(form, destination), [corpse.x, corpse.y],
  'a committed infection form must leave a vent heading directly to its corpse');
corpse.x += 2;
corpse.y -= 1;
assert.deepEqual(sim._moveArrivalPoint(form, destination), [corpse.x, corpse.y],
  'the vent exit must track a corpse that is still settling');

corpse.claimed = true;
for (const agent of sim.agents) {
  if (agent.faction === FACTION.CORPSE) agent.claimed = true;
}
sim.hive.beliefs.clear();
assert.equal(sim.hive.nearestFoodNode(form), -1,
  'claimed corpses must not hold an idle form in a room with no usable body');

console.log('infection navigation ✓');
