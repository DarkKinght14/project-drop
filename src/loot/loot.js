/* =====================================================================
   LOOT ON THE ISLAND
   Floor loot (items lying around with a glowing ring in their rarity
   color) and chests (hold E to open; items pop out). Ammo is picked up
   just by walking over it. Every new match puts fresh loot everywhere.
   ===================================================================== */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SETTINGS } from '../settings.js';
import { makeRandom } from '../core/random.js';
import { makeItemModel, makeChestModel, makeGlow } from './models.js';
import { itemName, rarityColor, rollFloorLoot, rollChestLoot, makeWeapon, makeAmmo, makeHeal } from './items.js';
import { sound, soundAt } from '../audio/sound.js';

const L = SETTINGS.loot;

// A point inside a house (local x/z, before the house is turned) → island position.
function houseToWorld(house, lx, lz) {
  const c = Math.cos(house.rotY), s = Math.sin(house.rotY);
  return { x: house.x + lx * c + lz * s, z: house.z - lx * s + lz * c };
}

export class Loot {
  constructor(scene, physics, world) {
    this.scene = scene;
    this.physics = physics;
    this.world = world;
    this.items = [];   // floor loot: { item, group, model, pos, anim }
    this.chests = [];  // { root, lid, pos, rotY, opened, lidAngle }
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.holdTime = 0;          // how long E has been held on a chest
    this.chestSpots = [];
    this.floorSpots = [];
    this.pickSpots(makeRandom(SETTINGS.world.seed + 1));
    for (const spot of this.chestSpots) this.buildChest(spot);
  }

  // ---------- Where loot goes (the same places every match) ----------
  pickSpots(rng) {
    for (const h of this.world.houses) {
      const c = houseToWorld(h, -3.7, 2.6);
      this.chestSpots.push({ x: c.x, y: h.floorY, z: c.z, rotY: h.rotY + Math.PI / 2 });
      for (const [lx, lz] of [[-0.8, -0.6], [1.6, 1.8]].slice(0, L.floorPerHouse)) {
        const p = houseToWorld(h, lx, lz);
        this.floorSpots.push({ x: p.x, y: h.floorY, z: p.z });
      }
    }
    const { trees, rocks, houses, cars, field } = this.world;
    const clear = (x, z) =>
      houses.every((h) => Math.hypot(x - h.x, z - h.z) > h.radius) &&
      cars.every((c) => Math.hypot(x - c.x, z - c.z) > 3.5) &&
      trees.every((t) => Math.hypot(x - t.x, z - t.z) > 1.6) &&
      rocks.every((r) => Math.hypot(x - r.x, z - r.z) > r.size + 1);
    const outdoor = (count, list, chest) => {
      for (let tries = 0; list.length < count && tries < count * 40; tries++) {
        const x = (rng() * 2 - 1) * field.half * 0.78, z = (rng() * 2 - 1) * field.half * 0.78;
        const y = field.heightAt(x, z);
        if (y < 1.5 || field.steepness(x, z) > 0.35 || !clear(x, z)) continue;
        list.push(chest ? { x, y, z, rotY: rng() * Math.PI * 2 } : { x, y, z });
      }
    };
    const startChests = this.chestSpots.length, startFloor = this.floorSpots.length;
    outdoor(startChests + L.outdoorChests, this.chestSpots, true);
    outdoor(startFloor + L.outdoorFloor, this.floorSpots, false);
  }

  buildChest(spot) {
    const { root, lid, size } = makeChestModel();
    root.position.set(spot.x, spot.y, spot.z);
    root.rotation.y = spot.rotY;
    this.scene.add(root);
    const q = new THREE.Quaternion().setFromEuler(root.rotation);
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(spot.x, spot.y, spot.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    this.physics.createCollider(RAPIER.ColliderDesc.cuboid(size.w / 2, size.h / 2, size.d / 2).setTranslation(0, size.h / 2, 0), body);
    this.chests.push({ root, lid, pos: new THREE.Vector3(spot.x, spot.y, spot.z), rotY: spot.rotY, opened: false, lidAngle: 0 });
  }

  // ---------- A fresh match: close every chest, new floor loot ----------
  reset(starter) {
    for (const e of this.items) this.scene.remove(e.group);
    this.items = [];
    for (const c of this.chests) { c.opened = false; c.lidAngle = 0; c.lid.rotation.x = 0; }
    for (const s of this.floorSpots) {
      rollFloorLoot(Math.random).forEach((item, i) => this.spawn(item, new THREE.Vector3(s.x + i * 0.6, s.y, s.z + i * 0.3)));
    }
    // Starter loot just to your left, so you can try things right away
    // (off to the side, so the glow doesn't get in the way of the shooting lane).
    if (starter) {
      const { x, y, z, yaw } = starter;
      const items = [makeWeapon('ar', 0), makeAmmo('medium', 90), makeWeapon('shotgun', 2), makeAmmo('shells', 15),
        makeWeapon('sniper', 3), makeAmmo('heavy', 12), makeHeal('bandage', 5), makeHeal('smallShield', 3)];
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      items.forEach((item, i) => {
        const side = -2.5 - Math.floor(i / 2) * 1.2, ahead = 1.5 + (i % 2) * 1.2;
        const px = x + fx * ahead + rx * side, pz = z + fz * ahead + rz * side;
        this.spawn(item, new THREE.Vector3(px, this.groundBelow(px, y + 2, pz), pz));
      });
    }
  }

  // The height of whatever is below a point (ground, a house floor...).
  groundBelow(x, y, z) {
    this.ray.origin = { x, y, z };
    const hit = this.physics.castRay(this.ray, 30, true);
    return hit ? y - hit.timeOfImpact : this.world.heightAt(x, z);
  }

  spawn(item, pos, from = null) {
    const group = new THREE.Group();
    const model = makeItemModel(item);
    if (item.kind === 'weapon') model.scale.setScalar(1.35);
    model.traverse((m) => { m.castShadow = false; }); // small things on the floor: skip shadows (faster)
    group.add(model, makeGlow(rarityColor(item)));
    group.position.copy(from || pos);
    this.scene.add(group);
    const entry = { item, group, model, pos: pos.clone(), anim: from ? { from: from.clone(), t: 0 } : null, spin: Math.random() * 6 };
    this.items.push(entry);
    return entry;
  }

  // Drop an item near a point: it flies out in a little arc and lands on the ground.
  drop(item, from, angle = Math.random() * Math.PI * 2, distance = 1.4) {
    const x = from.x + Math.sin(angle) * distance, z = from.z + Math.cos(angle) * distance;
    const y = this.groundBelow(x, from.y + 0.8, z);
    return this.spawn(item, new THREE.Vector3(x, y, z), from.clone().setY(from.y + 0.6));
  }

  remove(entry) {
    this.scene.remove(entry.group);
    this.items.splice(this.items.indexOf(entry), 1);
  }

  openChest(chest) {
    chest.opened = true;
    soundAt(chest.pos, () => sound.chestOpen());
    const items = rollChestLoot(Math.random);
    const top = chest.pos.clone().setY(chest.pos.y + 0.5);
    items.forEach((item, i) => {
      const angle = chest.rotY + (i - (items.length - 1) / 2) * 0.45; // fan out in front of the chest
      this.drop(item, top, angle, 1.2 + (i % 2) * 0.5);
    });
  }

  // ---------- Every frame ----------
  update(dt, time, player) {
    const feet = player.feet;
    for (const c of this.chests) {
      c.root.visible = c.pos.distanceTo(feet) < L.showDistance * 1.5; // far-away chests aren't drawn
      if (c.opened && c.lidAngle > -1.9) { c.lidAngle = Math.max(-1.9, c.lidAngle - dt * 8); c.lid.rotation.x = c.lidAngle; }
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const e = this.items[i];
      if (e.anim) {
        // Flying out of a chest (or your hands): a little hop
        e.anim.t = Math.min(1, e.anim.t + dt / 0.55);
        e.group.position.lerpVectors(e.anim.from, e.pos, e.anim.t);
        e.group.position.y += Math.sin(Math.PI * e.anim.t) * 0.9;
        if (e.anim.t >= 1) e.anim = null;
      }
      const dist = e.group.position.distanceTo(feet);
      e.group.visible = dist < L.showDistance;
      if (!e.group.visible) continue;
      e.model.position.y = 0.32 + Math.sin(time * 2.4 + e.spin) * 0.06;
      e.model.rotation.y = time * 0.9 + e.spin;

      // Walk over ammo to pick it up
      if (e.item.kind === 'ammo' && !e.anim && dist < L.ammoPickupRange) {
        const left = player.inventory.addAmmo(e.item.type, e.item.count);
        if (left < e.item.count) sound.pickup();
        if (left === 0) this.remove(e); else e.item.count = left;
      }
    }
  }

  // ---------- Picking up and opening (the E key) ----------
  // Returns what the HUD should show: { text, color, progress } or null.
  interact(dt, input, player, forward) {
    const feet = player.feet;
    const fx = forward.x, fz = forward.z, fl = Math.hypot(fx, fz) || 1;
    // Score each nearby thing: closer and more in front of you = better
    const score = (pos, range) => {
      const dx = pos.x - feet.x, dz = pos.z - feet.z, d = Math.hypot(dx, dz);
      if (d > range || Math.abs(pos.y - feet.y) > 2) return Infinity;
      const facing = d > 0.01 ? (dx * fx + dz * fz) / (d * fl) : 1;
      return d * (1.6 - facing);
    };
    let best = null, bestScore = Infinity;
    for (const e of this.items) {
      if (e.anim || e.item.kind === 'ammo') continue;
      const s = score(e.group.position, L.pickupRange);
      if (s < bestScore) { bestScore = s; best = { entry: e }; }
    }
    for (const c of this.chests) {
      if (c.opened) continue;
      const s = score(c.pos, L.pickupRange + 0.4);
      if (s < bestScore) { bestScore = s; best = { chest: c }; }
    }

    const holding = input.keys.has('KeyE');
    if (!best) { this.holdTime = 0; return null; }

    if (best.chest) {
      this.holdTime = holding ? this.holdTime + dt : 0;
      if (this.holdTime >= L.chestOpenTime) { this.holdTime = 0; this.openChest(best.chest); return null; }
      return { text: 'Open Chest', color: '#ffcf3f', progress: this.holdTime / L.chestOpenTime, hold: true };
    }

    this.holdTime = 0;
    const { entry } = best;
    const inv = player.inventory;
    const full = !inv.slots.includes(null) && !(entry.item.kind === 'heal' &&
      inv.slots.some((s) => s && s.kind === 'heal' && s.type === entry.item.type && s.count < SETTINGS.heals[s.type].stack));
    if (input.pressed.has('KeyE')) {
      if (!full) {
        const left = inv.add(entry.item);
        if (left) entry.item.count = left.count; else this.remove(entry);
        sound.pickup();
      } else if (inv.selected > 0) {
        const old = inv.swap(entry.item);
        this.remove(entry);
        this.drop(old, feet.clone().setY(feet.y + 0.4));
        sound.pickup();
      }
      return null;
    }
    const label = itemName(entry.item) + (entry.item.count > 1 ? ` ×${entry.item.count}` : '');
    if (full && inv.selected === 0) return { text: `Hotbar full: pick a slot to swap for ${label}`, color: rarityColor(entry.item), key: false };
    return { text: (full ? 'Swap for ' : 'Pick up ') + label, color: rarityColor(entry.item) };
  }
}
