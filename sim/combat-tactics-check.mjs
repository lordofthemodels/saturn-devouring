import assert from 'node:assert/strict';
import { FACTION } from '../shared/agentBuffer.js';
import { makeAgent, STATE } from './init.js';
import { TASK } from './hive.js';
import { updateHumansTick } from './humans.js';
import { sightRangeAt } from './combat.js';
import { Sim } from './sim.js';

const sim = new Sim('combat-tactics-check');
for (const agent of sim.agents) agent.dead = true;

const link = sim.graph.edges.find((edge) => edge.kind === 'std' && !edge.locked
  && sim.graph.node(edge.a).deck === sim.graph.node(edge.b).deck
  && [...sim.graph.neighbors(edge.a, ['std'], (candidate) => !candidate.locked)]
    .some(({ to }) => to !== edge.b));
assert.ok(link, 'combat tactics fixture needs an open doorway with a graph-derived escape');

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
assert.equal(attacker.task.kind, TASK.MOVE, 'an under-strength attack must become a retreat');
assert.equal(attacker.task.retreat, true, 'the retreat must be protected from strategic re-tasking');
assert.ok(attacker.move || attacker.path.length, 'a retreating form must immediately use an escape route');
assert.notEqual(attacker.move?.to ?? attacker.path[0]?.to, link.b,
  'the escape route must not cross the defended doorway');

attacker.path = [];
attacker.move = null;
const originalLocks = new Map(sim.graph.edges.map((edge) => [edge, edge.locked]));
for (const edge of sim.graph.edges) {
  if ((edge.a === link.a || edge.b === link.a) && edge !== link) edge.locked = true;
}
assert.equal(sim.hive.retreatOrFight(attacker, link.b), true,
  'a form with no open escape must turn and fight');
assert.equal(attacker.task.kind, TASK.ATTACK, 'a cornered form must attack');
assert.equal(attacker.task.force, true, 'the cornered attack must bypass the odds gate');
for (const [edge, locked] of originalLocks) edge.locked = locked;

forms[1].dead = false;
forms[2].dead = false;
sim._refreshOccupancy();
assert.equal(sim.hive.canPressCombatRoom(link.a, link.b), true,
  'three combat forms must satisfy the 3:1 threshold against one marine');
attacker.task = { kind: TASK.ATTACK, node: link.b };
sim.setPathTo(attacker, link.b, ['std'], (edge) => !edge.locked);
sim._advanceMovement(sim.dt);
assert.ok(attacker.move, 'a 3:1 pack must launch through the doorway');

forms[1].dead = true;
forms[2].dead = true;
marine.node = link.a;
marine.pnode = link.a;
marine.x = attacker.x + 2;
marine.y = attacker.y;
attacker.task = { kind: TASK.ATTACK, node: link.a };
attacker.path = [];
attacker.move = null;
sim._refreshOccupancy();
sim._spatialSteer(attacker, sim.dt);
assert.equal(attacker.task.kind, TASK.MOVE,
  'an outmatched form sharing a room with a marine must flee instead of waiting or fighting');
assert.equal(attacker.task.retreat, true, 'the in-room withdrawal must use the same retreat posture');

const doorwaySim = new Sim('marine-doorway-check');
for (const agent of doorwaySim.agents) agent.dead = true;
const darkDoor = doorwaySim.graph.edges.find((edge) => {
  if (edge.kind !== 'std' || edge.locked || !edge.door) return false;
  const a = doorwaySim.graph.node(edge.a), b = doorwaySim.graph.node(edge.b);
  if (a.deck !== b.deck) return false;
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  return distance > doorwaySim.P.combat.sightUnlitM + 1 && distance < 26
    && doorwaySim.losClear(a.x, a.y, edge.a, b.x, b.y, edge.b);
});
assert.ok(darkDoor, 'marine fixture needs a dynamically discovered dark doorway');
const squadMarine = doorwaySim.agents.find((agent) => agent.faction === FACTION.MARINE && agent.squad >= 0);
assert.ok(squadMarine, 'marine doorway fixture needs a line marine');
squadMarine.dead = false;
squadMarine.hp = squadMarine.maxHp = 45;
squadMarine.node = squadMarine.pnode = darkDoor.a;
squadMarine.x = doorwaySim.graph.node(darkDoor.a).x;
squadMarine.y = doorwaySim.graph.node(darkDoor.a).y;
squadMarine.state = STATE.IDLE;
squadMarine.path = [];
squadMarine.move = null;
squadMarine.frags = 0;
const doorwayForm = makeAgent(FACTION.COMBAT, darkDoor.b, doorwaySim.graph);
doorwayForm.hp = doorwayForm.maxHp = 90;
doorwayForm.x = doorwaySim.graph.node(darkDoor.b).x;
doorwayForm.y = doorwaySim.graph.node(darkDoor.b).y;
doorwaySim.spawn(doorwayForm);
doorwaySim.graph.lightMode[darkDoor.b] = 3;
const doorwaySquad = doorwaySim.squads[squadMarine.squad];
doorwaySquad.broken = false;
doorwaySquad.objective = { node: darkDoor.b, kind: 'sweep' };
doorwaySim._refreshOccupancy();
assert.ok(doorwaySim.losFloodThreat(squadMarine) > 0,
  'the marine must detect the form through the doorway');
assert.ok(Math.hypot(doorwayForm.x - squadMarine.x, doorwayForm.y - squadMarine.y)
  > sightRangeAt(doorwaySim, darkDoor.b), 'the dark-room form must be outside rifle acquisition range');
updateHumansTick(doorwaySim, doorwaySim.dt);
assert.notEqual(squadMarine.state, STATE.FIGHT,
  'a detected form outside rifle range must not freeze the marine in a fight state');
assert.ok(squadMarine.path.length > 0,
  'the squad must continue advancing until the doorway contact is within effective range');

console.log('combat doorway tactics ✓');
