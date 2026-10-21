/* =====================================================================
   WORLD
   Builds the whole island in the right order:
   1. decide the shape of the land and where houses go
   2. flatten the ground under the houses
   3. build the ground, sky, houses, then trees and rocks around them
   ===================================================================== */
import { SETTINGS } from '../settings.js';
import { makeRandom } from '../core/random.js';
import { makeHeightField, buildTerrain } from './terrain.js';
import { buildSky } from './sky.js';
import { pickHouseSpots, buildHouse } from './houses.js';
import { buildTrees, buildRocks, buildBushes } from './nature.js';
import { buildCars } from './props.js';

export function buildWorld(scene, physics) {
  const rng = makeRandom(SETTINGS.world.seed);
  const field = makeHeightField(SETTINGS.world.seed);

  const houseSpots = pickHouseSpots(field, rng);
  const terrain = buildTerrain(scene, physics, field, rng);
  const sky = buildSky(scene, rng);
  const houses = houseSpots.map((spot) => buildHouse(scene, physics, spot, rng));

  // Start the player near the first house, with a practice range in front.
  const home = houses[0] || { x: 0, z: 0 };
  const spawn = { x: home.x + 4, z: home.z + 16 };
  spawn.y = field.heightAt(spawn.x, spawn.z) + 1.2;
  const range = pickRangeDirection(field, houses, spawn);

  // Nature stays out of the houses, the start area and the shooting lane.
  const isFree = (x, z) => houses.every((h) => Math.hypot(x - h.x, z - h.z) > h.radius) && !inRange(range, x, z);
  const trees = buildTrees(scene, physics, field, rng, isFree);
  const rocks = buildRocks(scene, physics, field, rng, isFree);
  buildBushes(scene, field, rng, isFree);
  const cars = buildCars(scene, physics, field, rng, isFree, trees, rocks);

  return { field, sky, houses, trees, rocks, cars, spawn, range, heightAt: field.heightAt, terrainCollider: terrain.collider };
}

// The practice range points in the flattest direction from the spawn point.
// Returns the start point, the direction (yaw) and its forward/right arrows.
function pickRangeDirection(field, houses, spawn) {
  let bestYaw = 0, bestScore = -1;
  for (let k = 0; k < 8; k++) {
    const yaw = (k * Math.PI) / 4;
    let score = 0;
    for (let d = 6; d <= 46; d += 4) {
      const x = spawn.x - Math.sin(yaw) * d, z = spawn.z - Math.cos(yaw) * d, y = field.heightAt(x, z);
      const ok = y > 1 && field.steepness(x, z) < 0.5 && Math.abs(y - spawn.y) < 8 &&
        houses.every((h) => Math.hypot(x - h.x, z - h.z) > h.radius);
      if (ok) score++;
    }
    if (score > bestScore) { bestScore = score; bestYaw = yaw; }
  }
  return {
    x: spawn.x, z: spawn.z, yaw: bestYaw,
    forward: { x: -Math.sin(bestYaw), z: -Math.cos(bestYaw) },
    right: { x: Math.cos(bestYaw), z: -Math.sin(bestYaw) },
    length: 46,
  };
}

// Is this point in the start area or the shooting lane? (kept clear of trees and rocks)
function inRange(range, x, z) {
  const dx = x - range.x, dz = z - range.z;
  const ahead = dx * range.forward.x + dz * range.forward.z;
  const side = dx * range.right.x + dz * range.right.z;
  if (Math.hypot(dx, dz) < 9) return true;
  return ahead > -4 && ahead < range.length && Math.abs(side) < 7;
}
