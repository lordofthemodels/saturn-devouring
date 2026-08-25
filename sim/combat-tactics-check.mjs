import assert from 'node:assert/strict';
import { FACTION } from '../shared/agentBuffer.js';
import { makeAgent, STATE } from './init.js';
import { TASK } from './hive.js';
import { updateHumansTick } from './humans.js';
import { updateFloodTick } from './floodExec.js';
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

// A retreat issued during a doorway leg must replace that leg. Otherwise the
// old crossing lands first and the new path begins with an edge connected to
// the room left behind, which lets the form traverse an unrelated lift.
attacker.task = { kind: TASK.ATTACK, node: link.b };
attacker.node = attacker.pnode = link.a;
attacker.deck = sim.graph.node(link.a).deck;
attacker.x = sim.graph.node(link.a).x;
attacker.y = sim.graph.node(link.a).y;
attacker.path = [];
attacker.move = { from: link.a, to: link.b, link, layer: 'std', t: 0.25, travelSec: 1 };
assert.equal(sim.hive.retreatCombatForm(attacker, link.b), true,
  'a mid-doorway form must still find its connected escape');
assert.equal(attacker.move, null, 'retreat must cancel the superseded doorway leg');
let routeNode = attacker.node;
for (const step of attacker.path) {
  const next = step.link.a === routeNode ? step.link.b : step.link.b === routeNode ? step.link.a : -1;
  assert.equal(next, step.to, 'every retreat edge must connect to the preceding room');
  routeNode = step.to;
}

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
const reinforcements = [0, 1].map(() => makeAgent(FACTION.COMBAT, surgeDoor.a, surgeSim.graph));
for (const ally of reinforcements) surgeSim.spawn(ally);
surgeSim._refreshOccupancy();
surgeSim._spatialSteer(surgeForm, surgeSim.dt);
for (const form of [surgeForm, ...reinforcements]) {
  assert.equal(form.task.kind, TASK.ATTACK, 'reinforcements changing the odds must reverse the whole pack into attack');
  assert.equal(form.task.surge, true, 'the renewed response must remain one shared surge');
}

// One appendage being shot gives the whole visible pack one response. Every
// member abandons its stale destination, pursues the shared nearest marine,
// and keeps the charge multiplier through the intervening doorway.
const packSim = new Sim('shared-pack-response-check');
for (const agent of packSim.agents) agent.dead = true;
const packDoor = openEscapeDoor(packSim);
assert.ok(packDoor, 'pack fixture needs a visible doorway and alternate route');
const escape = [...packSim.graph.neighbors(packDoor.a, ['std'], (edge) => !edge.locked)]
  .find(({ to }) => to !== packDoor.b);
assert.ok(escape, 'pack fixture needs a stale destination away from the shooter');
const packForms = [0, 1, 2].map(() => makeAgent(FACTION.COMBAT, packDoor.a, packSim.graph));
const packShooter = makeAgent(FACTION.MARINE, packDoor.b, packSim.graph);
for (const form of packForms) {
  form.hp = form.maxHp = 90;
  packSim.spawn(form);
  form.task = { kind: TASK.GUARD, node: escape.to };
  packSim.setPathTo(form, escape.to, ['std'], (edge) => !edge.locked);
}
packSim.spawn(packShooter);
packShooter.dead = true;
packSim.tickCount = 1;
packSim.t = packSim.dt;
packSim._refreshOccupancy();
packSim._advanceMovement(packSim.dt);
assert.ok(packForms.every((form) => form.move), 'pack fixture must begin on stale move legs');
packShooter.dead = false;
packSim._refreshOccupancy();
packForms[0].lastHurtBy = packShooter.id;
packForms[0].lastHurtTick = packSim.tickCount;
packSim._spatialSteer(packForms[0], packSim.dt);
for (const form of packForms) {
  assert.equal(form.task.kind, TASK.ATTACK, 'one incoming round must turn every pack member onto combat');
  assert.equal(form.task.surge, true, 'the entire responding pack must share the surge');
  assert.equal(form.task.targetId, packShooter.id, 'each appendage must pursue the shared nearest marine');
}
for (const form of packForms.slice(1)) packSim._spatialSteer(form, packSim.dt);
assert.ok(packForms.every((form) => !form.move), 'live contact must cancel every stale move leg');
packSim._advanceMovement(packSim.dt);
for (const form of packForms) {
  assert.equal(form.charging, true, 'a cross-room surge must begin at charge speed');
  assert.ok(form.move, 'each pack member must immediately start through the doorway');
  const move = form.move;
  const d1 = Math.hypot(move.link.door.x - move.sx, move.link.door.y - move.sy);
  const d2 = Math.hypot(move.tx - move.link.door.x, move.ty - move.link.door.y);
  const walking = (d1 + d2) / (packSim.P.movement.baseMps * packSim._speedMult(form));
  assert.ok(Math.abs(move.travelSec - walking / packSim.P.speed.chargeMult) < 1e-6,
    'a surge leg must use the full charge multiplier without per-form slowdown');
}
const firstLegs = packForms.map((form) => form.move);
packSim.tickCount++;
packSim.t += packSim.dt;
packSim._refreshOccupancy();
for (const form of packForms) packSim._spatialSteer(form, packSim.dt);
assert.ok(packForms.every((form, i) => form.move === firstLegs[i]),
  'a live cross-room chase must preserve its in-progress doorway leg');
packSim._advanceMovement(packSim.dt);
assert.ok(packForms.every((form) => form.move.t > 0),
  'a preserved doorway charge must gain progress on the following tick');

// Even when several forms begin at the same pixel, the shared charge remains
// a crowd of solid bodies rather than one stacked glyph.
const stackSim = new Sim('stacked-pack-check');
for (const agent of stackSim.agents) agent.dead = true;
const stackRoom = stackSim.graph.nodes.find((node) => node.w >= 10 && node.d >= 6);
assert.ok(stackRoom, 'stack fixture needs open floor');
const stacked = [0, 1, 2].map(() => makeAgent(FACTION.COMBAT, stackRoom.idx, stackSim.graph));
const loneMarine = makeAgent(FACTION.MARINE, stackRoom.idx, stackSim.graph);
for (const form of stacked) {
  form.x = stackRoom.x - 2;
  form.y = stackRoom.y;
  stackSim.spawn(form);
}
loneMarine.x = stackRoom.x + 2;
loneMarine.y = stackRoom.y;
stackSim.spawn(loneMarine);
stackSim.tickCount = 1;
stackSim.t = stackSim.dt;
stackSim._refreshOccupancy();
stacked[0].lastHurtBy = loneMarine.id;
stacked[0].lastHurtTick = stackSim.tickCount;
stackSim._spatialSteer(stacked[0], stackSim.dt);
for (const form of stacked.slice(1)) stackSim._spatialSteer(form, stackSim.dt);
stackSim._separate(stackSim.dt);
for (let i = 0; i < stacked.length; i++) for (let j = i + 1; j < stacked.length; j++) {
  assert.ok(Math.hypot(stacked[i].x - stacked[j].x, stacked[i].y - stacked[j].y) > 0.1,
    'responding combat forms must separate instead of stacking');
}

// Under live pressure with no infection economy, scarcity roots one or two
// rearmost carrier seeds and turns the remaining forms into a screen.
const seedSim = new Sim('pressured-carrier-seed-check');
for (const agent of seedSim.agents) agent.dead = true;
const seedDoor = openEscapeDoor(seedSim);
assert.ok(seedDoor, 'carrier seed fixture needs a defended front and rear route');
const rear = [...seedSim.graph.neighbors(seedDoor.a, ['std'], (edge) => !edge.locked)]
  .find(({ to }) => to !== seedDoor.b);
assert.ok(rear, 'carrier seed fixture needs rearmost ground');
const seedForms = [0, 1, 2, 3, 4, 5].map((_, i) =>
  makeAgent(FACTION.COMBAT, i < 3 ? seedDoor.a : rear.to, seedSim.graph));
const seedMarine = makeAgent(FACTION.MARINE, seedDoor.b, seedSim.graph);
for (const form of seedForms) seedSim.spawn(form);
seedSim.spawn(seedMarine);
seedSim.t = 100;
seedSim.tickCount = Math.round(seedSim.t / seedSim.dt);
seedSim.hive.opening = true;
seedSim.hive.posture = 'EVASIVE';
seedSim.hive.allIn = false;
seedSim._refreshOccupancy();
seedSim._computeInfluence();
seedSim.hive.openingMove([], seedForms, []);
const roots = seedForms.filter((form) => form.task?.kind === TASK.TRANSFORM);
assert.ok(roots.length >= 1 && roots.length <= 2, 'a cornered pocket must root one or two carrier seeds');
assert.ok(roots.some((form) => (form.pnode ?? form.node) === rear.to),
  'the pressured carrier plan must choose the rearmost available ground');
assert.ok(seedForms.filter((form) => form.task?.screen !== undefined).length >= seedForms.length - roots.length - 1,
  'the remaining pocket must screen the carrier seeds instead of wandering');

// The screenshot regression: a roomful of forms outside four rifles is one
// connected hive response. The appendage with the sightline commits the whole
// 3:1-plus mass instead of repeatedly probing the doorway alone.
const breachSim = new Sim('overwhelming-door-breach-check');
for (const agent of breachSim.agents) agent.dead = true;
const breachDoor = openEscapeDoor(breachSim);
assert.ok(breachDoor, 'overwhelming breach fixture needs a visible doorway');
const breachForms = Array.from({ length: 15 }, () => makeAgent(FACTION.COMBAT, breachDoor.a, breachSim.graph));
const breachMarines = Array.from({ length: 4 }, () => makeAgent(FACTION.MARINE, breachDoor.b, breachSim.graph));
for (const form of breachForms) breachSim.spawn(form);
for (const defender of breachMarines) breachSim.spawn(defender);
breachSim.tickCount = 1;
breachSim.t = breachSim.dt;
breachSim._refreshOccupancy();
breachForms[0].lastHurtBy = breachMarines[0].id;
breachForms[0].lastHurtTick = breachSim.tickCount;
breachSim._spatialSteer(breachForms[0], breachSim.dt);
assert.ok(breachForms.every((form) => form.task?.kind === TASK.ATTACK && form.task.surge),
  'an overwhelming pack must surge through the doorway as one response');
assert.ok(breachForms.every((form) => form.task.targetId !== undefined),
  'every appendage in the breach must receive a concrete marine target');

// An all-in hive must be able to see and route to survivors behind another
// remembered gun line. Previously nearestBelievedHuman returned no target and
// the entire rear mass idled at its carrier node.
const allInSim = new Sim('all-in-routing-check');
for (const agent of allInSim.agents) agent.dead = true;
const allInFrom = allInSim.graph.nodes.find((node) =>
  allInSim.graph.nodesWithin(node.idx, 2, ['std'], allInSim.hive.bigPass).length > 2);
assert.ok(allInFrom, 'all-in fixture needs a route at least two rooms long');
const allInTarget = allInSim.graph.nodesWithin(allInFrom.idx, 2, ['std'], allInSim.hive.bigPass)
  .find((node) => allInSim.graph.hops(allInFrom.idx, node, ['std'], allInSim.hive.bigPass) === 2);
assert.notEqual(allInTarget, undefined, 'all-in fixture needs a target behind an intermediate room');
allInSim.hive.believedHumanStr.fill(0);
allInSim.hive.believedHardness.fill(0);
allInSim.hive.believedHumanStr[allInTarget] = 1;
for (const { to } of allInSim.graph.neighbors(allInFrom.idx, ['std'], allInSim.hive.bigPass)) {
  allInSim.hive.believedHardness[to] = 1;
}
assert.equal(allInSim.hive.nearestBelievedHuman(allInFrom.idx), -1,
  'measured routing should still reject an intervening gun line');
assert.equal(allInSim.hive.nearestAllInHuman(allInFrom.idx), allInTarget,
  'all-in routing must retain the survivor behind that line as an objective');
const allInForm = makeAgent(FACTION.COMBAT, allInFrom.idx, allInSim.graph);
allInSim.spawn(allInForm);
allInSim.hive.allIn = true;
allInForm.task = { kind: TASK.ATTACK, node: allInTarget };
updateFloodTick(allInSim, allInSim.dt);
assert.ok(allInForm.path.length > 0,
  'an all-in attack must take the direct breach route instead of idling');

// If the hive's live contacts all go stale while the crew manifest still says
// prey remains, its combat mass fans across the graph rather than guarding
// empty carrier rooms. Different ids should naturally cover different nodes.
const sweepSim = new Sim('all-in-sweep-check');
for (const agent of sweepSim.agents) agent.dead = true;
const sweepForms = Array.from({ length: 10 }, () => makeAgent(FACTION.COMBAT, sweepSim.graph.breachNode, sweepSim.graph));
const sweepPods = Array.from({ length: 6 }, () => makeAgent(FACTION.INFECTION, sweepSim.graph.breachNode, sweepSim.graph));
for (const form of sweepForms) sweepSim.spawn(form);
for (const form of sweepPods) sweepSim.spawn(form);
sweepSim.hive.opening = false;
sweepSim.hive.allIn = true;
sweepSim.hive.searchingAll = true;
sweepSim.hive.posture = 'AGGRESSIVE';
sweepSim.hive.believedHumanStr.fill(0);
sweepSim.hive.believedHardness.fill(0);
sweepSim._refreshOccupancy();
sweepSim._computeInfluence();
sweepSim.hive.steadyState(sweepPods, sweepForms, [], [], sweepPods.length, sweepForms.length, 5, 1);
const sweeps = sweepForms.filter((form) => form.task?.kind === TASK.SCOUT && form.task.sweep);
assert.equal(sweeps.length, sweepForms.length,
  'an all-in hive without a contact must send every free combat form searching');
assert.ok(new Set(sweeps.map((form) => form.task.node)).size > 1,
  'the endgame search must fan out across the live graph instead of forming another pile');
assert.ok(sweepPods.every((form) => form.task?.kind === TASK.SCOUT && form.task.sweep),
  'free infection forms must join the shared coverage sweep instead of parking at a carrier');
assert.ok(new Set(sweepPods.map((form) => form.task.node)).size > 1,
  'infection-form coverage must distribute across the topology');

// Contact decay erases a location, not the shared hive's knowledge that the
// person remains unaccounted for. Deleting the whole record made hidden last
// survivors cease to exist in the hive's decision model.
const memorySim = new Sim('contact-memory-check');
for (const agent of memorySim.agents) agent.dead = true;
const hiddenMarine = makeAgent(FACTION.MARINE, memorySim.graph.nodes.at(-1).idx, memorySim.graph);
memorySim.spawn(hiddenMarine);
memorySim.hive.beliefs = new Map([[hiddenMarine.id,
  { node: hiddenMarine.node, t: 0, conf: 0.051 }]]);
memorySim.t = memorySim.P.sim.strategicTickSec;
memorySim.hive.updateBeliefs();
assert.equal(memorySim.hive.beliefs.has(hiddenMarine.id), true,
  'a faded contact must retain the survivor identity');
assert.equal(memorySim.hive.beliefs.get(hiddenMarine.id).conf, 0,
  'a faded contact must stop contributing a guessed position');
assert.equal(memorySim.hive.believedHumanStr.reduce((sum, value) => sum + value, 0), 0,
  'an unknown survivor must not leak ground-truth location into tactical beliefs');

// The player is an armed-crew agent while their fireteam uses the marine
// faction. Faction priority must never make a form run past the closer player
// to reach a farther squadmate; both pursuit and the actual swipe use distance.
const playerTargetSim = new Sim('nearest-player-target-check');
for (const agent of playerTargetSim.agents) agent.dead = true;
const playerRoom = playerTargetSim.graph.nodes.find((node) => node.w >= 10 && node.d >= 6);
assert.ok(playerRoom, 'player target fixture needs an open room');
const playerHunter = makeAgent(FACTION.COMBAT, playerRoom.idx, playerTargetSim.graph);
const closePlayer = makeAgent(FACTION.ARMED, playerRoom.idx, playerTargetSim.graph);
const farMarine = makeAgent(FACTION.MARINE, playerRoom.idx, playerTargetSim.graph);
playerHunter.x = playerRoom.x - 1;
playerHunter.y = playerRoom.y;
closePlayer.x = playerRoom.x;
closePlayer.y = playerRoom.y;
closePlayer.hp = closePlayer.maxHp = 45;
closePlayer.isPlayer = true;
farMarine.x = playerRoom.x + 1;
farMarine.y = playerRoom.y;
farMarine.hp = farMarine.maxHp = 45;
playerTargetSim.spawn(playerHunter);
playerTargetSim.spawn(closePlayer);
playerTargetSim.spawn(farMarine);
playerTargetSim.tickCount = 1;
playerTargetSim.t = playerTargetSim.dt;
playerTargetSim.hive.allIn = true;
playerTargetSim._refreshOccupancy();
assert.equal(playerTargetSim.hive.nearestCombatTarget(playerHunter), closePlayer,
  'a combat form must target the closer player instead of a farther marine');
assert.equal(playerTargetSim.hive.respondToCombat(playerHunter, closePlayer), true,
  'the shared hive response must commit the hunter to the closer player');
assert.equal(playerHunter.task.targetId, closePlayer.id,
  'the live pursuit task must stay on the closer player');
const playerHp = closePlayer.hp;
const marineHpBefore = farMarine.hp;
resolveCombat(playerTargetSim, playerTargetSim.dt);
assert.ok(closePlayer.hp < playerHp, 'the nearest player must receive the combat-form swipe');
assert.equal(farMarine.hp, marineHpBefore, 'the farther marine must not absorb the player\'s attack');

// A grand stair is one open volume. Its combat sightline works in both
// directions, and traversal never gives an agent coordinates from one deck
// while its logical room still belongs to another.
const stairSim = new Sim('grand-stair-frame-check');
for (const agent of stairSim.agents) agent.dead = true;
assert.ok(stairSim.graph.stairwells.length, 'stair fixture needs a grand stairwell');
const stair = stairSim.graph.stairwells[0];
const upperMarine = makeAgent(FACTION.MARINE, stair.upper, stairSim.graph);
const lowerForm = makeAgent(FACTION.COMBAT, stair.lower, stairSim.graph);
stairSim.tickCount = 1;
stairSim.t = stairSim.dt;
stairSim.spawn(upperMarine);
stairSim.spawn(lowerForm);
stairSim._refreshOccupancy();
assert.equal(stairSim.hasLineOfSight(upperMarine, lowerForm), true,
  'the shared LOS wrapper must preserve the grand stair cross-deck sightline');
assert.ok(stairSim.lineOfSightAgents(lowerForm, (agent) => agent === upperMarine).includes(upperMarine),
  'cross-deck stair occupants must enter the cached combat candidate set');
upperMarine.dead = true;
lowerForm.dead = true;
for (const [from, to] of [[stair.upper, stair.lower], [stair.lower, stair.upper]]) {
  const walker = makeAgent(FACTION.COMBAT, from, stairSim.graph);
  stairSim.spawn(walker);
  stairSim.setPath(walker, [{ to, link: stair.edge, layer: 'std' }]);
  stairSim._refreshOccupancy();
  let ticks = 0;
  while ((walker.move || walker.path.length) && ticks++ < 1000) {
    stairSim._advanceMovement(stairSim.dt);
    stairSim._refreshOccupancy();
    assert.equal(stairSim.graph.node(walker.node).deck, walker.deck,
      'a stair mover room and coordinate frame must always name the same deck');
    const room = stairSim.graph.node(walker.pnode ?? walker.node);
    assert.equal(room.deck, walker.deck, 'physical stair occupancy must stay on the active deck');
  }
  assert.ok(ticks < 1000, 'grand stair traversal must finish');
  assert.equal(walker.node, to, 'grand stair traversal must land in its paired room');
  walker.dead = true;
}

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
