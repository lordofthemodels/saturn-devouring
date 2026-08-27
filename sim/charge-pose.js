// A charge pose must be deterministic without consuming the gameplay RNG:
// animation variety should not change who hits, converts, or survives a seed.
export function combatChargeArmsHigh(id, chargeSequence) {
  let hash = (Math.imul(id, 0x9e3779b1) ^ Math.imul(chargeSequence, 0x85ebca6b)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash % 3 === 0;
}

// The raised rush is a ragged Y, not two limbs crossing over the head. Three
// mismatched waves keep each rigid, jointless arm flailing independently;
// writing into `out` avoids allocating twice per visible form per frame.
export function combatChargeArmPose(side, phase, id, out) {
  const seed = id * 0.173;
  out.x = -side * (1.55
    + Math.sin(phase * 0.83 + side * 0.7 + seed) * 0.13
    + Math.sin(phase * 1.91 - side * 0.45 + seed * 0.37) * 0.05);
  out.y = side * (Math.sin(phase * 1.27 + side * 0.9 + seed) * 0.22
    + Math.sin(phase * 2.61 - seed * 0.31) * 0.08);
  out.z = Math.sin(phase * 0.97 - side * 0.8 + seed * 0.71) * 0.26
    + Math.sin(phase * 2.33 + side + seed * 0.23) * 0.10;
  return out;
}
