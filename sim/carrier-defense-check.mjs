import assert from 'node:assert/strict';
import { FACTION } from '../shared/agentBuffer.js';
import { makeAgent } from './init.js';
import { TASK } from './hive.js';
import { Sim } from './sim.js';

const sim = new Sim('carrier-defense-check');
for (const agent of sim.agents) agent.dead = true;

// Find a topology-derived four-hop approach so this remains valid if rooms
// are renamed or the ship layout changes.
let fixture = null;
for (const carrierNode of sim.graph.nodes) {
  for (const threatNode of sim.graph.nodes) {
    const path = sim.graph.path(carrierNode.idx, threatNode.idx, ['std'], sim.hive.bigPass);
    if (path?.length >= 4) {
      fixture = { carrierNode: carrierNode.idx, threatNode: threatNode.idx, path };
      break;
    }
  }
  if (fixture) break;
}
assert.ok(fixture, 'carrier-defense fixture needs a four-hop standard route');

const carrier = makeAgent(FACTION.CARRIER, fixture.carrierNode, sim.graph);
carrier.hp = carrier.maxHp = sim.P.combat.carrierHp;
carrier.held = 1;
sim.spawn(carrier);
const forms = Array.from({ length: 4 }, () =>
  makeAgent(FACTION.COMBAT, fixture.path[2].to, sim.graph));
for (const form of forms) { form.hp = form.maxHp = 90; sim.spawn(form); }

sim.hive.believedHardness.fill(0);
sim.hive.believedHumanStr.fill(0);
sim.hive.believedHardness[fixture.threatNode] = 4;
sim.hive.believedHumanStr[fixture.threatNode] = 4;
const scarcity = sim.hive.scarcity(2);
sim.hive.protectCarriers(forms, [carrier], scarcity);
const guards = forms.filter((form) => form.task?.protect === carrier.id);
assert.equal(guards.length, 3,
  'a thin four-form hive must recall three bodies around its only carrier');
const forwardScreen = fixture.path[0].to;
assert.ok(guards.every((form) => form.task.kind === TASK.GUARD
  && form.task.node === forwardScreen && form.task.threatNode === fixture.threatNode),
'the carrier screen must occupy the first safe approach node and face the known threat');

// Reinforcements one room from the carrier make that forward screen hot; the
// same planner must collapse the line into the carrier room without any room ID.
const closeThreat = fixture.path[1].to;
sim.hive.believedHardness.fill(0);
sim.hive.believedHumanStr.fill(0);
sim.hive.believedHardness[closeThreat] = 4;
sim.hive.believedHumanStr[closeThreat] = 4;
sim.hive.protectCarriers(forms, [carrier], scarcity);
assert.ok(forms.filter((form) => form.task?.protect === carrier.id)
  .every((form) => form.task.node === fixture.carrierNode),
'a worsening adjacent gun line must pull the screen back into the carrier room');

// A form caught between that gun line and the carrier chooses the carrier-side
// fallback before the generic "farthest room" retreat.
const retreating = forms[0];
retreating.node = fixture.path[1].to;
retreating.pnode = retreating.node;
retreating.x = sim.graph.node(retreating.node).x;
retreating.y = sim.graph.node(retreating.node).y;
retreating.move = null;
retreating.path = [];
retreating.task = null;
assert.equal(sim.hive.retreatCombatForm(retreating, closeThreat), true,
  'a clean carrier-side retreat must be available');
assert.equal(retreating.task.protect, carrier.id,
  'the retreat must preserve the critical carrier');
assert.equal(retreating.task.node, fixture.carrierNode,
  'the retreat must end on the collapsed carrier screen');
assert.equal(retreating.task.retreat, true,
  'the carrier fallback remains protected from re-tasking in transit');

retreating.node = fixture.carrierNode;
retreating.pnode = retreating.node;
retreating.x = sim.graph.node(retreating.node).x;
retreating.y = sim.graph.node(retreating.node).y;
retreating.move = null;
retreating.path = [];
retreating.task = { kind: TASK.GUARD, node: fixture.carrierNode,
  protect: carrier.id, threatNode: closeThreat };
assert.equal(sim.hive.retreatCombatForm(retreating, closeThreat), false,
  'a guard already backed onto its carrier must stand and fight instead of abandoning it');

carrier.dead = true;
sim.hive.protectCarriers(forms, [], scarcity);
assert.ok(forms.every((form) => form.task?.protect === undefined),
  'a dead carrier must release its obsolete defense detail');

console.log('carrier defense check passed');
