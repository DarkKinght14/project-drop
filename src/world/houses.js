/* =====================================================================
   HOUSES
   Each house is made of boxes: a floor, four walls (the front one has a
   doorway), a ceiling, a pointed roof and some furniture. Every solid
   box also gets a physics collider, so walls really block you.
   ===================================================================== */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SETTINGS } from '../settings.js';

const WALL_COLORS = ['#f3d9a4', '#e9b9a3', '#bcd9ec', '#d6e8b5', '#f0e6d8'];
const ROOF_COLORS = ['#c8513f', '#4a6fb0', '#3f8f6b', '#8a5a3c'];
const materials = new Map();
const material = (color) => {
  if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
  return materials.get(color);
};
const unitBox = new THREE.BoxGeometry(1, 1, 1);

// Choose flat-enough places for houses, spread out across the island.
export function pickHouseSpots(field, rng) {
  const spots = [];
  const range = field.half * 0.62;
  for (let tries = 0; spots.length < SETTINGS.world.houses && tries < 4000; tries++) {
    const x = (rng() * 2 - 1) * range, z = (rng() * 2 - 1) * range;
    const h = field.rawHeight(x, z);
    if (h < 3 || h > 18) continue;
    const corners = [[-7, -7], [7, -7], [-7, 7], [7, 7]].map(([dx, dz]) => field.rawHeight(x + dx, z + dz));
    if (Math.max(...corners) - Math.min(...corners) > 5) continue;
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 45)) continue;
    spots.push({ x, z, h: (h + corners.reduce((a, b) => a + b, 0) / 4) / 2, rotY: Math.floor(rng() * 4) * Math.PI / 2 });
  }
  for (const s of spots) field.addFlatZone(s.x, s.z, 9, s.h);
  return spots;
}

export function buildHouse(scene, physics, spot, rng) {
  const W = 9, D = 11, H = 3.4, T = 0.3; // width, depth, wall height, wall thickness
  const doorW = 1.7, doorH = 2.5;
  const wallColor = WALL_COLORS[Math.floor(rng() * WALL_COLORS.length)];
  const roofColor = ROOF_COLORS[Math.floor(rng() * ROOF_COLORS.length)];

  const group = new THREE.Group();
  group.position.set(spot.x, spot.h, spot.z);
  group.rotation.y = spot.rotY;
  scene.add(group);

  // One fixed physics body for the whole house; boxes are attached to it.
  const q = new THREE.Quaternion().setFromEuler(group.rotation);
  const body = physics.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(spot.x, spot.h, spot.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
  );

  // Adds one box: (width, height, depth) centered at (x, y, z) inside the house.
  function box(w, h, d, x, y, z, color, solid = true) {
    const mesh = new THREE.Mesh(unitBox, material(color));
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) physics.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z), body);
    return mesh;
  }

  box(W, 0.3, D, 0, 0.15, 0, '#a8763f');                                   // wooden floor
  box(W, H, T, 0, H / 2 + 0.3, -D / 2, wallColor);                          // back wall
  box(T, H, D, -W / 2, H / 2 + 0.3, 0, wallColor);                          // left wall
  box(T, H, D, W / 2, H / 2 + 0.3, 0, wallColor);                           // right wall
  const side = (W - doorW) / 2;                                            // front wall, split around the door
  box(side, H, T, -(doorW / 2 + side / 2), H / 2 + 0.3, D / 2, wallColor);
  box(side, H, T, doorW / 2 + side / 2, H / 2 + 0.3, D / 2, wallColor);
  box(doorW, H - doorH, T, 0, doorH + 0.3 + (H - doorH) / 2, D / 2, wallColor);
  box(W + 0.8, 0.25, D + 0.8, 0, H + 0.42, 0, '#e8e2d6');                   // ceiling

  // Windows (decoration only): light blue panels on the side walls
  for (const sx of [-1, 1]) {
    for (const wz of [-2.5, 2.5]) box(0.08, 1.1, 1.6, sx * (W / 2 + 0.16), 2.1, wz, '#9fd8ff', false);
  }
  // Door frame and a doormat
  box(0.15, doorH, 0.4, -doorW / 2, doorH / 2 + 0.3, D / 2, '#ffffff', false);
  box(0.15, doorH, 0.4, doorW / 2, doorH / 2 + 0.3, D / 2, '#ffffff', false);
  box(1.4, 0.04, 0.8, 0, 0.32, D / 2 + 0.7, '#b2443a', false);

  // Pointed roof: a four-sided cone, stretched to cover the house
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4), material(roofColor));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set((W + 1.4) / Math.SQRT2, 2.8, (D + 1.4) / Math.SQRT2);
  roof.position.y = H + 0.55 + 1.4;
  roof.castShadow = true;
  group.add(roof);

  // Furniture
  box(1.6, 0.8, 1.0, -2.6, 0.7, -3.2, '#8a5a32');   // table
  box(2.0, 0.6, 1.2, 2.8, 0.6, -3.9, '#5470c6');    // bed
  box(0.9, 1.8, 0.6, 3.6, 1.2, 2.5, '#6b4a2b');     // cupboard

  // A footprint used to keep trees and rocks out of (and next to) the house.
  return { x: spot.x, z: spot.z, radius: 11, floorY: spot.h + 0.3 };
}
