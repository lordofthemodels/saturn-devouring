import assert from 'node:assert/strict';
import { FACTION } from '../shared/agentBuffer.js';
import { makeAgent, STATE } from './init.js';
import { TASK } from './hive.js';
import { updateHumansTick } from './humans.js';
import { resolveCombat } from './combat.js';
import { Sim } from './sim.js';

function openEscapeDoor(sim) {
  return sim.graph.edges.find((edge) => {
    if (edge.kind !== 'std' || edge.locked) return false;
    const a = sim.graph.node(edge.a), b = sim.graph.node(edge.b);
    return a.deck === b.deck
      && Math.hypot(b.x - a.x, b.y - a.y) < sim.P.combat.sightM
      && sim.losClear(a.x, a.y, edge.a, b.x, b.y, edge.b)
      && [...sim.graph.neighbors(edge.a, ['std'], (candidate) => !candidate.locked)]
        .some(({ to }) => to !== edge.b);
  });
}

const sim = new Sim('combat-tactics-check');
for (const agent of sim.agents) agent.dead = true;
const link = openEscapeDoor(sim);
assert.ok(link, 'combat fixture needs a visible doorway with a graph-derived escape');

const forms = [0, 1, 2].map(() => makeAgent(FACTION.COMBAT, link.a, sim.graph));
const marine = makeAgent(FACTION.MARINE, link.b, sim.graph);
for (const form of forms) { form.hp = form.maxHp = 90; sim.spawn(form); }
marine.hp = marine.maxHp = 100;
sim.spawn(marine);
forms[1].dead = true;
forms[2].dead = true;
sim.hive.allIn = false;
sim.tickCount = 1;
sim.t = sim.dt;
sim._refreshOccupancy();

const attacker = forms[0];
attacker.task = { kind: TASK.ATTACK, node: link.b };
sim.setPathTo(attacker, link.b, ['std'], (edge) => !edge.locked);
sim._advanceMovement(sim.dt);
assert.equal(attacker.task.kind, TASK.MOVE, 'an under-strength planned attack must become a retreat');
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
assert.equal(sim.hive.canPressCombatContact(attacker), true,
  'three visible combat forms must satisfy the planned 3:1 threshold against one marine');

// The exact standoff regression: a pack already withdrawing from the squad
// must not reverse when its leading marine steps through alone.
forms[1].dead = true;
forms[2].dead = true;
const rearMarines = [0, 1].map(() => makeAgent(FACTION.MARINE, link.b, sim.graph));
for (const rear of rearMarines) { rear.hp = rear.maxHp = 100; sim.spawn(rear); }
marine.node = marine.pnode = link.a;
marine.x = attacker.x + 2;
marine.y = attacker.y;
attacker.path = [];
attacker.move = null;
sim._refreshOccupancy();
assert.equal(sim.hive.retreatCombatForm(attacker, link.b), true, 'the outnumbered form must find an escape');
const retreatNode = attacker.task.node;
sim._spatialSteer(attacker, sim.dt);
assert.equal(attacker.task.retreat, true, 'the isolated pursuer must not flip a retreat back to aggression');
assert.equal(attacker.task.node, retreatNode, 'the retreat destination must remain stable');
const marineHp = marine.hp;
resolveCombat(sim, sim.dt);
assert.equal(marine.hp, marineHp, 'a fleeing form must not stop to pounce the marine crossing behind it');

// Incoming fire starts a persistent surge at even visible odds, but not when
// the shooter group actually outnumbers the form.
const surgeSim = new Sim('provoked-surge-check');
for (const agent of surgeSim.agents) agent.dead = true;
const surgeDoor = openEscapeDoor(surgeSim);
assert.ok(surgeDoor, 'surge fixture needs a visible doorway');
const surgeForm = makeAgent(FACTION.COMBAT, surgeDoor.a, surgeSim.graph);
const shooter = makeAgent(FACTION.MARINE, surgeDoor.b, surgeSim.graph);
surgeSim.spawn(surgeForm);
surgeSim.spawn(shooter);
surgeSim.tickCount = 1;
surgeSim.t = surgeSim.dt;
surgeSim._refreshOccupancy();
surgeForm.lastHurtBy = shooter.id;
surgeForm.lastHurtTick = surgeSim.tickCount;
surgeSim._spatialSteer(surgeForm, surgeSim.dt);
assert.equal(surgeForm.task.kind, TASK.ATTACK, 'a form fired on at even odds must attack');
assert.equal(surgeForm.task.surge, true, 'the provoked attack must persist as a surge');

const secondShooter = makeAgent(FACTION.MARINE, surgeDoor.b, surgeSim.graph);
surgeSim.spawn(secondShooter);
surgeForm.task = null;
surgeForm.path = [];
surgeForm.move = null;
surgeSim._refreshOccupancy();
surgeSim._spatialSteer(surgeForm, surgeSim.dt);
assert.equal(surgeForm.task.retreat, true, 'a form fired on by superior visible numbers must flee');

// LOS is allowed to cross more than one graph node. A marine detecting such a
// target must enter FIGHT and actually fire through the aligned openings.
const doorwaySim = new Sim('marine-los-check');
for (const agent of doorwaySim.agents) agent.dead = true;
let sightPair = null;
for (const a of doorwaySim.graph.nodes) {
  for (const b of doorwaySim.graph.nodes) {
    if (a.idx >= b.idx || a.deck !== b.deck) continue;
    const hops = doorwaySim.graph.hops(a.idx, b.idx, ['std'], () => true);
    if (hops <= 1 || Math.hypot(b.x - a.x, b.y - a.y) >= doorwaySim.P.combat.sightM) continue;
    if (doorwaySim.losClear(a.x, a.y, a.idx, b.x, b.y, b.idx)) { sightPair = { a, b }; break; }
  }
  if (sightPair) break;
}
assert.ok(sightPair, 'marine fixture needs a dynamically discovered multi-room sightline');
const squadMarine = doorwaySim.agents.find((agent) => agent.faction === FACTION.MARINE && agent.squad >= 0);
assert.ok(squadMarine, 'marine LOS fixture needs a line marine');
squadMarine.dead = false;
squadMarine.hp = squadMarine.maxHp = 45;
squadMarine.node = squadMarine.pnode = sightPair.a.idx;
squadMarine.deck = sightPair.a.deck;
squadMarine.x = sightPair.a.x;
squadMarine.y = sightPair.a.y;
squadMarine.state = STATE.IDLE;
squadMarine.path = [];
squadMarine.move = null;
squadMarine.frags = 0;
squadMarine.flamer = false;
squadMarine._sawThreatT = 0;
const doorwayForm = makeAgent(FACTION.COMBAT, sightPair.b.idx, doorwaySim.graph);
doorwayForm.hp = doorwayForm.maxHp = 90;
doorwaySim.spawn(doorwayForm);
const doorwaySquad = doorwaySim.squads[squadMarine.squad];
doorwaySquad.broken = false;
doorwaySquad.objective = { node: sightPair.b.idx, kind: 'sweep' };
doorwaySim.P.combat.marine.gun.accNear = 1;
doorwaySim.P.combat.marine.gun.accFar = 1;
doorwaySim.P.combat.marksmanSpread = 0;
doorwaySim.P.darkness.darkAccMult = 1;
doorwaySim.P.darkness.fogAccMult = 1;
doorwaySim.P.darkness.unlitAccMult = 1;
doorwaySim.P.darkness.flickerAccMult = 1;
doorwaySim._refreshOccupancy();
assert.ok(doorwaySim.lineOfSightAgents(squadMarine, (a) => a === doorwayForm).includes(doorwayForm),
  'the shared LOS query must see through multiple aligned openings');
updateHumansTick(doorwaySim, doorwaySim.dt);
assert.equal(squadMarine.state, STATE.FIGHT, 'a visible cross-room form must start the firefight');
const formHp = doorwayForm.hp;
resolveCombat(doorwaySim, doorwaySim.dt);
assert.ok(doorwayForm.hp < formHp, 'the marine must fire through the same sightline it detected');

console.log('combat LOS tactics ✓');
