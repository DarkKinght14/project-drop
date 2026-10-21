/* =====================================================================
   BUILDING
   Press Z (wall), X (floor), V (stairs) or F (roof) to go into build
   mode. A see-through blue copy shows where the piece will go (red means
   you can't build there). Click to build; hold the mouse to keep
   building. R switches between wood, stone and metal. Press 1-6 to put
   your weapons back in your hands.

   New pieces start weak and "grow" to full health: wood grows fast but
   is weak, metal is slow but very strong. Bullets and the pickaxe
   damage them, and they break when their health runs out.

   Drawing: every piece of the same type and material is one copy inside
   a single InstancedMesh, so 300 walls cost the same as one to draw.
   ===================================================================== */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SETTINGS } from '../settings.js';
import { PIECES, DIRS, pickSlot, offsetFor, cellOf, tileSlot } from './grid.js';
import { pieceGeometry, pieceColliderShape } from './pieces.js';
import { bakedMaterial } from '../core/bake.js';
import { sound, soundAt } from '../audio/sound.js';

const B = SETTINGS.building;
const MATS = Object.keys(B.materials);
const PIECE_KEYS = { KeyZ: 'wall', KeyX: 'floor', KeyV: 'ramp', KeyF: 'roof' };
const SLOT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
const GROWING = new THREE.Color('#7fb8ff');
const WHITE = new THREE.Color('#ffffff');

export class Building {
  constructor(scene, physics, world, effects) {
    Object.assign(this, { scene, physics, world, effects });
    this.active = false;
    this.piece = 'wall';
    this.material = 'wood';
    this.slots = new Map();      // grid spot key -> piece (one piece per spot)
    this.byCollider = new Map(); // physics collider handle -> piece
    this.cooldown = 0;
    this.target = null;          // where the next piece would go
    this.reason = null;          // why it can't go there (or null)
    this.color = new THREE.Color();

    // One InstancedMesh per piece type and material
    this.meshes = new Map();
    for (const type of PIECES) {
      for (const mat of MATS) {
        const mesh = new THREE.InstancedMesh(pieceGeometry(type, mat), bakedMaterial, B.maxPieces);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // pieces can be anywhere; the bounds would go out of date
        mesh.setColorAt(0, WHITE);  // makes room for per-piece colors
        scene.add(mesh);
        this.meshes.set(type + mat, { mesh, pieces: [] });
      }
    }

    // The see-through preview ("ghost") of each piece type
    this.ghostMat = new THREE.MeshBasicMaterial({ color: '#5ab4ff', transparent: true, opacity: 0.38, depthWrite: false });
    this.ghosts = Object.fromEntries(PIECES.map((type) => {
      const ghost = new THREE.Mesh(pieceGeometry(type, 'wood'), this.ghostMat);
      ghost.visible = false;
      ghost.renderOrder = 5;
      scene.add(ghost);
      return [type, ghost];
    }));
  }

  enter(piece) {
    if (!this.active) sound.equip();
    this.active = true;
    this.piece = piece;
  }

  exit() {
    this.active = false;
    for (const g of Object.values(this.ghosts)) g.visible = false;
  }

  lookup(collider) { return this.byCollider.get(collider.handle); }

  // ---------- Every frame ----------
  update(dt, input, player, cam) {
    this.cooldown -= dt;
    for (const [key, piece] of Object.entries(PIECE_KEYS)) if (input.pressed.has(key)) this.enter(piece);
    if (input.pressed.has('KeyB')) { if (this.active) this.exit(); else this.enter(this.piece); }
    if (this.active && SLOT_KEYS.some((k) => input.pressed.has(k))) this.exit();
    this.growPieces(dt);
    if (!this.active) return;

    if (input.wheel) this.piece = PIECES[(PIECES.indexOf(this.piece) + Math.sign(input.wheel) + PIECES.length) % PIECES.length];
    if (input.pressed.has('KeyR')) { this.material = MATS[(MATS.indexOf(this.material) + 1) % MATS.length]; sound.equip(); }

    // Where would the piece go, and is it allowed?
    const slot = this.slotFor(this.piece, player, cam.yaw, cam.pitch, SETTINGS.camera.shoulder);
    this.target = slot;
    this.reason = this.whyNot(slot, player);
    // (no preview when a piece is already there: it would just cover it)
    for (const [type, g] of Object.entries(this.ghosts)) g.visible = type === slot.type && this.reason !== 'taken';
    const ghost = this.ghosts[slot.type];
    ghost.position.set(slot.x, slot.y, slot.z);
    ghost.rotation.set(0, slot.rotY, 0);
    this.ghostMat.color.set(this.reason ? '#ff5a5a' : '#5ab4ff');

    // Click (or hold) to build
    // (clicked: catches a very quick click that started and ended between two frames)
    if ((input.buttons.has(0) || input.clicked.has(0)) && this.cooldown <= 0 && !this.reason) {
      this.place(slot, this.material, player);
      this.cooldown = B.placeInterval;
    } else if (input.clicked.has(0) && this.reason === 'materials') {
      sound.empty();
    }
  }

  // Where a piece would go for someone (the player or a bot) looking along yaw / pitch.
  slotFor(type, who, yaw, pitch, shoulder = 0) {
    let slot = pickSlot(type, who.feet, yaw, pitch, this.gridOffset(who.feet), shoulder);
    const { cx, cz } = cellOf(slot.x, slot.z);
    // Running up stairs: the next stairs (or floor) in front go one level higher, so they connect
    const stairs = this.stairsUnder(who.feet);
    if (stairs && (slot.type === 'ramp' || slot.type === 'floor')) {
      const s = cellOf(stairs.x, stairs.z);
      const d = DIRS[stairs.dir];
      if (cx === s.cx + d.x && cz === s.cz + d.z) slot = tileSlot(slot.type, cx, cz, stairs.level + 1, slot.dir, stairs.offset);
    }
    // Going uphill, a floor ahead could end up underground: lift it one level instead
    if (slot.type === 'floor' && slot.y + 0.12 < this.world.heightAt(slot.x, slot.z) - 0.2) {
      slot = tileSlot('floor', cx, cz, slot.level + 1, slot.dir, slot.offset);
    }
    return slot;
  }

  // For bots: build a piece facing "yaw" if allowed. Returns true if it was built.
  tryBuild(type, who, yaw, mat) {
    const slot = this.slotFor(type, who, yaw, 0);
    if (this.whyNot(slot, who, mat)) return false;
    this.place(slot, mat, who);
    return true;
  }

  // The stairs you're standing on, if any.
  stairsUnder(feet) {
    const { cx, cz } = cellOf(feet.x, feet.z);
    for (const p of this.slots.values()) {
      if (p.type !== 'ramp') continue;
      const c = cellOf(p.x, p.z);
      if (c.cx === cx && c.cz === cz && feet.y > p.base - 0.3 && feet.y < p.base + B.height + 0.3) return p;
    }
    return null;
  }

  // Line up with the nearest piece you already built; with nothing nearby,
  // start a new building exactly at your feet. (Lining up is skipped when it would
  // put the new piece's bottom far below your feet, e.g. on a downhill slope.)
  gridOffset(feet) {
    let best = null, bestDist = B.tile * 1.6;
    for (const p of this.slots.values()) {
      if (Math.abs(p.base - feet.y) > B.height * 2) continue;
      const d = Math.hypot(p.x - feet.x, p.z - feet.z);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    if (!best) return offsetFor(feet.y);
    const above = offsetFor(feet.y - best.offset); // how far your feet are above that grid's nearest level
    return above < 1.2 || above > B.height - 0.6 ? best.offset : offsetFor(feet.y);
  }

  // Returns null if the piece can be built here, otherwise a short reason.
  whyNot(slot, player, mat = this.material) {
    if (this.slots.has(slot.key)) return 'taken';
    if (player.materials[mat] < B.cost) return 'materials';
    const top = slot.type === 'floor' ? slot.y + 0.12 : slot.type === 'roof' ? slot.y + 1.6 : slot.base + B.height;
    if (top < this.world.heightAt(slot.x, slot.z) - 0.2) return 'buried';
    if (this.overlapsPlayer(slot, player)) return 'blocked';
    return null;
  }

  // Would this piece appear inside the player? (That would get you stuck.)
  overlapsPlayer(slot, player) {
    const T = B.tile, H = B.height, r = SETTINGS.player.radius + 0.05;
    const f = player.feet, headY = f.y + SETTINGS.player.height;
    const inside = (x0, x1, y0, y1, z0, z1) =>
      f.x + r > x0 && f.x - r < x1 && f.z + r > z0 && f.z - r < z1 && headY > y0 && f.y < y1;
    const base = slot.base;
    if (slot.type === 'wall') {
      const along = T / 2, across = 0.14;
      const [hx, hz] = slot.rotY === 0 ? [along, across] : [across, along];
      return inside(slot.x - hx, slot.x + hx, base, base + H, slot.z - hz, slot.z + hz);
    }
    // (a floor right at your feet is fine: you just end up standing on it)
    if (slot.type === 'floor') return inside(slot.x - T / 2, slot.x + T / 2, slot.y - 0.12, slot.y - 0.02, slot.z - T / 2, slot.z + T / 2);
    if (slot.type === 'roof') return inside(slot.x - T / 2, slot.x + T / 2, slot.y, slot.y + 1.6, slot.z - T / 2, slot.z + T / 2);
    // Stairs: only a problem if the slope would cut through your body
    if (!inside(slot.x - T / 2, slot.x + T / 2, base, base + H, slot.z - T / 2, slot.z + T / 2)) return false;
    const dx = -Math.sin(slot.rotY), dz = -Math.cos(slot.rotY); // the way the stairs go up
    const t = THREE.MathUtils.clamp(((f.x - slot.x) * dx + (f.z - slot.z) * dz) / T + 0.5, 0, 1);
    const surface = base + H * t + 0.27;
    return surface > f.y + 0.3 && surface < headY;
  }

  place(slot, mat, player) {
    const M = B.materials[mat];
    player.materials[mat] -= B.cost;
    const entry = this.meshes.get(slot.type + mat);
    if (entry.pieces.length >= B.maxPieces) return;

    // Physics: one fixed body with the piece's shape
    const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), slot.rotY);
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(slot.x, slot.y, slot.z).setRotation({ x: qY.x, y: qY.y, z: qY.z, w: qY.w }),
    );
    const shape = pieceColliderShape(slot.type);
    let desc;
    if (shape.kind === 'box') desc = RAPIER.ColliderDesc.cuboid(...shape.half);
    else if (shape.kind === 'slope') {
      const qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), shape.angle);
      desc = RAPIER.ColliderDesc.cuboid(...shape.half).setRotation({ x: qX.x, y: qX.y, z: qX.z, w: qX.w }).setTranslation(0, 0.15, 0);
    } else desc = RAPIER.ColliderDesc.convexHull(new Float32Array(shape.points));
    const collider = this.physics.createCollider(desc, body);

    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(slot.x, slot.y, slot.z), qY, new THREE.Vector3(1, 1, 1));
    const piece = {
      ...slot, mat, body, collider, matrix, entry, index: entry.pieces.length,
      maxHp: M.hp, hp: M.hp * B.startHealth, grow: 0, color: new THREE.Color(),
      center: new THREE.Vector3(slot.x, slot.type === 'wall' || slot.type === 'ramp' ? slot.y : slot.y + 0.4, slot.z),
    };
    entry.pieces.push(piece);
    entry.mesh.count = entry.pieces.length;
    entry.mesh.setMatrixAt(piece.index, matrix);
    entry.mesh.instanceMatrix.needsUpdate = true;
    this.paint(piece);
    this.slots.set(slot.key, piece);
    this.byCollider.set(collider.handle, piece);
    soundAt(slot, () => sound.build(mat));
  }

  // Color shows the state: blue-ish while building, darker when damaged.
  paint(piece) {
    piece.color.copy(GROWING).lerp(WHITE, piece.grow).multiplyScalar(0.55 + 0.45 * (piece.hp / piece.maxHp));
    piece.entry.mesh.setColorAt(piece.index, piece.color);
    piece.entry.mesh.instanceColor.needsUpdate = true;
  }

  growPieces(dt) {
    for (const piece of this.slots.values()) {
      if (piece.grow >= 1) continue;
      const M = B.materials[piece.mat];
      piece.grow = Math.min(1, piece.grow + dt / M.buildTime);
      piece.hp = Math.min(piece.maxHp, piece.hp + (piece.maxHp * (1 - B.startHealth) * dt) / M.buildTime);
      this.paint(piece);
    }
  }

  // Returns { dealt, destroyed }
  damage(piece, amount) {
    const dealt = Math.min(piece.hp, amount);
    piece.hp -= dealt;
    if (piece.hp <= 0.5) { this.remove(piece); return { dealt, destroyed: true }; }
    this.paint(piece);
    return { dealt, destroyed: false };
  }

  remove(piece, quiet = false) {
    const { entry } = piece;
    const last = entry.pieces.pop();
    if (last !== piece) {
      // Move the last copy into the gap left by this one
      entry.pieces[piece.index] = last;
      last.index = piece.index;
      entry.mesh.setMatrixAt(last.index, last.matrix);
      entry.mesh.setColorAt(last.index, last.color);
    }
    entry.mesh.count = entry.pieces.length;
    entry.mesh.instanceMatrix.needsUpdate = true;
    if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true;
    this.byCollider.delete(piece.collider.handle);
    this.slots.delete(piece.key);
    this.physics.removeRigidBody(piece.body);
    if (!quiet) {
      this.effects.impact(piece.center, B.materials[piece.mat].color, 24);
      soundAt(piece.center, () => sound.breakPiece(piece.mat));
    }
  }

  // A new match: clear everything that was built.
  reset() {
    for (const piece of [...this.slots.values()]) this.remove(piece, true);
    this.exit();
    this.material = 'wood';
  }

  get count() { return this.slots.size; }

  hudInfo() {
    return { active: this.active, piece: this.piece, material: this.material, reason: this.reason };
  }
}
