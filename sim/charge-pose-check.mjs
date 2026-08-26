import assert from 'node:assert/strict';
import { combatChargeArmsHigh } from './charge-pose.js';
import { Sim } from './sim.js';
import { FACTION, FLAG } from '../shared/agentBuffer.js';
import { makeAgent } from './init.js';

let raised = 0;
const sample = 9000;
for (let id = 1; id <= 300; id++) {
  for (let sequence = 1; sequence <= 30; sequence++) {
    const first = combatChargeArmsHigh(id, sequence);
    assert.equal(combatChargeArmsHigh(id, sequence), first, 'pose roll must be deterministic');
    if (first) raised++;
  }
}
assert.ok(Math.abs(raised / sample - 1 / 3) < 0.015,
  `arms-high rate must stay near one third (got ${raised}/${sample})`);

const sim = new Sim('charge-pose-check');
for (const agent of sim.agents) agent.dead = true;
const form = makeAgent(FACTION.COMBAT, 0, sim.graph);
sim.spawn(form);
sim._setCharging(form, true);
const firstPose = form.chargeArmsHigh;
const firstSequence = form.chargePoseSequence;
sim._setCharging(form, true);
assert.equal(form.chargePoseSequence, firstSequence, 'an active charge must not reroll its pose');
sim._setCharging(form, false);
sim.t += 0.2;
sim._setCharging(form, true);
assert.equal(form.chargePoseSequence, firstSequence, 'a doorway seam must preserve the same rush pose');
assert.equal(form.chargeArmsHigh, firstPose, 'a doorway seam must not change arm posture');
sim.writeBuffer();
const index = [...sim.buffer.id.subarray(0, sim.buffer.count)].indexOf(form.id);
assert.ok(index >= 0, 'combat form must be published to the render buffer');
assert.equal(Boolean(sim.buffer.flags[index] & FLAG.ARMS_HIGH), firstPose,
  'the authoritative render flag must match the latched pose');
sim._setCharging(form, false);
sim.t += 1;
sim._setCharging(form, true);
assert.equal(form.chargePoseSequence, firstSequence + 1, 'a later charge must receive a fresh pose roll');

console.log(`charge pose check passed (${raised}/${sample} arms-high)`);
