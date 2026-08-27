import assert from 'node:assert/strict';
import * as THREE from '../engine/vendor/three.webgpu.module.js';
import { combatChargeArmPose, combatChargeArmsHigh } from './charge-pose.js';
import { Sim } from './sim.js';
import { FACTION, FLAG } from '../shared/agentBuffer.js';
import { makeAgent } from './init.js';
import { CHARACTERS } from '../game/characters-data.js';

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

// Validate the actual combat-model fingertip directions, not just the pose
// flag: throughout the shoulder thrash each arm must remain raised, stay on
// its own side, and point forward. Depth cannot count toward the Y spread —
// that was how a backwards-pointing hand passed the previous check.
for (const modelName of ['combat_civ', 'combat_odst']) {
  const model = CHARACTERS[modelName];
  for (const part of ['armL', 'armR']) {
    const pivot = model.pivots[part];
    let tip = null, reachSq = 0;
    for (const group of model.groups.filter((candidate) => candidate.part === part)) {
      for (let index = 0; index < group.pos.length; index += 3) {
        const candidate = [group.pos[index] - pivot[0], group.pos[index + 1] - pivot[1],
          group.pos[index + 2] - pivot[2]];
        const distanceSq = candidate.reduce((sum, value) => sum + value * value, 0);
        if (distanceSq > reachSq) { reachSq = distanceSq; tip = candidate; }
      }
    }
    const side = part === 'armR' ? 1 : -1;
    const averageRaises = [];
    for (let poseId = 1; poseId <= 24; poseId++) {
      const spreads = [], raises = [];
      for (let sampleIndex = 0; sampleIndex < 120; sampleIndex++) {
        const phase = sampleIndex / 12;
        const pose = combatChargeArmPose(side, phase, poseId, {});
        const direction = new THREE.Vector3(...tip)
          .applyEuler(new THREE.Euler(pose.x, pose.y, pose.z));
        const spread = Math.atan2(Math.abs(direction.z), direction.y);
        assert.ok(direction.y > 0 && spread > 0.66 && spread < 1.20,
          `${modelName} ${part} must hold a raised Y silhouette (${spread.toFixed(3)} rad)`);
        assert.ok(direction.x > 0,
          `${modelName} ${part} must point forward while raised (${direction.x.toFixed(3)} m)`);
        assert.ok(direction.z * side > 0,
          `${modelName} ${part} must stay on its anatomical side`);
        spreads.push(spread);
        raises.push(Math.abs(pose.x));
      }
      assert.ok(Math.max(...spreads) - Math.min(...spreads) > 0.22,
        `${modelName} ${part} must wave visibly while raised`);
      assert.ok(Math.max(...raises) - Math.min(...raises) > 0.20,
        `${modelName} ${part} must jerk through multiple raise angles`);
      averageRaises.push(raises.reduce((sum, value) => sum + value, 0) / raises.length);
    }
    assert.ok(Math.max(...averageRaises) - Math.min(...averageRaises) > 0.15,
      `${modelName} ${part} must vary its resting raise angle between forms`);
  }
}

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
