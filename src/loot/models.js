/* =====================================================================
   ITEM MODELS
   3D shapes for guns, healing items, ammo boxes, the pickaxe and chests.
   Every model points "forward" along +Z. Guns have a "muzzle" marker at
   the tip of the barrel, where bullets and the muzzle flash come out.
   Each model is built from small shapes, then "baked" into one shape
   (see core/bake.js) and remembered, so copies are cheap to make and draw.
   ===================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SETTINGS } from '../settings.js';
import { bakeGeometry, bakedMaterial } from '../core/bake.js';

// Build a model once per key, then hand out cheap copies that share its shape.
const bakedCache = new Map();
function baked(key, build, castShadow = true) {
  if (!bakedCache.has(key)) {
    const parts = new THREE.Group();
    build(parts);
    bakedCache.set(key, bakeGeometry(parts));
  }
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(bakedCache.get(key), bakedMaterial);
  mesh.castShadow = castShadow;
  group.add(mesh);
  return group;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const unitBall = new THREE.SphereGeometry(0.5, 12, 8);

// Materials are shared: one per color (much faster than one per object).
const cache = new Map();
export function mat(color, glow = 0) {
  const key = color + glow;
  if (!cache.has(key)) {
    cache.set(key, new THREE.MeshLambertMaterial({ color, emissive: glow ? color : '#000000', emissiveIntensity: glow }));
  }
  return cache.get(key);
}

// Adds one shape to a group. size = [w, h, d], at = [x, y, z].
function add(group, geo, color, size, at, glow = 0) {
  const m = new THREE.Mesh(geo, mat(color, glow));
  m.scale.set(...size);
  m.position.set(...at);
  m.castShadow = true;
  group.add(m);
  return m;
}

const DARK = '#2b2f38', GREY = '#4a505c', WOOD = '#8a5a32';

// ---------- Guns ----------
// Each recipe: list of [shape, color, size, position]. 'R' = the rarity color.
const GUNS = {
  pistol: { muzzle: 0.24, parts: [
    [unitBox, DARK, [0.06, 0.08, 0.26], [0, 0.03, 0.1]],
    [unitBox, GREY, [0.05, 0.14, 0.07], [0, -0.06, -0.01]],
    [unitBox, 'R', [0.065, 0.02, 0.2], [0, 0.075, 0.1]],
  ] },
  smg: { muzzle: 0.36, parts: [
    [unitBox, DARK, [0.07, 0.11, 0.38], [0, 0.03, 0.12]],
    [unitBox, GREY, [0.05, 0.13, 0.06], [0, -0.07, 0]],
    [unitBox, GREY, [0.045, 0.17, 0.06], [0, -0.09, 0.14]],
    [unitBox, DARK, [0.035, 0.035, 0.08], [0, 0.04, 0.33]],
    [unitBox, 'R', [0.075, 0.025, 0.22], [0, 0.09, 0.12]],
  ] },
  ar: { muzzle: 0.68, parts: [
    [unitBox, DARK, [0.08, 0.12, 0.5], [0, 0.03, 0.18]],
    [unitBox, DARK, [0.035, 0.035, 0.26], [0, 0.05, 0.55]],
    [unitBox, GREY, [0.07, 0.13, 0.24], [0, 0.0, -0.18]],
    [unitBox, GREY, [0.05, 0.13, 0.06], [0, -0.07, 0.02]],
    [unitBox, GREY, [0.06, 0.19, 0.08], [0, -0.1, 0.17]],
    [unitBox, DARK, [0.03, 0.05, 0.1], [0, 0.12, 0.12]],
    [unitBox, 'R', [0.085, 0.03, 0.3], [0, 0.03, 0.26]],
  ] },
  shotgun: { muzzle: 0.74, parts: [
    [unitBox, DARK, [0.08, 0.1, 0.42], [0, 0.03, 0.16]],
    [unitBox, DARK, [0.05, 0.05, 0.4], [0, 0.06, 0.54]],
    [unitBox, WOOD, [0.08, 0.07, 0.16], [0, -0.01, 0.48]],
    [unitBox, WOOD, [0.07, 0.12, 0.26], [0, -0.01, -0.18]],
    [unitBox, GREY, [0.05, 0.13, 0.06], [0, -0.07, 0.0]],
    [unitBox, 'R', [0.085, 0.025, 0.24], [0, 0.085, 0.14]],
  ] },
  sniper: { muzzle: 0.9, parts: [
    [unitBox, DARK, [0.08, 0.1, 0.55], [0, 0.03, 0.15]],
    [unitBox, DARK, [0.035, 0.035, 0.5], [0, 0.04, 0.65]],
    [unitBox, WOOD, [0.07, 0.13, 0.3], [0, -0.01, -0.25]],
    [unitBox, GREY, [0.05, 0.13, 0.06], [0, -0.07, 0.0]],
    [unitCyl, DARK, [0.06, 0.28, 0.06], [0, 0.13, 0.15], 'scope'],
    [unitBox, 'R', [0.085, 0.025, 0.28], [0, -0.03, 0.2]],
  ] },
};

export function makeGunModel(type, rarity) {
  const recipe = GUNS[type];
  const rarityColor = SETTINGS.rarity[rarity].color;
  const group = baked(`gun-${type}-${rarity}`, (g) => {
    for (const [geo, color, size, at, flag] of recipe.parts) {
      const m = add(g, geo, color === 'R' ? rarityColor : color, size, at, color === 'R' ? 0.45 : 0);
      if (flag === 'scope') m.rotation.x = Math.PI / 2; // lay the cylinder along the gun
    }
  });
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.05, recipe.muzzle);
  group.add(muzzle);
  return { group, muzzle };
}

// ---------- Healing items ----------
export function makeHealModel(type) {
  return baked(`heal-${type}`, (g) => buildHeal(g, type));
}
function buildHeal(g, type) {
  const color = SETTINGS.heals[type].color;
  if (type === 'bandage') {
    add(g, unitCyl, color, [0.14, 0.12, 0.14], [0, 0.06, 0]).rotation.z = Math.PI / 2;
    add(g, unitCyl, '#d9d0bf', [0.06, 0.125, 0.06], [0, 0.06, 0]).rotation.z = Math.PI / 2;
  } else if (type === 'medkit') {
    add(g, unitBox, color, [0.34, 0.22, 0.24], [0, 0.11, 0]);
    add(g, unitBox, '#ffffff', [0.14, 0.04, 0.245], [0, 0.11, 0.001]);
    add(g, unitBox, '#ffffff', [0.04, 0.14, 0.245], [0, 0.11, 0.002]);
  } else {
    const big = type === 'bigShield';
    const r = big ? 0.2 : 0.13;
    add(g, unitBall, color, [r, r * 1.1, r], [0, r * 0.55, 0], 0.5);
    add(g, unitCyl, '#d8eaff', [r * 0.35, r * 0.5, r * 0.35], [0, r * 1.25, 0]);
    add(g, unitCyl, '#8a5a32', [r * 0.4, r * 0.15, r * 0.4], [0, r * 1.5, 0]);
  }
}

// ---------- Ammo box ----------
export function makeAmmoModel(type) {
  return baked(`ammo-${type}`, (g) => {
    add(g, unitBox, '#5b6b45', [0.36, 0.2, 0.22], [0, 0.1, 0]);
    add(g, unitBox, SETTINGS.ammo[type].color, [0.37, 0.05, 0.225], [0, 0.17, 0], 0.4);
  });
}

export function makeItemModel(item) {
  if (item.kind === 'weapon') return makeGunModel(item.type, item.rarity).group;
  if (item.kind === 'heal') return makeHealModel(item.type);
  return makeAmmoModel(item.type);
}

// ---------- Pickaxe ----------
export function makePickaxeModel() {
  return baked('pickaxe', (g) => {
    add(g, unitCyl, '#8a5a32', [0.04, 0.6, 0.04], [0, 0, 0.22]).rotation.x = Math.PI / 2;
    add(g, unitBox, '#c9ced8', [0.05, 0.05, 0.42], [0, 0.0, 0.5]).rotation.x = Math.PI / 2;
    add(g, unitBox, '#18c2b4', [0.06, 0.06, 0.08], [0, 0, 0.5], 0.3);
  });
}

// ---------- Chest ----------
// The lid is its own group with the hinge at the back, so it can swing open.
const CHEST = { w: 1.0, h: 0.5, d: 0.62 };
export function makeChestModel() {
  const { w: W, h: H, d: D } = CHEST;
  const root = baked('chest-base', (g) => {
    add(g, unitBox, '#9c6a2e', [W, H, D], [0, H / 2, 0]);
    add(g, unitBox, '#ffcf3f', [W + 0.02, 0.06, D + 0.02], [0, H - 0.03, 0], 0.35);
    for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) add(g, unitBox, '#ffcf3f', [0.07, H, D + 0.02], [x, H / 2, 0], 0.35);
  });
  const lid = baked('chest-lid', (g) => {
    add(g, unitBox, '#a8742f', [W, 0.22, D], [0, 0.11, D / 2]);
    add(g, unitBox, '#ffcf3f', [W + 0.02, 0.05, 0.08], [0, 0.2, D - 0.02], 0.35);
    add(g, unitBox, '#ffe680', [0.12, 0.14, 0.04], [0, 0.0, D + 0.01], 0.6); // the lock
  });
  lid.position.set(0, H, -D / 2);
  root.add(lid);
  return { root, lid, size: { w: W, h: H + 0.22, d: D } };
}

// ---------- Rarity glow under floor loot ----------
// A glowing ring on the ground plus a faint beam of light, as one shape.
const glowGeo = mergeGeometries([
  new THREE.RingGeometry(0.28, 0.42, 24).rotateX(-Math.PI / 2).translate(0, 0.03, 0),
  new THREE.CylinderGeometry(0.05, 0.12, 1.6, 8, 1, true).translate(0, 0.8, 0),
].map((g) => (g.index ? g.toNonIndexed() : g)));
const glowCache = new Map();
export function makeGlow(color) {
  if (!glowCache.has(color)) {
    glowCache.set(color, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
  }
  return new THREE.Mesh(glowGeo, glowCache.get(color));
}
