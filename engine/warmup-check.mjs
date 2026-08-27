import assert from 'node:assert/strict';
import { QualityGovernor } from './runtime.js';
import { TickScheduler } from './tick.js';

const renderer = () => ({
  domElement: { clientWidth: 1280, clientHeight: 720 },
  getPixelRatio: () => 1,
  setPixelRatio() {},
  setSize() {},
  _nodes: { nodeBuilderCache: new Map() },
  _pipelines: { caches: new Map() },
});
const rungs = Array.from({ length: 4 }, (_, index) => ({ index, res: [0.5, 1] }));

let restores = 0;
let cancelSignal;
const cancelled = new QualityGovernor({
  renderer: renderer(),
  rungs,
  apply() {},
});
const unfinished = cancelled.prewarm({}, {}, {
  order: [2, 2, 99, -1, 3],
  forceWarm: () => () => { restores += 1; },
  compileRung: (_rung, _index, signal) => {
    cancelSignal = signal;
    return new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
  },
});
await Promise.resolve();
assert.equal(cancelled.prewarming, true);
cancelled.cancelPrewarm();
await unfinished;
assert.equal(cancelSignal.aborted, true);
assert.equal(restores, 1, 'force-warmed scene state restores exactly once');
assert.equal(cancelled.prewarming, false);
assert.equal(cancelled._prewarmRun, null);

const compiled = [];
const completed = new QualityGovernor({
  renderer: renderer(),
  rungs,
  apply() {},
});
await completed.prewarm({}, {}, {
  order: [2, 2, 99, -1, 1],
  compileRung: (_rung, index, signal) => {
    assert.equal(signal.aborted, false);
    compiled.push(index);
  },
});
assert.deepEqual(compiled, [2, 1], 'warm-up filters invalid rungs and compiles duplicates once');

const NativeMessageChannel = globalThis.MessageChannel;
let receiver;
let posts = 0;
globalThis.MessageChannel = class {
  constructor() {
    this.port1 = {};
    this.port2 = { postMessage: () => { posts += 1; } };
    receiver = this.port1;
  }
};
try {
  let steps = 0;
  const scheduler = new TickScheduler({ stepSec: 1, run: () => { steps += 1; } });
  scheduler.add(1);
  scheduler.add(1);
  assert.equal(posts, 1, 'multiple frame submissions share one pending task');
  receiver.onmessage();
  assert.equal(steps, 1);
  assert.equal(posts, 2, 'a remaining step schedules one follow-up task');
  receiver.onmessage();
  assert.equal(steps, 2);
  assert.equal(scheduler._scheduled, false);
} finally {
  globalThis.MessageChannel = NativeMessageChannel;
}

console.log('gameplay warm-up scheduling ✓');
