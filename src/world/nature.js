/* =====================================================================
   TREES, ROCKS & BUSHES
   Hundreds of copies of the same shape are drawn with "InstancedMesh":
   the graphics card draws them all in one go, which keeps the game fast.
   Each tree and rock also gets a physics collider so you bump into it.
   They're stored in lists so later builds can harvest them for materials.
   ===================================================================== */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SETTINGS } from '../settings.js';

const dummy = new THREE.Object3D();
const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

// Find random spots that pass a test (right height, not too steep, not inside a house...).
function scatter(count, rng, field, isFree, test) {
  const spots = [];
  const range = field.half * 0.9;
  for (let tries = 0; spots.length < count && tries < count * 25; tries++) {
    const x = (rng() * 2 - 1) * range, z = (rng() * 2 - 1) * range;
    const y = field.heightAt(x, z);
    if (test(y, field.steepness(x, z)) && isFree(x, z)) spots.push({ x, y, z });
  }
  return spots;
}

function instanced(geometry, material, count) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildTrees(scene, physics, field, rng, isFree) {
  const spots = scatter(SETTINGS.world.trees, rng, field, isFree, (y, steep) => y > 2 && y < 30 && steep < 0.7);
  for (const s of spots) { s.kind = rng() < 0.6 ? 'pine' : 'round'; s.scale = 0.8 + rng() * 0.6; }
  const pines = spots.filter((s) => s.kind === 'pine');
  const rounds = spots.filter((s) => s.kind === 'round');

  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.36, 1, 6).translate(0, 0.5, 0);
  const coneGeo = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
  const ballGeo = new THREE.IcosahedronGeometry(1, 0);

  const trunks = instanced(trunkGeo, lambert('#7a4f2a'), spots.length);
  const coneLow = instanced(coneGeo, lambert('#ffffff'), pines.length);
  const coneHigh = instanced(coneGeo, lambert('#ffffff'), pines.length);
  const balls = instanced(ballGeo, lambert('#ffffff'), rounds.length);
  const color = new THREE.Color();
  const trees = [];

  spots.forEach((s, i) => {
    const scale = s.scale;
    const trunkHeight = (s.kind === 'pine' ? 2.2 : 2.8) * scale;
    dummy.position.set(s.x, s.y - 0.2, s.z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.set(scale, trunkHeight, scale);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    trees.push({ x: s.x, y: s.y, z: s.z, kind: s.kind, scale });

    // Trunk collider: an upright cylinder
    physics.createCollider(
      RAPIER.ColliderDesc.cylinder(trunkHeight / 2, 0.38 * scale).setTranslation(s.x, s.y + trunkHeight / 2, s.z),
    );
  });

  pines.forEach((s, i) => {
    const sc = s.scale, base = s.y + 1.4 * sc;
    color.set('#2f8a3e').offsetHSL((rng() - 0.5) * 0.04, 0, (rng() - 0.5) * 0.08);
    dummy.rotation.set(0, rng() * Math.PI, 0);
    dummy.position.set(s.x, base, s.z); dummy.scale.set(2.3 * sc, 3.4 * sc, 2.3 * sc); dummy.updateMatrix();
    coneLow.setMatrixAt(i, dummy.matrix); coneLow.setColorAt(i, color);
    dummy.position.set(s.x, base + 2.2 * sc, s.z); dummy.scale.set(1.6 * sc, 2.8 * sc, 1.6 * sc); dummy.updateMatrix();
    coneHigh.setMatrixAt(i, dummy.matrix); coneHigh.setColorAt(i, color.offsetHSL(0, 0, 0.05));
  });

  rounds.forEach((s, i) => {
    const sc = s.scale;
    color.set('#5cb83c').offsetHSL((rng() - 0.5) * 0.06, 0, (rng() - 0.5) * 0.1);
    dummy.rotation.set(rng(), rng(), rng());
    dummy.position.set(s.x, s.y + 3.6 * sc, s.z);
    dummy.scale.set(2.2 * sc, 1.9 * sc, 2.2 * sc);
    dummy.updateMatrix();
    balls.setMatrixAt(i, dummy.matrix); balls.setColorAt(i, color);
  });

  scene.add(trunks, coneLow, coneHigh, balls);
  return trees;
}

export function buildRocks(scene, physics, field, rng, isFree) {
  const spots = scatter(SETTINGS.world.rocks, rng, field, isFree, (y) => y > 0.5 && y < 34);
  const mesh = instanced(new THREE.IcosahedronGeometry(1, 0), lambert('#ffffff'), spots.length);
  const color = new THREE.Color();
  const rocks = [];
  spots.forEach((s, i) => {
    const size = 0.7 + rng() * 1.8;
    dummy.position.set(s.x, s.y + size * 0.25, s.z);
    dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    dummy.scale.set(size * (1 + rng() * 0.4), size * 0.75, size * (1 + rng() * 0.4));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.set('#9a9ca3').offsetHSL(0, 0, (rng() - 0.5) * 0.12));
    physics.createCollider(RAPIER.ColliderDesc.ball(size * 0.85).setTranslation(s.x, s.y + size * 0.25, s.z));
    rocks.push({ x: s.x, y: s.y, z: s.z, size });
  });
  scene.add(mesh);
  return rocks;
}

// Bushes are just decoration: you can walk through them (and hide in them later).
export function buildBushes(scene, field, rng, isFree) {
  const spots = scatter(SETTINGS.world.bushes, rng, field, isFree, (y, steep) => y > 1.8 && y < 28 && steep < 0.8);
  const mesh = instanced(new THREE.IcosahedronGeometry(1, 0), lambert('#ffffff'), spots.length);
  const color = new THREE.Color();
  spots.forEach((s, i) => {
    const size = 0.6 + rng() * 0.7;
    dummy.position.set(s.x, s.y + size * 0.4, s.z);
    dummy.rotation.set(rng(), rng(), rng());
    dummy.scale.set(size * 1.3, size, size * 1.3);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.set('#3f9a35').offsetHSL((rng() - 0.5) * 0.05, 0, (rng() - 0.5) * 0.1));
  });
  mesh.castShadow = false;
  scene.add(mesh);
}
