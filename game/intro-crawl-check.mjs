import assert from 'node:assert/strict';
import {
  INTRO_MAX_STEP,
  advanceIntroProgress,
  introBody,
} from './intro-crawl.js';

assert.equal(advanceIntroProgress(10, 1 / 91), 11,
  'normal frame time preserves the intended typing rate');
assert.equal(advanceIntroProgress(10, 5), 10 + INTRO_MAX_STEP,
  'a multi-second stall cannot skip unseen text');
assert.match(introBody('Test Bay'), /Contact in Test Bay/,
  'the early launcher copy expands into the seeded briefing');

console.log('intro crawl checks passed');
