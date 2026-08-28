import assert from 'node:assert/strict';
import { FACTION } from '../shared/agentBuffer.js';
import { makeAgent, STATE } from './init.js';
import { TASK } from './hive.js';
import { humanPass } from './graph.js';
import { strategicSquads, updateHumansTick } from './humans.js';
import { Sim } from './sim.js';

function emptySim(seed) {
  const sim = new Sim(seed);
  for (const agent of sim.agents) agent.dead = true;
  return sim;
}

function addSquad(sim, node, size = 2) {
  const squad = {
    id: sim.squads.length, members: [], objective: { kind: 'sweep', node },
    morale: 1, respondingTo: null, phase1: false, size0: size,
  };
  sim.squads.push(squad);
  for (let i = 0; i < size; i++) {
    const marine = makeAgent(FACTION.MARINE, node, sim.graph);
    marine.squad = squad.id;
    marine.frags = sim.P.grenade.perMarine;
    squad.members.push(marine.id);
    sim.spawn(marine);
  }
  return squad;
}

function openSameDeckEdge(sim) {
  return sim.graph.edges.find((edge) => !edge.locked
    && sim.graph.node(edge.a).deck === sim.graph.node(edge.b).deck);
}

// Every actual Deck 1 room starts with its own armed sentry. Only the nearest
// two available posts answer a command-deck distress call, using Deck 1 paths,
// and a cleared call sends each Marine home. Calls below Deck 1 are ignored.
{
  const sim = new Sim('deck-one-room-guards');
  const rooms = sim.graph.nodes.filter((node) => node.deck === 1 && node.type === 'room');
  const sentries = sim.agents.filter((agent) => agent.deckGuard && agent.garrison);
  assert.equal(sentries.length, rooms.length * sim.P.marines.deckGuardPerRoom,
    'Deck 1 sentry count must follow the live room graph');
  for (const room of rooms) {
    assert.equal(sentries.filter((agent) => agent.node === room.idx).length,
      sim.P.marines.deckGuardPerRoom,
      `${room.name} must begin with its own armed Marine`);
  }
  assert.equal(sim.agents.filter((agent) => agent.garrison && !agent.deckGuard).length,
    sim.P.marines.garrison, 'room sentries must not replace the corridor garrison');

  sim.t = 20;
  sim.tickCount = Math.round(sim.t * sim.P.sim.tickHz);
  const target = sim.graph.byId.get('signal');
  const call = { id: 9001, node: target, t: sim.t, faction: FACTION.CIVILIAN, rolled: new Set() };
  sim.calls.push(call);
  sim._refreshOccupancy();
  strategicSquads(sim);
  const responders = sim.squads.filter((squad) => squad.deckGuard
    && squad.objective?.kind === 'distress' && squad.objective.callId === call.id);
  assert.equal(responders.length, 2,
    'only the nearest two Deck 1 sentries should leave their posts for one call');
  assert.ok(responders.every((squad) => sim.graph.node(squad.objective.node).deck === 1),
    'a sentry response objective must remain on Deck 1');

  updateHumansTick(sim, sim.dt);
  const moving = responders.map((squad) => sim.byId.get(squad.members[0]))
    .find((marine) => marine.node !== target);
  assert.ok(moving?.path.length > 0, 'one responding sentry must travel to the called room');
  assert.ok(moving.path.every((step) => sim.graph.node(step.to).deck === 1),
    'a Deck 1 sentry route must never leave Deck 1');

  const returningSquad = responders[0];
  const returning = sim.byId.get(returningSquad.members[0]);
  const room = sim.graph.node(target);
  returning.node = returning.pnode = target;
  returning.deck = 1;
  returning.x = room.x;
  returning.y = room.y;
  returning.move = null;
  returning.path = [];
  returning.state = STATE.IDLE;
  sim._refreshOccupancy();
  strategicSquads(sim);
  assert.equal(returningSquad.objective.kind, 'guard',
    'a sentry must return to guard duty after clearing the call');
  assert.equal(returningSquad.objective.node, returningSquad.postNode,
    'guard duty must route the sentry back to its assigned room');

  const lower = sim.graph.nodes.find((node) => node.deck === 2 && node.type === 'room').idx;
  const lowerCall = { id: 9002, node: lower, t: sim.t, faction: FACTION.CIVILIAN, rolled: new Set() };
  sim.calls = [lowerCall];
  for (const squad of sim.squads.filter((candidate) => candidate.deckGuard)) {
    squad.objective = { kind: 'guard', node: squad.postNode };
    squad.respondingTo = null;
  }
  strategicSquads(sim);
  assert.ok(sim.squads.filter((squad) => squad.deckGuard)
    .every((squad) => squad.objective.kind === 'guard'),
    'Deck 1 sentries must ignore distress calls from every other deck');
}

// A room sentry's own sighting uses the reliable Deck 1 net, independent of
// the damaged cross-deck radio roll used by ordinary squads.
{
  const sim = new Sim('deck-one-room-sighting', { radio: { marineCallReliability: 0 } });
  const sentry = sim.agents.find((agent) => agent.deckGuard);
  for (const agent of sim.agents) agent.dead = agent.id !== sentry.id;
  const form = makeAgent(FACTION.COMBAT, sentry.node, sim.graph);
  sim.spawn(form);
  sim._refreshOccupancy();
  updateHumansTick(sim, sim.dt);
  assert.equal(sim.calls.length, 1,
    'a Deck 1 room sentry must always report a visible Flood contact');
  assert.equal(sim.calls[0].deckSighting, true,
    'the room sentry report must use the floor-wide sighting channel');
  assert.equal(sim.calls[0].node, sentry.node,
    'the sighting must direct responders to the contact room');
}

// Fixed garrison units share one contact report, and every Deck 1 sighting
// reliably redirects the mobile sentries even when ordinary radio rolls fail.
{
  const sim = new Sim('deck-one-contact-net', { radio: { marineCallReliability: 0 } });
  for (const agent of sim.agents) {
    if (agent.faction !== FACTION.MARINE) agent.dead = true;
  }
  const garrison = sim.agents.filter((agent) => agent.garrison && !agent.deckGuard);
  assert.ok(garrison.length > 1, 'contact-net fixture needs the fixed garrison');
  const node = garrison[0].node;
  const form = makeAgent(FACTION.COMBAT, node, sim.graph);
  sim.spawn(form);
  sim._refreshOccupancy();
  updateHumansTick(sim, sim.dt);

  const alerts = sim.calls.filter((call) => call.deckSighting && call.node === node);
  assert.equal(alerts.length, 1,
    'simultaneous garrison sightings in one room must become one net incident');
  assert.equal(sim.events.filter((event) => event.type === 'radio'
    && event.msg.startsWith('distress call')).length, 1,
    'a shared sighting must print one contact report');

  strategicSquads(sim);
  const responders = sim.squads.filter((squad) => squad.deckGuard
    && squad.objective?.kind === 'distress' && squad.objective.callId === alerts[0].id);
  assert.equal(responders.length, 2,
    'a Deck 1 sighting must redirect the nearest two available sentries');
  assert.equal(sim.events.filter((event) => event.msg.startsWith('Deck 1 net redirects')).length, 1,
    'the sentry response must print once for the incident, not once per unit');

  form.dead = true;
  sim.t += sim.dt;
  sim.tickCount++;
  sim._refreshOccupancy();
  updateHumansTick(sim, sim.dt);
  sim.t += sim.P.radio.deckSightingDedupeSec + sim.dt;
  sim.tickCount += Math.ceil(sim.P.radio.deckSightingDedupeSec * sim.P.sim.tickHz) + 1;
  const second = makeAgent(FACTION.COMBAT, node, sim.graph);
  sim.spawn(second);
  sim._refreshOccupancy();
  updateHumansTick(sim, sim.dt);
  assert.equal(sim.calls.filter((call) => call.deckSighting && call.node === node).length, 2,
    'a cleared contact must re-arm so the next sighting is always reported');
}

// A visibly retreating form leaves a shared last-seen trail. The first clear
// tick turns that memory into movement without waiting for a strategic roll.
{
  const sim = emptySim('marine-retreat-pursuit');
  sim.squads = [];
  const node = sim.graph.breachNode;
  const squad = addSquad(sim, node, 2);
  const form = makeAgent(FACTION.COMBAT, node, sim.graph);
  form.task = { kind: TASK.MOVE, node, retreat: true };
  sim.spawn(form);
  sim._refreshOccupancy();
  updateHumansTick(sim, sim.dt);
  assert.equal(squad.pursuitTargetId, form.id,
    'the squad must remember the retreating contact it can see');
  assert.equal(squad.pursuitNode, node,
    'pursuit memory must contain only the contact last-seen room');

  form.dead = true;
  sim.tickCount++;
  sim.t += sim.dt;
  sim._refreshOccupancy();
  updateHumansTick(sim, sim.dt);
  assert.equal(squad.objective.kind, 'pursuit',
    'the squad must pursue on the first tick after losing sight');
  strategicSquads(sim);
  assert.notEqual(squad.objective.kind, 'pursuit',
    'a clear last-seen room must release the squad to its next assignment');
}

// A fast crash clear holds only for the remainder of the minimum on-site
// interval, then rolls directly into another room.
{
  const sim = emptySim('marine-continuous-sweep');
  sim.squads = [];
  const squad = addSquad(sim, sim.graph.breachNode, 2);
  squad.phase1 = true;
  squad.objective = { kind: 'breach', node: sim.graph.breachNode };
  sim.t = 20;
  sim.tickCount = Math.round(sim.t * sim.P.sim.tickHz);
  sim._refreshOccupancy();
  strategicSquads(sim);
  assert.equal(sim.firstSweepCleared, false,
    'a fast clear must still secure the crash for the minimum interval');
  assert.equal(squad.objective.kind, 'breach',
    'the crash squad must remain on site until its security interval ends');

  sim.t += sim.P.marineDoctrine.crashSecureSec + sim.P.sim.strategicTickSec;
  sim.tickCount = Math.round(sim.t * sim.P.sim.tickHz);
  strategicSquads(sim);
  assert.equal(sim.firstSweepCleared, true,
    'a secured crash region must open the general sweep');
  assert.equal(squad.objective.kind, 'sweep',
    'the crash squad must fan out without a post-breach hold');
  assert.notEqual(squad.objective.node, sim.graph.breachNode,
    'the next sweep target must leave the cleared crash room');

  const current = sim.byId.get(squad.members[0]).node;
  squad.objective = { kind: 'sweep', node: current };
  sim.sweptAt.fill(sim.t);
  strategicSquads(sim);
  assert.equal(squad.objective.kind, 'sweep',
    'a recently checked ship must still produce a continuous sweep route');
  assert.notEqual(squad.objective.node, current,
    'continuous sweep must not hold in its current room');
}

// Patrol planning and movement must use the same spore-fog policy. A patrol
// skips a fogged leg instead of accepting an objective that execution will
// reject every tick.
{
  const sim = emptySim('marine-patrol-fog-route');
  sim.squads = [];
  const origin = sim.graph.nodes.find((node) =>
    [...sim.graph.neighbors(node.idx, ['std'], humanPass)].length >= 2);
  assert.ok(origin, 'patrol fog fixture needs a room with two open exits');
  const neighbors = [...sim.graph.neighbors(origin.idx, ['std'], humanPass)];
  const fogged = neighbors[0].to;
  const clear = neighbors[1].to;
  const squad = addSquad(sim, origin.idx, 2);
  squad.patrol = true;
  squad.route = [origin.idx, fogged, clear];
  squad.leg = 0;
  squad.objective = { kind: 'patrol', node: origin.idx };
  sim.floodHoldSec[fogged] = sim.P.darkness.fogSec;
  sim._refreshOccupancy();
  strategicSquads(sim);
  assert.equal(squad.objective.kind, 'patrol');
  assert.equal(squad.objective.node, clear,
    'a patrol must advance to a reachable leg rather than stall on fog');
}

// Once fog grows around a squad, the refusal to enter it cannot also prevent
// that squad from crossing the connected bank to reach a clear room.
{
  const sim = emptySim('marine-escape-fog-bank');
  sim.squads = [];
  let fixture = null;
  for (const from of sim.graph.nodes) {
    for (const to of sim.graph.nodes) {
      const path = sim.graph.path(from.idx, to.idx, ['std'], humanPass);
      if (path && path.length >= 2) {
        fixture = { from: from.idx, to: to.idx };
        break;
      }
    }
    if (fixture) break;
  }
  assert.ok(fixture, 'fog escape fixture needs a multi-room open route');
  const squad = addSquad(sim, fixture.from, 1);
  const marine = sim.byId.get(squad.members[0]);
  sim.floodHoldSec.fill(sim.P.darkness.fogSec);
  sim.floodHoldSec[fixture.to] = 0;
  assert.ok(sim.pathFor(marine, fixture.to, ['std'], humanPass),
    'a marine already inside fog must retain a route to clear ground');

  sim.floodHoldSec.fill(0);
  sim.floodHoldSec[fixture.to] = sim.P.darkness.fogSec;
  assert.equal(sim.pathFor(marine, fixture.to, ['std'], humanPass), null,
    'a line marine on clear ground must still refuse a fogged destination');
}

// A laggard with no route cannot erase the shared objective after the point
// marine has already found a valid path.
{
  const sim = emptySim('marine-laggard-objective');
  sim.squads = [];
  const edge = openSameDeckEdge(sim);
  const squad = addSquad(sim, edge.a, 2);
  squad.objective = { kind: 'sweep', node: edge.b };
  const laggard = sim.byId.get(squad.members[1]);
  const setPathTo = sim.setPathTo.bind(sim);
  sim.setPathTo = (marine, ...args) => marine.id === laggard.id
    ? false : setPathTo(marine, ...args);
  sim._refreshOccupancy();
  updateHumansTick(sim, sim.dt);
  assert.equal(squad.objective?.node, edge.b,
    'one separated member must not cancel the squad route');
}

// The point marine reaching a clear objective releases the squad even when a
// separated survivor is still more than one room behind.
{
  const sim = emptySim('marine-laggard-arrival');
  sim.squads = [];
  let fixture = null;
  for (const from of sim.graph.nodes) {
    for (const to of sim.graph.nodes) {
      const path = sim.graph.path(from.idx, to.idx, ['std'], humanPass);
      if (path && path.length >= 2) {
        fixture = { from: from.idx, to: to.idx };
        break;
      }
    }
    if (fixture) break;
  }
  assert.ok(fixture, 'laggard arrival fixture needs rooms more than one hop apart');
  const squad = addSquad(sim, fixture.from, 2);
  const leader = sim.byId.get(squad.members[0]);
  const room = sim.graph.node(fixture.to);
  leader.node = leader.pnode = fixture.to;
  leader.deck = room.deck;
  leader.x = room.x;
  leader.y = room.y;
  leader.move = null;
  leader.path = [];
  squad.objective = { kind: 'pursuit', node: fixture.to };
  sim.firstSweepCleared = true;
  sim._refreshOccupancy();
  strategicSquads(sim);
  assert.notEqual(squad.objective?.kind, 'pursuit',
    'a distant laggard must not pin a clear point-marine objective');
}

// Patrols clear the pursuit memory itself on arrival; otherwise the per-tick
// chase path immediately recreates the completed objective.
{
  const sim = emptySim('marine-patrol-pursuit-complete');
  sim.squads = [];
  const edge = openSameDeckEdge(sim);
  const squad = addSquad(sim, edge.a, 2);
  squad.patrol = true;
  squad.patrolNo = 1;
  squad.route = [edge.a, edge.b];
  squad.leg = 0;
  squad.pursuitNode = edge.a;
  squad.pursuitTargetId = 999;
  squad.pursuitTick = sim.tickCount;
  squad.contactNode = edge.a;
  squad.contactTick = sim.tickCount - 1;
  squad.objective = { kind: 'pursuit', node: edge.a, targetId: 999 };
  sim._refreshOccupancy();
  strategicSquads(sim);
  assert.notEqual(squad.objective?.kind, 'pursuit');
  assert.equal(squad.pursuitNode, undefined,
    'a completed patrol pursuit must clear its per-tick chase memory');
  updateHumansTick(sim, sim.dt);
  assert.notEqual(squad.objective?.kind, 'pursuit',
    'the completed pursuit must not be recreated on the next human tick');
}

// Reaching a distress room with no visible contact releases a patrol even if
// hidden ground-truth mass remains in the abstract room model.
{
  const sim = emptySim('marine-distress-visible-clear');
  sim.squads = [];
  const edge = openSameDeckEdge(sim);
  const squad = addSquad(sim, edge.a, 2);
  squad.patrol = true;
  squad.patrolNo = 1;
  squad.route = [edge.a, edge.b];
  squad.leg = 0;
  squad.respondingTo = 77;
  squad.objective = { kind: 'distress', node: edge.a, callId: 77 };
  const hidden = makeAgent(FACTION.COMBAT, edge.a, sim.graph);
  sim.spawn(hidden);
  sim.losFloodThreat = () => 0;
  sim._refreshOccupancy();
  strategicSquads(sim);
  assert.notEqual(squad.objective?.kind, 'distress',
    'unseen ground truth must not pin a patrol to a completed response');
  assert.equal(squad.respondingTo, null);
}

// A hot crash cannot pin the ship's whole response indefinitely. At the
// doctrine limit the line squads fan out even if the breach is still active.
{
  const sim = emptySim('marine-hot-crash-timeout');
  sim.squads = [];
  const start = sim.graph.nodes.find((node) => node.idx !== sim.graph.breachNode
    && node.type !== 'corridor').idx;
  const squad = addSquad(sim, start, 2);
  squad.phase1 = true;
  squad.objective = { kind: 'breach', node: sim.graph.breachNode };
  sim.floodKnown = true;
  sim.t = sim.P.marineDoctrine.crashCommitSec + 1;
  sim.tickCount = Math.round(sim.t * sim.P.sim.tickHz);
  sim._refreshOccupancy();
  strategicSquads(sim);
  assert.equal(sim.firstSweepCleared, true,
    'a hot crash must release general sweeps at the doctrine limit');
  assert.equal(squad.objective.kind, 'sweep',
    'a released crash squad must take a ship-sweep route');
}

// A moving form in the next room interrupts autonomous work; a motionless
// ambush does not paint. The squad response is one shared objective.
{
  const sim = emptySim('marine-radar-adjacent');
  const edge = openSameDeckEdge(sim);
  assert.ok(edge, 'radar fixture needs an open adjacent room');
  const squad = addSquad(sim, edge.a);
  const original = { kind: 'sweep', node: edge.a };
  squad.objective = original;
  const form = makeAgent(FACTION.COMBAT, edge.b, sim.graph);
  sim.spawn(form);
  sim.tickCount = 20;
  sim.t = sim.tickCount * sim.dt;
  sim._refreshOccupancy();
  sim._refreshMarineMotion();
  strategicSquads(sim);
  assert.equal(squad.objective, original,
    'a stationary form must remain dark to marine radar');

  form.steeredTick = sim.tickCount;
  sim._refreshMarineMotion();
  strategicSquads(sim);
  assert.equal(squad.objective.kind, 'motion',
    'adjacent enemy movement must interrupt an autonomous sweep');
  assert.equal(squad.objective.node, edge.b,
    'the whole squad must investigate the painted room');
  assert.equal(squad.radarResume, original,
    'the interrupted autonomous task must be retained for resumption');

  const point = sim.byId.get(squad.members[0]);
  sim.setPath(point, [{ to: edge.b, link: edge, layer: 'std' }]);
  sim._advanceMovement(sim.dt);
  assert.ok(point.move, 'the radar check must approach the painted doorway');
  for (let i = 0; i < 300; i++) sim._advanceMovement(sim.dt);
  assert.equal(point.node, edge.a,
    'the point marine must not cross a doorway while its radar paint is live');
  assert.ok(Math.hypot(point.x - edge.door.x, point.y - edge.door.y) <= 0.5,
    'the point marine must check from the real threshold, not the room centre');

  sim.tickCount += Math.ceil(sim.P.marineDoctrine.radarMemorySec * sim.P.sim.tickHz) + 1;
  sim._refreshMarineMotion();
  const heldAt = point.move.t;
  sim._advanceMovement(sim.dt);
  assert.ok(point.move.t > heldAt,
    'the doorway leg must resume after an unconfirmed paint fades');
}

function ladderFixture(seed) {
  const sim = emptySim(seed);
  const edge = sim.graph.edges.find((candidate) => !candidate.locked
    && candidate.type === 'ladder'
    && sim.graph.node(candidate.a).deck !== sim.graph.node(candidate.b).deck);
  assert.ok(edge, 'ladder fixture needs a cross-deck ladder');
  const upper = sim.graph.node(edge.a).deck < sim.graph.node(edge.b).deck ? edge.a : edge.b;
  const lower = upper === edge.a ? edge.b : edge.a;
  sim.tickCount = 30;
  sim.t = sim.tickCount * sim.dt;
  return { sim, edge, upper, lower };
}

// A dense moving paint below makes the point marine stop at the real mouth,
// drop one frag, and keep the squad off the rungs through the blast.
{
  const { sim, edge, upper, lower } = ladderFixture('marine-radar-down');
  const squad = addSquad(sim, upper, 1);
  const marine = sim.byId.get(squad.members[0]);
  const forms = Array.from({ length: sim.P.grenade.minTargets }, () => {
    const form = makeAgent(FACTION.COMBAT, lower, sim.graph);
    form.steeredTick = sim.tickCount;
    sim.spawn(form);
    return form;
  });
  sim._refreshOccupancy();
  sim._refreshMarineMotion();
  sim.setPath(marine, [{ to: lower, link: edge, layer: 'std' }]);
  sim._advanceMovement(sim.dt);
  assert.ok(marine.move, 'marine must begin walking to the ladder mouth');
  marine.move.t = Math.max(0, marine.move.appT - sim.dt / marine.move.travelSec * 0.5);
  sim._advanceMovement(sim.dt);
  assert.equal(sim.grenades.length, 1, 'the point marine must throw exactly one ladder frag');
  assert.equal(sim.grenades[0].deck, sim.graph.node(lower).deck,
    'the frag must land on the lower deck');
  assert.equal(marine.move.t, marine.move.appT,
    'the marine must wait at the mouth instead of entering the ladder');
  assert.equal(marine.move.hidden, false, 'the waiting marine must remain visible at the mouth');
  assert.ok(squad.ladderFragUntil > sim.t, 'the squad must wait through fuse and blast settling');

  for (const form of forms) form.dead = true;
  sim.t = squad.ladderFragUntil + sim.dt;
  sim.tickCount += Math.ceil((sim.P.grenade.fuseSec + sim.P.marineDoctrine.ladderBlastSettleSec
    + sim.P.marineDoctrine.radarMemorySec) * sim.P.sim.tickHz);
  sim._refreshOccupancy();
  sim._refreshMarineMotion();
  sim._advanceMovement(sim.dt);
  assert.ok(marine.move.t > marine.move.appT,
    'the squad may mount after the landing is quiet and the blast has settled');
}

// Radar above the squad is useful even when a grenade cannot be thrown
// against gravity: the marine simply refuses the unsafe climb.
{
  const { sim, edge, upper, lower } = ladderFixture('marine-radar-up');
  const squad = addSquad(sim, lower, 1);
  const marine = sim.byId.get(squad.members[0]);
  for (let i = 0; i < sim.P.grenade.minTargets; i++) {
    const form = makeAgent(FACTION.COMBAT, upper, sim.graph);
    form.steeredTick = sim.tickCount;
    sim.spawn(form);
  }
  sim._refreshOccupancy();
  sim._refreshMarineMotion();
  sim.setPath(marine, [{ to: upper, link: edge, layer: 'std' }]);
  sim._advanceMovement(sim.dt);
  marine.move.t = Math.max(0, marine.move.appT - sim.dt / marine.move.travelSec * 0.5);
  sim._advanceMovement(sim.dt);
  assert.equal(sim.grenades.length, 0, 'a marine must not throw a frag upward through a ladder');
  assert.equal(marine.move.t, marine.move.appT,
    'movement above must hold an ascending marine at the ladder mouth');
}

console.log('marine radar checks passed');
