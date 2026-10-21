/* =====================================================================
   NAVIGATION GRID
   A map of the island for the bots, made of 1 m squares ("cells").
   Each cell is either walkable or blocked (water, cliffs, trees, rocks,
   cars, house walls...). It's worked out once while the game loads.

   To get somewhere, a bot asks for a path. "A*" (A-star) searches
   outward from the bot, always trying the most promising cell first
   (the one that looks closest to the goal), until it reaches the goal.
   The path is then straightened out so bots walk in natural lines
   instead of zig-zagging from cell to cell.
   ===================================================================== */
import RAPIER from '@dimforge/rapier3d-compat';
import { SETTINGS } from '../settings.js';

const SQRT2 = Math.SQRT2;
// The 8 neighbours of a cell: [dx, dz, cost]
const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]];

export class NavGrid {
  constructor(world, physics) {
    const cell = SETTINGS.nav.cell;
    this.cell = cell;
    this.half = SETTINGS.world.size / 2;
    const n = (this.n = Math.ceil(SETTINGS.world.size / cell));
    this.walk = new Uint8Array(n * n);
    this.height = new Float32Array(n * n);

    // 1. Ground height of every cell
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const { x, z } = this.center(ix, iz);
        this.height[iz * n + ix] = world.heightAt(x, z);
      }
    }
    // 2. Walkable = dry land, not too steep, nothing solid standing there
    const probe = new RAPIER.Cuboid(0.3, 0.55, 0.3);
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    const water = SETTINGS.world.waterLevel + 0.25;
    for (let iz = 2; iz < n - 2; iz++) {
      for (let ix = 2; ix < n - 2; ix++) {
        const i = iz * n + ix, h = this.height[i];
        if (h < water) continue;
        const steep = Math.max(
          Math.abs(h - this.height[i + 1]), Math.abs(h - this.height[i - 1]),
          Math.abs(h - this.height[i + n]), Math.abs(h - this.height[i - n]),
        ) / cell;
        if (steep > 1.0) continue;
        const { x, z } = this.center(ix, iz);
        const blocked = physics.intersectionWithShape({ x, y: h + 0.95, z }, rot, probe, undefined, undefined, world.terrainCollider);
        if (!blocked) this.walk[i] = 1;
      }
    }

    // Search scratch space, reused for every path (a "stamp" marks which cells this search touched)
    this.g = new Float32Array(n * n);
    this.from = new Int32Array(n * n);
    this.stamp = new Uint32Array(n * n);
    this.closedStamp = new Uint32Array(n * n);
    this.search = 0;
    this.heap = new Int32Array(n * n);
    this.f = new Float32Array(n * n);
  }

  center(ix, iz) { return { x: -this.half + (ix + 0.5) * this.cell, z: -this.half + (iz + 0.5) * this.cell }; }
  cellAt(x, z) {
    const ix = Math.floor((x + this.half) / this.cell), iz = Math.floor((z + this.half) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.n || iz >= this.n) return -1;
    return iz * this.n + ix;
  }
  walkableAt(x, z) { const i = this.cellAt(x, z); return i >= 0 && this.walk[i] === 1; }

  // The closest walkable cell to a point (searching outward in rings), or -1.
  nearestWalkable(x, z, radius = 6) {
    const i = this.cellAt(x, z);
    if (i < 0) return -1;
    if (this.walk[i]) return i;
    const ix = i % this.n, iz = Math.floor(i / this.n);
    for (let r = 1; r <= radius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= this.n || jz >= this.n) continue;
          if (this.walk[jz * this.n + jx]) return jz * this.n + jx;
        }
      }
    }
    return -1;
  }

  // A random walkable spot within "radius" of a point (or anywhere), or null.
  randomSpot(rng, near = null, radius = 60) {
    for (let tries = 0; tries < 60; tries++) {
      const x = near ? near.x + (rng() * 2 - 1) * radius : (rng() * 2 - 1) * this.half * 0.85;
      const z = near ? near.z + (rng() * 2 - 1) * radius : (rng() * 2 - 1) * this.half * 0.85;
      if (this.walkableAt(x, z)) return { x, z };
    }
    return null;
  }

  // Is the straight line between two points walkable all the way?
  lineClear(ax, az, bx, bz) {
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(dist / (this.cell * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (!this.walkableAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  // ---------- A* path finding ----------
  // Returns a list of points [{x, z}, ...] ending at (or near) the goal, or null.
  findPath(from, to) {
    const n = this.n;
    const start = this.nearestWalkable(from.x, from.z, 3);
    const goal = this.nearestWalkable(to.x, to.z, 8);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: to.x, z: to.z }];

    const stampId = ++this.search;
    const gx = goal % n, gz = Math.floor(goal / n);
    const heuristic = (i) => {
      const dx = Math.abs((i % n) - gx), dz = Math.abs(Math.floor(i / n) - gz);
      return (dx + dz + (SQRT2 - 2) * Math.min(dx, dz)) * 1.3; // a bit greedy: faster, nearly as short
    };
    // Binary heap ordered by f (= distance so far + estimated distance left)
    const heap = this.heap, f = this.f;
    let size = 0;
    const push = (i) => {
      let k = size++;
      heap[k] = i;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (f[heap[p]] <= f[heap[k]]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      heap[0] = heap[--size];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < size && f[heap[l]] < f[heap[m]]) m = l;
        if (r < size && f[heap[r]] < f[heap[m]]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
      return top;
    };

    this.stamp[start] = stampId;
    this.g[start] = 0;
    this.from[start] = -1;
    f[start] = heuristic(start);
    push(start);
    let best = start, bestH = Infinity, expanded = 0;

    while (size > 0 && expanded < SETTINGS.nav.maxSearch) {
      const cur = pop();
      if (this.closedStamp[cur] === stampId) continue;
      this.closedStamp[cur] = stampId;
      expanded++;
      if (cur === goal) { best = goal; break; }
      const h = heuristic(cur);
      if (h < bestH) { bestH = h; best = cur; }
      const cx = cur % n, cz = Math.floor(cur / n);
      for (const [dx, dz, cost] of STEPS) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const ni = nz * n + nx;
        if (!this.walk[ni] || this.closedStamp[ni] === stampId) continue;
        // no cutting corners diagonally past an obstacle
        if (dx && dz && (!this.walk[cz * n + nx] || !this.walk[nz * n + cx])) continue;
        const g = this.g[cur] + cost;
        if (this.stamp[ni] === stampId && g >= this.g[ni]) continue;
        this.stamp[ni] = stampId;
        this.g[ni] = g;
        this.from[ni] = cur;
        f[ni] = g + heuristic(ni);
        push(ni);
      }
    }

    // Walk back from the goal (or the closest cell we reached) to the start
    const cells = [];
    for (let i = best; i !== -1; i = this.from[i]) cells.push(i);
    cells.reverse();
    const points = cells.map((i) => this.center(i % n, Math.floor(i / n)));
    if (best === goal) points[points.length - 1] = { x: to.x, z: to.z };
    return this.smooth(points);
  }

  // Skip every point we can walk to in a straight line ("string pulling").
  smooth(points) {
    if (points.length <= 2) return points;
    const out = [points[0]];
    let anchor = 0;
    while (anchor < points.length - 1) {
      let next = anchor + 1;
      for (let j = Math.min(points.length - 1, anchor + 40); j > anchor + 1; j--) { // look up to 40 m ahead
        if (this.lineClear(points[anchor].x, points[anchor].z, points[j].x, points[j].z)) { next = j; break; }
      }
      out.push(points[next]);
      anchor = next;
    }
    return out.slice(1); // the first point is where the bot already is
  }
}
