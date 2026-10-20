/* =====================================================================
   BUILDING GRID
   Pieces snap to an invisible grid. Each square ("tile") is 4 x 4 m and
   each floor ("level") is 3.2 m tall. Walls sit on the edges of tiles;
   floors, stairs and roofs fill a whole tile. Snapping everything to the
   grid is what makes pieces line up neatly.

   The island is hilly, so the grid's height isn't fixed: a new building
   starts exactly at your feet ("offset"), and pieces placed next to it
   use the same offset so they line up with it.
   This file is only math (no graphics), so it can be tested on its own.
   ===================================================================== */
import { SETTINGS } from '../settings.js';

const B = SETTINGS.building;
export const PIECES = ['wall', 'floor', 'ramp', 'roof'];

// Which way something faces, from where the camera looks. 'n' is -Z (yaw 0).
const DIRS = {
  n: { x: 0, z: -1, rotY: 0 },
  w: { x: -1, z: 0, rotY: Math.PI / 2 },
  s: { x: 0, z: 1, rotY: Math.PI },
  e: { x: 1, z: 0, rotY: -Math.PI / 2 },
};
export function facing(yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 'e' : 'w';
  return fz > 0 ? 's' : 'n';
}

export const cellOf = (x, z) => ({ cx: Math.floor(x / B.tile), cz: Math.floor(z / B.tile) });
// The level you're standing on (a little tolerance, so standing on a floor counts as that floor).
export const levelOf = (feetY, offset = 0) => Math.floor((feetY - offset + 0.6) / B.height);
// The grid offset that puts a level exactly at this height (0 .. height).
export const offsetFor = (y) => ((y % B.height) + B.height) % B.height;

const baseKey = (base) => Math.round(base * 10);

// Where a wall goes: on one edge of a tile. Two tiles share an edge, so the key
// names the edge itself (that way you can't put two walls in the same spot).
export function wallSlot(cx, cz, level, dir, offset = 0) {
  const T = B.tile, H = B.height;
  const base = level * H + offset;
  const y = base + H / 2;
  const common = { type: 'wall', level, offset, base };
  if (dir === 'n' || dir === 's') {
    const ez = dir === 'n' ? cz : cz + 1;
    return { ...common, key: `wall|${baseKey(base)}|h|${cx}|${ez}`, x: (cx + 0.5) * T, y, z: ez * T, rotY: 0 };
  }
  const ex = dir === 'w' ? cx : cx + 1;
  return { ...common, key: `wall|${baseKey(base)}|v|${ex}|${cz}`, x: ex * T, y, z: (cz + 0.5) * T, rotY: Math.PI / 2 };
}

// Floors, stairs and roofs fill a whole tile. Stairs rise toward "dir".
export function tileSlot(type, cx, cz, level, dir = 'n', offset = 0) {
  const T = B.tile, H = B.height;
  const base = level * H + offset;
  const y = type === 'floor' ? base : type === 'ramp' ? base + H / 2 : base + H; // a roof sits on top of the level
  return {
    type, key: `${type}|${baseKey(base)}|${cx}|${cz}`, x: (cx + 0.5) * T, y, z: (cz + 0.5) * T,
    rotY: type === 'ramp' ? DIRS[dir].rotY : 0, level, dir, offset, base,
  };
}

// Choose where a piece would go, from the player's feet and where the camera looks.
// Looking up builds one level higher; looking steeply down puts a floor under you.
// shoulder: the crosshair is this far right of the player (over-the-shoulder camera),
// so the tile "ahead" is the one under the crosshair, not just in front of your body.
export function pickSlot(type, feet, yaw, pitch, offset = 0, shoulder = 0) {
  const dir = facing(yaw);
  const up = pitch > 0.45 ? 1 : 0;
  const here = cellOf(feet.x, feet.z);
  const aimX = feet.x + Math.cos(yaw) * shoulder, aimZ = feet.z - Math.sin(yaw) * shoulder;
  const ahead = cellOf(aimX - Math.sin(yaw) * B.tile * 0.75, aimZ - Math.cos(yaw) * B.tile * 0.75);
  const level = levelOf(feet.y, offset);
  if (type === 'wall') return wallSlot(here.cx, here.cz, level + up, dir, offset);
  if (type === 'floor' && pitch < -0.55) return tileSlot('floor', here.cx, here.cz, level, dir, offset);
  if (type === 'roof') {
    const cell = pitch > 0.3 ? here : ahead;
    return tileSlot('roof', cell.cx, cell.cz, level, dir, offset);
  }
  return tileSlot(type, ahead.cx, ahead.cz, level + up, dir, offset);
}

export { DIRS };
