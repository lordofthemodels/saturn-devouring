const PREFIX_LINES = [
  'UNSC SATURN DEVOURING — INTERNAL STATUS LOG // AUTO-GENERATED',
  'SHIP: FFG-201 UNSC SATURN DEVOURING — MARS HIGH ANCHOR',
  'DATE: OCTOBER 2552 // LOCAL 0347',
  '',
  'STATUS:',
  'Primary power offline. Secondary systems unstable.',
  'Ship heavily damaged. Radiation and electromagnetic interference',
  'disrupting radar and communications.',
];

const SUFFIX_LINES = [
  'unknown type, originating from the Covenant holy city HIGH CHARITY.',
  'Fireteams mustering.',
  '',
  'MISSION LOG:',
  'Sol has been a war of attrition since the day the Covenant first',
  'appeared off Earth. Every week they probe the anchorages, every',
  'week we push them back, at a high and bleeding cost. There are',
  'little less of us left to do the bleeding. This Charon class',
  'frigate has held the Mars sector through all of it.',
  '',
  'One transmission reached this station in the past week:',
  'an outbreak on Earth. Not Covenant. Something else,',
  'loose near Voi — something that eats the dead and wears them.',
  '',
  'At 0331 local, HIGH CHARITY — the Covenant holy city itself —',
  'exited slipspace directly on top of the Mars anchorage.',
  'At 0339 it tore open a slipspace rupture larger and more violent',
  'than anything on record, and was gone into it. The collapse wave',
  'killed the reactor. Every ship and station around Mars is likely',
  'as dark as we are. You have no way of knowing.',
  '',
  'Internal sensors are down. The crew is at stations.',
  'You are not alone in the dark.',
];

export const INTRO_PREFIX = PREFIX_LINES.join('\n');
export const INTRO_MISSION = 'MISSION: SURVIVE. CONTAIN.';
export const INTRO_CPS = 91;
export const INTRO_MAX_STEP = 2;

export function introBody(breachName) {
  return [
    ...PREFIX_LINES,
    `Contact in ${breachName} — an object of`,
    ...SUFFIX_LINES,
  ].join('\n');
}

export function advanceIntroProgress(progress, elapsedSeconds) {
  return progress + Math.min(INTRO_MAX_STEP,
    Math.max(0, Number(elapsedSeconds) || 0) * INTRO_CPS);
}

let active = null;

// Start before the large game module is imported, so its download, parse and
// renderer boot happen behind text the player can already read. Progress is
// capped per delivered frame: a blocked main thread pauses instead of later
// revealing characters that were never painted.
export function beginIntroCrawl() {
  if (active) return active;
  const text = document.getElementById('introText');
  const mission = document.getElementById('introMission');
  const hint = document.getElementById('introHint');
  let body = INTRO_PREFIX;
  let finalBody = false;
  let progress = 1;
  let shown = -1;
  let last = 0;
  let done = false;
  let cancelled = false;

  const render = () => {
    const chars = Math.floor(progress);
    if (chars === shown) return;
    shown = chars;
    text.textContent = body.slice(0, Math.min(chars, body.length));
    mission.textContent = finalBody && chars > body.length
      ? INTRO_MISSION.slice(0, chars - body.length) : '';
    if (finalBody && chars >= body.length + INTRO_MISSION.length && !done) {
      done = true;
      hint.textContent = document.body.dataset.input === 'gamepad' ? 'A — DEPLOY' : 'CLICK TO DEPLOY';
      hint.classList.add('ready');
    }
  };

  const frame = (now) => {
    if (cancelled || done) return;
    const elapsed = last ? (now - last) / 1000 : 0;
    last = now;
    const limit = body.length + (finalBody ? INTRO_MISSION.length : 0);
    progress = Math.min(limit, advanceIntroProgress(progress, elapsed));
    render();
    requestAnimationFrame(frame);
  };

  active = {
    get done() { return done; },
    setBody(nextBody) {
      body = String(nextBody);
      finalBody = true;
      render();
    },
    complete() {
      if (!finalBody) return;
      progress = body.length + INTRO_MISSION.length;
      render();
    },
    cancel() { cancelled = true; },
  };

  render();
  requestAnimationFrame(frame);
  return active;
}

export function activeIntroCrawl() {
  return active;
}
