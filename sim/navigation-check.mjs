import assert from 'node:assert/strict';
import { FACTION } from '../shared/agentBuffer.js';
import { makeAgent } from './init.js';
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

const nurserySim = new Sim('idle-nursery-check');
for (const agent of nurserySim.agents) agent.dead = true;
const nursery = nurserySim.graph.nodes.find((node) => node.roles.includes('cargo'));
assert.ok(nursery, 'idle nursery fixture needs a cargo room');
const pods = Array.from({ length: 8 }, () => makeAgent(FACTION.INFECTION, nursery.idx, nurserySim.graph));
const carrier = makeAgent(FACTION.CARRIER, nursery.idx, nurserySim.graph);
for (const pod of pods) nurserySim.spawn(pod);
nurserySim.spawn(carrier);
nurserySim.hive.opening = false;
nurserySim.hive.allIn = false;
nurserySim.hive.searchingAll = false;
nurserySim.hive.beliefs.clear();
nurserySim._refreshOccupancy();
nurserySim._computeInfluence();
nurserySim.hive.steadyState(pods, [], [carrier], [], pods.length, 0, 1,
  nurserySim.hive.scarcity(pods.length + 2));
assert.ok(pods.every((pod) => pod.task?.kind === TASK.SCOUT && pod.task.sweep),
  'spare infection forms must leave an empty nursery on safe coverage tasks');
assert.ok(new Set(pods.map((pod) => pod.task.node)).size > 1,
  'nursery coverage must spread pods across the topology instead of moving the pile together');

const openingSim = new Sim('opening-newborn-check');
for (const agent of openingSim.agents) agent.dead = true;
const firstPod = makeAgent(FACTION.INFECTION, openingSim.graph.breachNode, openingSim.graph);
openingSim.spawn(firstPod);
openingSim.hive._openingSpread([firstPod], []);
const newborn = makeAgent(FACTION.INFECTION, nursery.idx, openingSim.graph);
openingSim.spawn(newborn);
openingSim.hive.beliefs.clear();
openingSim._refreshOccupancy();
openingSim._computeInfluence();
openingSim.hive.openingMove([firstPod, newborn], [], []);
assert.equal(newborn.task?.kind, TASK.SCOUT,
  'a pod born after the frozen opening plan must receive a coverage task');
const planned = openingSim.hive._spreadPlan.get(firstPod.id);
assert.notEqual(planned, undefined, 'opening fixture must assign the initial pod a spread destination');
const plannedRoom = openingSim.graph.node(planned);
firstPod.node = firstPod.pnode = planned;
firstPod.deck = plannedRoom.deck;
firstPod.x = plannedRoom.x;
firstPod.y = plannedRoom.y;
firstPod.task = null;
firstPod.path = [];
firstPod.move = null;
openingSim._refreshOccupancy();
openingSim._computeInfluence();
openingSim.hive.openingMove([firstPod, newborn], [], []);
assert.equal(firstPod.task?.kind, TASK.SCOUT,
  'a pod that reaches its frozen opening destination must continue coverage');
assert.notEqual(firstPod.task.node, planned,
  'completed opening spread orders must not be reissued to the room underfoot');

const routeSim = new Sim('disconnected-route-check');
for (const agent of routeSim.agents) agent.dead = true;
const routeForm = makeAgent(FACTION.INFECTION, routeSim.graph.breachNode, routeSim.graph);
const foreignEdge = routeSim.graph.edges.find((edge) =>
  edge.a !== routeForm.node && edge.b !== routeForm.node);
assert.ok(foreignEdge, 'route fixture needs a connector unrelated to the current room');
routeSim.spawn(routeForm);
routeSim.tickCount = 1;
routeSim.t = routeSim.dt;
routeForm.path = [{ to: foreignEdge.b, link: foreignEdge, layer: foreignEdge.kind }];
routeSim._advanceMovement(routeSim.dt);
assert.equal(routeForm.move, null, 'a disconnected connector must never begin a movement leg');
assert.equal(routeForm.path.length, 0, 'a disconnected route must be discarded for clean re-planning');

// Enclosed vertical links used to expose a climber on the destination hatch
// halfway through the timer, then leave it standing there for the other half.
// Pin the topology-derived behavior so every ladder in a future ship layout
// gets the same enter → hidden climb → immediate walk-clear sequence.
const ladderSim = new Sim('ladder-exit-check');
for (const agent of ladderSim.agents) agent.dead = true;
const ladder = ladderSim.graph.edges.find((edge) => edge.kind === 'std' && edge.type === 'ladder'
  && ladderSim.graph.node(edge.a).deck !== ladderSim.graph.node(edge.b).deck && !edge.locked);
assert.ok(ladder, 'ladder exit fixture needs an open cross-deck ladder');
const ladderForm = makeAgent(FACTION.COMBAT, ladder.a, ladderSim.graph);
ladderSim.spawn(ladderForm);
ladderSim.tickCount = 1;
ladderSim.t = ladderSim.dt;
ladderForm.task = { kind: TASK.DART, node: ladder.b };
ladderSim.setPath(ladderForm, [{ to: ladder.b, link: ladder, layer: 'std' }]);
ladderSim._refreshOccupancy();
ladderSim._advanceMovement(ladderSim.dt);
assert.ok(ladderForm.move, 'the flood form must begin its ladder leg');
assert.equal(ladder.occupiedBy, ladderForm.id, 'the climber must reserve the ladder while on its rungs');
let emerged = false;
for (let tick = 0; tick < 1_000 && ladderForm.move; tick++) {
  ladderSim._advanceMovement(ladderSim.dt);
  if (ladderForm.node !== ladder.b || ladderForm.move.hidden) continue;
  emerged = true;
  const x = ladderForm.x, y = ladderForm.y;
  ladderSim._advanceMovement(ladderSim.dt);
  assert.ok(Math.hypot(ladderForm.x - x, ladderForm.y - y) > 0.001,
    'a form must walk clear immediately after it appears at the far hatch');
  assert.equal(ladder.occupiedBy, undefined,
    'the ladder must be free as soon as the previous body clears the rungs');
  break;
}
assert.ok(emerged, 'the flood form must emerge from the destination ladder hatch');

// A combat wave that has already committed to a shared surge must not stop
// for the full climb behind its lead form. Ordinary bodies still use the
// one-at-a-time reservation; this only lets the same hive response scramble
// onto the rungs as a continuous attack.
const surgeLadderSim = new Sim('ladder-surge-check');
for (const agent of surgeLadderSim.agents) agent.dead = true;
surgeLadderSim.tickCount = 1;
surgeLadderSim.t = surgeLadderSim.dt;
const surgeLadder = surgeLadderSim.graph.edges.find((edge) => edge.kind === 'std'
  && edge.type === 'ladder' && surgeLadderSim.graph.node(edge.a).deck
    !== surgeLadderSim.graph.node(edge.b).deck && !edge.locked);
assert.ok(surgeLadder, 'ladder surge fixture needs an open cross-deck ladder');
surgeLadder.occupiedBy = undefined;
surgeLadder.reservedBy = undefined;
const lead = makeAgent(FACTION.COMBAT, surgeLadder.a, surgeLadderSim.graph);
const wing = makeAgent(FACTION.COMBAT, surgeLadder.a, surgeLadderSim.graph);
surgeLadderSim.spawn(lead);
surgeLadderSim.spawn(wing);
for (const form of [lead, wing]) {
  form.task = { kind: TASK.ATTACK, node: surgeLadder.b, surge: true };
}
surgeLadderSim.setPath(lead, [{ to: surgeLadder.b, link: surgeLadder, layer: 'std' }]);
surgeLadderSim._refreshOccupancy();
surgeLadderSim._advanceMovement(surgeLadderSim.dt);
for (let tick = 0; tick < 1_000 && !lead.move?.hidden; tick++) {
  surgeLadderSim._advanceMovement(surgeLadderSim.dt);
}
assert.equal(lead.move?.hidden, true, 'the lead surge form must be on the ladder');
surgeLadderSim.setPath(wing, [{ to: surgeLadder.b, link: surgeLadder, layer: 'std' }]);
surgeLadderSim._advanceMovement(surgeLadderSim.dt);
assert.ok(wing.move, 'a packmate in the same surge must join the occupied ladder without an idle wait');
assert.equal(wing.charging, true, 'the joined ladder leg must preserve the shared charge');
const reservedWing = makeAgent(FACTION.COMBAT, surgeLadder.a, surgeLadderSim.graph);
const playerClimber = makeAgent(FACTION.MARINE, surgeLadder.a, surgeLadderSim.graph);
playerClimber.isPlayer = true;
surgeLadderSim.spawn(reservedWing);
surgeLadderSim.spawn(playerClimber);
surgeLadder.reservedBy = playerClimber.id;
reservedWing.task = { kind: TASK.ATTACK, node: surgeLadder.b, surge: true };
surgeLadderSim.setPath(reservedWing,
  [{ to: surgeLadder.b, link: surgeLadder, layer: 'std' }]);
surgeLadderSim._refreshOccupancy();
surgeLadderSim._advanceMovement(surgeLadderSim.dt);
assert.equal(reservedWing.move, null, 'a hive surge must still yield a player-reserved ladder slot');

console.log('infection navigation ✓');
