import assert from 'node:assert/strict';
import { sporeDoorFlow } from './spore-fx.js';

const nodes = [
  { idx: 0, x: -5, y: 2 },
  { idx: 1, x: 7, y: 5 },
];
const edge = { i: 9, a: 0, b: 1, door: { x: 1, y: 3.5 } };
const graph = { node: (idx) => nodes[idx] };
const door = { edge, open01: 1 };

let fog = new Set([0]);
let flow = sporeDoorFlow(graph, { fogAt: (idx) => fog.has(idx) }, door);
assert.equal(flow.fogNode, 0);
assert.equal(flow.clearNode, 1);
assert.ok(flow.dx > 0 && flow.dz > 0, 'fog spills from the infected room toward clear-room geometry');
assert.ok(Math.abs(Math.hypot(flow.dx, flow.dz) - 1) < 1e-9, 'flow direction is normalized');

fog = new Set([1]);
flow = sporeDoorFlow(graph, { fogAt: (idx) => fog.has(idx) }, door);
assert.equal(flow.fogNode, 1);
assert.ok(flow.dx < 0 && flow.dz < 0, 'reversing the infected side reverses the spill');

fog = new Set();
assert.equal(sporeDoorFlow(graph, { fogAt: (idx) => fog.has(idx) }, door), null);
fog = new Set([0, 1]);
assert.equal(sporeDoorFlow(graph, { fogAt: (idx) => fog.has(idx) }, door), null);
fog = new Set([0]);
assert.equal(sporeDoorFlow(graph, { fogAt: (idx) => fog.has(idx) }, { ...door, open01: 0.02 }), null);

console.log('spore-fx: geometry-directed spill and boundary gates ok');
