/* =====================================================================
   PROPS
   Old cars parked around the island. Hit them with the pickaxe for
   metal. All cars of one color are drawn in one go (InstancedMesh).
   ===================================================================== */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SETTINGS } from '../settings.js';
import { bakeGeometry, bakedMaterial } from '../core/bake.js';

const CAR_COLORS = ['#c0533f', '#4f7fb3', '#7f8f4a', '#e8e2d2'];
const L = 4.2, W = 1.9; // car length and width

function carGeometry(color) {
  const g = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const part = (geo, c, size, at, rot) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c }));
    m.scale.set(...size); m.position.set(...at);
    if (rot) m.rotation.set(...rot);
    g.add(m);
  };
  part(box, color, [L, 0.75, W], [0, 0.72, 0]);                   // body
  part(box, '#bfe0f5', [2.3, 0.62, W - 0.12], [-0.25, 1.4, 0]);   // windows
  part(box, color, [2.36, 0.1, W - 0.06], [-0.25, 1.74, 0]);      // roof
  part(box, '#3a3f48', [0.12, 0.3, W + 0.04], [L / 2, 0.55, 0]);  // bumpers
  part(box, '#3a3f48', [0.12, 0.3, W + 0.04], [-L / 2, 0.55, 0]);
  part(box, '#fff2b0', [0.06, 0.16, 0.36], [L / 2 + 0.03, 0.82, 0.6]); // headlights
  part(box, '#fff2b0', [0.06, 0.16, 0.36], [L / 2 + 0.03, 0.82, -0.6]);
  const wheel = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  for (const x of [1.35, -1.35]) for (const z of [W / 2 - 0.1, -W / 2 + 0.1]) part(wheel, '#22252b', [1, 1, 1], [x, 0.38, z], [Math.PI / 2, 0, 0]);
  return bakeGeometry(g);
}

export function buildCars(scene, physics, field, rng, isFree, trees, rocks) {
  const count = SETTINGS.harvest.cars;
  const spots = [];
  for (let tries = 0; spots.length < count && tries < count * 60; tries++) {
    const x = (rng() * 2 - 1) * field.half * 0.8, z = (rng() * 2 - 1) * field.half * 0.8;
    const y = field.heightAt(x, z);
    if (y < 1.5 || field.steepness(x, z) > 0.25 || !isFree(x, z)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.2) || rocks.some((r) => Math.hypot(r.x - x, r.z - z) < r.size + 3)) continue;
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 8)) continue;
    spots.push({ x, y, z, rotY: rng() * Math.PI * 2, color: Math.floor(rng() * CAR_COLORS.length) });
  }

  const cars = [];
  const dummy = new THREE.Object3D();
  CAR_COLORS.forEach((color, ci) => {
    const mine = spots.filter((s) => s.color === ci);
    if (!mine.length) return;
    const mesh = new THREE.InstancedMesh(carGeometry(color), bakedMaterial, mine.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mine.forEach((s, i) => {
      dummy.position.set(s.x, s.y - 0.05, s.z);
      dummy.rotation.set(0, s.rotY, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const q = new THREE.Quaternion().setFromEuler(dummy.rotation);
      const collider = physics.createCollider(
        RAPIER.ColliderDesc.cuboid(L / 2, 0.9, W / 2).setTranslation(s.x, s.y + 0.85, s.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      );
      cars.push({ x: s.x, y: s.y, z: s.z, collider, parts: [{ mesh, index: i }] });
    });
    scene.add(mesh);
  });
  return cars;
}
