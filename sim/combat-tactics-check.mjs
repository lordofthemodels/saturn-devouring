import assert from 'node:assert/strict';
import { FACTION } from '../shared/agentBuffer.js';
import { makeAgent } from './init.js';
import { TASK } from './hive.js';
import { Sim } from './sim.js';

const sim = new Sim('combat-tactics-check');
for (const agent of sim.agents) agent.dead = true;

const link = sim.graph.edges.find((edge) => edge.kind === 'std' && !edge.locked
  && sim.graph.node(edge.a).deck === sim.graph.node(edge.b).deck);
assert.ok(link, 'combat tactics fixture needs an open same-deck doorway');

const forms = [0, 1, 2].map(() => makeAgent(FACTION.COMBAT, link.a, sim.graph));
const marine = makeAgent(FACTION.MARINE, link.b, sim.graph);
for (const form of forms) { form.hp = form.maxHp = 90; sim.spawn(form); }
marine.hp = marine.maxHp = 100;
sim.spawn(marine);
forms[1].dead = true;
forms[2].dead = true;
sim.hive.allIn = false;
sim.tickCount = 1; // makeAgent's held=0 sentinel is only inactive after tick zero
sim.t = sim.dt;
sim._refreshOccupancy();

const attacker = forms[0];
attacker.task = { kind: TASK.ATTACK, node: link.b };
sim.setPathTo(attacker, link.b, ['std'], (edge) => !edge.locked);
sim._advanceMovement(sim.dt);
assert.equal(attacker.move, null, 'a lone form must not cross into an armed room');
assert.equal(attacker.path.length, 0, 'an under-strength attack must hold at the doorway');
assert.equal(attacker.task.node, link.a, 'the held attack must stage in its current room');
attacker.task = { kind: TASK.ATTACK, node: link.a };
sim._spatialSteer(attacker, sim.dt);
assert.equal(attacker.path.length, 0,
  'seeing a marine next door must not bypass the live doorway odds check');

forms[1].dead = false;
forms[2].dead = false;
sim._refreshOccupancy();
assert.equal(sim.hive.canPressCombatRoom(link.a, link.b), true,
  'three combat forms must satisfy the 3:1 threshold against one marine');
attacker.task = { kind: TASK.ATTACK, node: link.b };
sim.setPathTo(attacker, link.b, ['std'], (edge) => !edge.locked);
sim._advanceMovement(sim.dt);
assert.ok(attacker.move, 'a 3:1 pack must launch through the doorway');

console.log('combat doorway tactics ✓');
