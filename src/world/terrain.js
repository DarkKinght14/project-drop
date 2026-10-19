/* =====================================================================
   TERRAIN
   The island's ground. heightAt(x, z) answers "how high is the ground
   here?" Everything else (trees, houses, the player) uses it.
   ===================================================================== */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SETTINGS } from '../settings.js';
import { makeNoise2D, fbm, smoothstep } from '../core/random.js';

export function makeHeightField(seed) {
  const { size, maxHeight } = SETTINGS.world;
  const half = size / 2;
  const noise = makeNoise2D(seed);
  const flatZones = []; // flat areas cut into the hills for houses

  // The natural shape: hills in the middle, sloping down into the sea at the edges.
  function rawHeight(x, z) {
    const d = Math.hypot(x, z) / half; // 0 at the center, 1 at the map edge
    const coastline = 0.8 + (noise(x / 60 + 100, z / 60 + 100) - 0.5) * 0.25; // wobbly shore
    const land = 1 - smoothstep(coastline - 0.2, coastline, d);
    const hills = Math.pow(fbm(noise, x / 110, z / 110), 1.7) * maxHeight * 1.6;
    return -5 + land * (6.5 + hills);
  }

  function heightAt(x, z) {
    let h = rawHeight(x, z);
    for (const zone of flatZones) {
      const d = Math.hypot(x - zone.x, z - zone.z);
      if (d < zone.r + 10) h += (zone.h - h) * (1 - smoothstep(zone.r, zone.r + 10, d));
    }
    return h;
  }

  // Slope check: how much the ground rises across a small step.
  function steepness(x, z) {
    const s = 1.5;
    return Math.max(
      Math.abs(heightAt(x + s, z) - heightAt(x - s, z)),
      Math.abs(heightAt(x, z + s) - heightAt(x, z - s)),
    ) / (2 * s);
  }

  return {
    rawHeight, heightAt, steepness, noise, half,
    addFlatZone: (x, z, r, h) => flatZones.push({ x, z, r, h }),
  };
}

const COLORS = {
  sand: new THREE.Color('#e8d49a'),
  wetSand: new THREE.Color('#c9b47c'),
  grass: new THREE.Color('#6cc04a'),
  darkGrass: new THREE.Color('#4f9e3a'),
  rock: new THREE.Color('#8f9198'),
};

export function buildTerrain(scene, physics, field, rng) {
  const { size, resolution, waterLevel } = SETTINGS.world;
  const geometry = new THREE.PlaneGeometry(size, size, resolution, resolution);
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, field.heightAt(pos.getX(i), pos.getZ(i)));

  // Physics: the same triangles become a solid surface you can walk on.
  const vertices = new Float32Array(pos.array);
  const indices = new Uint32Array(geometry.index.array);
  physics.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices));

  // Low-poly look: every triangle gets one flat color depending on height and slope.
  const flat = geometry.toNonIndexed();
  const fpos = flat.attributes.position;
  const colors = new Float32Array(fpos.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const normal = new THREE.Vector3(), color = new THREE.Color();

  for (let i = 0; i < fpos.count; i += 3) {
    a.fromBufferAttribute(fpos, i); b.fromBufferAttribute(fpos, i + 1); c.fromBufferAttribute(fpos, i + 2);
    normal.subVectors(c, b).cross(b.clone().sub(a)).normalize();
    const y = (a.y + b.y + c.y) / 3;
    const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3;

    if (y < waterLevel + 0.2) color.copy(COLORS.wetSand);
    else if (y < waterLevel + 1.6) color.copy(COLORS.sand);
    else if (Math.abs(normal.y) < 0.78) color.copy(COLORS.rock); // only steep slopes are bare rock
    else color.copy(COLORS.grass).lerp(COLORS.darkGrass, field.noise(cx / 25, cz / 25));
    color.offsetHSL(0, 0, (rng() - 0.5) * 0.035); // tiny variation per triangle

    for (let k = 0; k < 3; k++) colors.set([color.r, color.g, color.b], (i + k) * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  flat.computeVertexNormals();

  const mesh = new THREE.Mesh(flat, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Invisible walls at the edge of the map, so nobody swims off forever.
  const half = size / 2;
  for (const [x, z, hx, hz] of [[half, 0, 1, half], [-half, 0, 1, half], [0, half, half, 1], [0, -half, half, 1]]) {
    physics.createCollider(RAPIER.ColliderDesc.cuboid(hx, 60, hz).setTranslation(x, 40, z));
  }
  return mesh;
}
