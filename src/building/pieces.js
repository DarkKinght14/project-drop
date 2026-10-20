/* =====================================================================
   BUILD PIECE SHAPES
   Walls, floors, stairs and roofs, in three materials:
   wood = planks, stone = bricks, metal = ribbed panels.
   Each shape is built from boxes, then baked into one (core/bake.js),
   so hundreds of pieces can be drawn in a handful of draw calls.
   ===================================================================== */
import * as THREE from 'three';
import { SETTINGS } from '../settings.js';
import { bakeGeometry } from '../core/bake.js';

const B = SETTINGS.building;
const T = B.tile, H = B.height;
const unit = new THREE.BoxGeometry(1, 1, 1);
const tmpMats = new Map();
const tmpMat = (c) => { if (!tmpMats.has(c)) tmpMats.set(c, new THREE.MeshBasicMaterial({ color: c })); return tmpMats.get(c); };

function box(group, color, w, h, d, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(unit, tmpMat(color));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  group.add(m);
}

const COLORS = {
  wood: { main: ['#c4874a', '#b5793f', '#cf955a'], dark: '#8e5a2b' },
  stone: { main: ['#a7abb3', '#9a9ea7', '#b4b8bf'], dark: '#6f737b' },
  metal: { main: ['#8297ad'], light: '#a3b4c6', dark: '#5d6f82' },
};

// A flat panel w wide and h tall (facing +Z), in a material's style.
function panel(group, mat, w, h) {
  const c = COLORS[mat];
  if (mat === 'wood') {
    const planks = 6, pw = w / planks;
    for (let i = 0; i < planks; i++) box(group, c.main[i % 3], pw - 0.04, h, 0.18, -w / 2 + pw * (i + 0.5), 0, 0);
    for (const y of [-h * 0.3, h * 0.3]) box(group, c.dark, w, 0.18, 0.24, 0, y, 0);
  } else if (mat === 'stone') {
    box(group, c.dark, w, h, 0.16);
    const rows = 4, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 ? 0.5 : 0;
      const bw = w / 3;
      for (let i = -offset; i < 3; i++) {
        const left = Math.max(-w / 2, -w / 2 + i * bw), right = Math.min(w / 2, -w / 2 + (i + 1) * bw);
        if (right - left < 0.1) continue;
        box(group, c.main[(r + Math.round(i + offset)) % 3], right - left - 0.06, rh - 0.06, 0.22, (left + right) / 2, -h / 2 + rh * (r + 0.5), 0);
      }
    }
  } else {
    box(group, c.main[0], w, h, 0.16);
    for (let i = 1; i <= 4; i++) box(group, c.light, w - 0.2, 0.1, 0.24, 0, -h / 2 + (h * i) / 5, 0);
    for (const x of [-w / 2 + 0.07, w / 2 - 0.07]) box(group, c.dark, 0.14, h, 0.26, x, 0, 0);
    for (const y of [-h / 2 + 0.07, h / 2 - 0.07]) box(group, c.dark, w, 0.14, 0.26, 0, y, 0);
  }
}

// Stairs rising toward -Z (north); the grid code turns them to face the right way.
function stairs(group, mat) {
  const c = COLORS[mat];
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const top = ((i + 1) * H) / steps;
    box(group, c.main[i % c.main.length], T, top, T / steps, 0, -H / 2 + top / 2, T / 2 - (i + 0.5) * (T / steps));
  }
  for (const x of [-T / 2 + 0.08, T / 2 - 0.08]) {
    // side rails along the slope
    const rail = new THREE.Mesh(unit, tmpMat(c.dark));
    rail.scale.set(0.16, 0.14, Math.hypot(T, H));
    rail.position.set(x, 0.12, 0);
    rail.rotation.x = Math.atan2(H, T);
    group.add(rail);
  }
}

function roof(group, mat) {
  const c = COLORS[mat];
  const cone = new THREE.Mesh(new THREE.ConeGeometry(T / Math.SQRT2, 1.6, 4), tmpMat(c.main[0]));
  cone.rotation.y = Math.PI / 4;
  cone.position.y = 0.8;
  group.add(cone);
  box(group, c.dark, T, 0.12, T, 0, 0.06, 0);
}

const cache = new Map();
export function pieceGeometry(type, mat) {
  const key = type + mat;
  if (cache.has(key)) return cache.get(key);
  const g = new THREE.Group();
  if (type === 'wall') panel(g, mat, T, H);
  else if (type === 'floor') {
    const inner = new THREE.Group();
    panel(inner, mat, T, T);
    inner.rotation.x = -Math.PI / 2; // lay the panel flat
    g.add(inner);
  } else if (type === 'ramp') stairs(g, mat);
  else roof(g, mat);
  const geo = bakeGeometry(g);
  cache.set(key, geo);
  return geo;
}

// The physics shape for each piece (in the piece's own space, before turning).
export function pieceColliderShape(type) {
  if (type === 'wall') return { kind: 'box', half: [T / 2, H / 2, 0.12] };
  if (type === 'floor') return { kind: 'box', half: [T / 2, 0.12, T / 2] };
  if (type === 'ramp') return { kind: 'slope', half: [T / 2, 0.12, Math.hypot(T, H) / 2], angle: Math.atan2(H, T) };
  // a pyramid
  const r = T / 2;
  return { kind: 'hull', points: [-r, 0, -r, r, 0, -r, r, 0, r, -r, 0, r, 0, 1.6, 0] };
}
