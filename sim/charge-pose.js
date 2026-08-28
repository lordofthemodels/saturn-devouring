// A charge pose must be deterministic without consuming the gameplay RNG:
// animation variety should not change who hits, converts, or survives a seed.
export function combatChargeArmsHigh(id, chargeSequence) {
  let hash = (Math.imul(id, 0x9e3779b1) ^ Math.imul(chargeSequence, 0x85ebca6b)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash % 3 === 0;
}

// The raised rush is a ragged Y, not two limbs crossing over the head. Keep
// each shoulder's yaw on its anatomical side: letting those signs cross zero
// made a hand periodically point behind the charging form even though its
// height still passed the old silhouette check. The remaining mismatched
// waves keep the rigid, jointless arms flailing independently; writing into
// `out` avoids allocating twice per visible form per frame.
export function combatChargeArmPose(side, phase, id, out) {
  const seed = id * 0.173;
  // The first term gives every shoulder its own resting raise angle. The
  // three incompatible motion rates then make it shudder instead of tracing
  // the same smooth arc as every other form in the rush.
  out.x = -side * (1.52
    + Math.sin(id * 1.713 + side * 2.177) * 0.08
    + Math.sin(phase * 0.83 + side * 0.7 + seed) * 0.08
    + Math.sin(phase * 1.91 - side * 0.45 + seed * 0.37) * 0.045
    + Math.sin(phase * 3.87 + side * 1.2 + seed * 1.1) * 0.035);
  out.y = side * (0.14
    + Math.sin(phase * 1.27 + side * 0.9 + seed) * 0.055
    + Math.sin(phase * 2.61 - seed * 0.31) * 0.025);
  out.z = -0.10
    + Math.sin(phase * 0.97 - side * 0.8 + seed * 0.71) * 0.06
    + Math.sin(phase * 2.33 + side + seed * 0.23) * 0.03;
  return out;
}

// The melee thrash shares the charge's hard anatomical rule: neither rigid
// limb may rotate through the body's centre plane. The old positive X swing
// raised both arms inward, so the long Flood limbs crossed above the sternum.
// Keep the lift outward and keep the smaller yaw offset on the same side;
// foreAft still supplies the violent two-beat lash in the attack plane.
export function combatAttackArmPose(side, phase, id, foreAft, out) {
  const envelope = Math.sin(phase * Math.PI);
  out.x = -side * envelope * 0.7;
  out.y = side * (0.10 + Math.sin(phase * Math.PI * 4.4 + id) * 0.05) * envelope;
  out.z = foreAft;
  return out;
}
