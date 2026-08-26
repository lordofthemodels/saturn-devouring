import assert from 'node:assert/strict';
import { Sim } from './sim.js';

const spawnMode = (seed) => {
  const sim = new Sim(seed, null, { playerSpawnId: 'cic' });
  return {
    mode: sim.graph.lightMode[sim.graph.byId.get('cic')],
    unpowered: sim.graph.unpowered[sim.graph.byId.get('cic')],
  };
};

assert.deepEqual(spawnMode('spawn-light-35'), { mode: 2, unpowered: 1 },
  'an unpowered dead spawn must become a harsh flicker');
assert.deepEqual(spawnMode('spawn-powered-20'), { mode: 1, unpowered: 0 },
  'a powered dead spawn must become a soft flicker');

console.log('player spawn lighting check ok');
