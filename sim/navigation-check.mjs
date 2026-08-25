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

console.log('infection navigation ✓');
