/* =====================================================================
   RANDOM NUMBERS & NOISE
   "Seeded" random: the same seed always gives the same numbers,
   so the island comes out identical every time you play.
   ===================================================================== */

// Returns a function that gives a new random number from 0 to 1 each call.
export function makeRandom(seed) {
  let s = seed >>> 0;
  return function random() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// "Value noise": random heights on a grid, blended smoothly in between.
// It gives gentle, natural-looking bumps instead of spiky randomness.
export function makeNoise2D(seed) {
  const rand = makeRandom(seed);
  const perm = new Uint8Array(512);
  const values = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; values[i] = rand(); }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];

  const valueAt = (x, z) => values[perm[(x & 255) + perm[z & 255]]];
  const smooth = (t) => t * t * (3 - 2 * t);

  return function noise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z);
    const u = smooth(x - xi), v = smooth(z - zi);
    const a = valueAt(xi, zi), b = valueAt(xi + 1, zi);
    const c = valueAt(xi, zi + 1), d = valueAt(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// Layers of noise at smaller and smaller sizes ("fractal" noise):
// big hills plus medium bumps plus small details.
export function fbm(noise, x, z, octaves = 4) {
  let sum = 0, amplitude = 0.5, frequency = 1, total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * frequency, z * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

export const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
