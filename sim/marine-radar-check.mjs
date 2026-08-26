import assert from 'node:assert/strict';
import { FACTION } from '../shared/agentBuffer.js';
import { makeAgent } from './init.js';
import { strategicSquads } from './humans.js';
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
