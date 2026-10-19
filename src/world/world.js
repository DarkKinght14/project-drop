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

export function buildWorld(scene, physics) {
  const rng = makeRandom(SETTINGS.world.seed);
  const field = makeHeightField(SETTINGS.world.seed);

  const houseSpots = pickHouseSpots(field, rng);
  buildTerrain(scene, physics, field, rng);
  const sky = buildSky(scene, rng);
  const houses = houseSpots.map((spot) => buildHouse(scene, physics, spot, rng));

  // Nature stays out of the houses.
  const isFree = (x, z) => houses.every((h) => Math.hypot(x - h.x, z - h.z) > h.radius);
  const trees = buildTrees(scene, physics, field, rng, isFree);
  const rocks = buildRocks(scene, physics, field, rng, isFree);
  buildBushes(scene, field, rng, isFree);

  // Start the player in front of the first house.
  const home = houses[0] || { x: 0, z: 0 };
  const spawn = { x: home.x + 4, z: home.z + 16 };
  spawn.y = field.heightAt(spawn.x, spawn.z) + 1.2;

  return { field, sky, houses, trees, rocks, spawn, heightAt: field.heightAt };
}
