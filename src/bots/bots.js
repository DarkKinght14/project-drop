/* =====================================================================
   BOTS (the manager)
   Spawns the bots, runs them every frame, and is the "referee" between
   them and everyone else:
   - hands out paths (a couple per frame, so the game never stutters)
   - works out what a bot's bullet hit (you, another bot, a build...)
   - eliminations: drops the bot's loot and reports it to the kill feed
   - tells bots about gunshots they can hear
   Far-away bots aren't drawn and skip their shadows, to save power.
   ===================================================================== */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SETTINGS } from '../settings.js';
import { applyDamage, makeAmmo } from '../loot/items.js';
import { Bot } from './bot.js';
import { NavGrid } from './navgrid.js';

const BS = SETTINGS.bots;

export class Bots {
  constructor({ scene, physics, world, building, loot, effects, player, onElimination }) {
    Object.assign(this, { scene, physics, world, building, loot, effects, player, onElimination });
    this.nav = new NavGrid(world, physics);
    this.list = [];
    this.byCollider = new Map();
    this.pathQueue = [];
    this.time = 0;
    this.diff = BS.difficulty.normal;
    this.playerElims = 0;
    this.rayObj = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  }

  // ---------- Starting and ending a match ----------
  start(count, difficulty, rng, avoid) {
    this.clear();
    this.diff = BS.difficulty[difficulty] || BS.difficulty.normal;
    this.playerElims = 0;
    const names = [...BS.names].sort(() => rng() - 0.5);
    for (let i = 0; i < count; i++) {
      let spot = null;
      for (let tries = 0; tries < 80 && !spot; tries++) {
        const s = this.nav.randomSpot(rng);
        if (!s) continue;
        if (Math.hypot(s.x - avoid.x, s.z - avoid.z) < BS.spawnMinDistance) continue;
        if (this.list.some((b) => Math.hypot(b.position.x - s.x, b.position.z - s.z) < 40)) continue;
        spot = s;
      }
      if (!spot) continue;
      const y = this.world.heightAt(spot.x, spot.z) + SETTINGS.player.height / 2 + 0.3;
      const bot = new Bot(this, names[i % names.length], { x: spot.x, y, z: spot.z }, rng);
      this.list.push(bot);
      this.byCollider.set(bot.collider.handle, bot);
    }
  }

  clear() {
    for (const b of this.list) b.dispose();
    this.list = [];
    this.byCollider.clear();
    this.pathQueue = [];
  }

  get aliveCount() { return this.list.filter((b) => b.alive).length; }

  // Everyone who can fight: you and every bot still standing.
  characters() {
    const all = this.list.filter((b) => b.alive);
    if (this.player.alive) all.push(this.player);
    return all;
  }

  // ---------- Every frame ----------
  update(dt, cameraPos) {
    if (this.frozen) return; // (used by the automated test)
    this.time += dt;
    // A few path searches per frame
    for (let k = 0; k < SETTINGS.nav.pathsPerFrame && this.pathQueue.length; k++) {
      const bot = this.pathQueue.shift();
      bot.queued = false;
      if (!bot.alive || !bot.goal) continue;
      bot.path = this.nav.findPath(bot.position, bot.goal) || [];
    }
    for (const bot of this.list) {
      bot.update(dt, this.time);
      const d = bot.position.distanceTo(cameraPos);
      if (bot.model.root.parent) bot.animate(dt, d < 230, d < 45);
    }
  }

  requestPath(bot) {
    if (bot.queued) return;
    bot.queued = true;
    this.pathQueue.push(bot);
  }

  ray(origin, dir, maxDist, exclude) {
    this.rayObj.origin = origin;
    this.rayObj.dir = dir;
    return this.physics.castRay(this.rayObj, maxDist, true, undefined, undefined, exclude);
  }

  // ---------- Hits ----------
  // For the player's weapons: is this collider a bot? Returns { target, head, manager }.
  lookup(collider, point) {
    const bot = this.byCollider.get(collider.handle);
    if (!bot || !bot.alive) return undefined;
    return { target: bot, head: point.y - bot.feet.y > 1.42 - bot.crouch * 0.3, manager: this };
  }

  isHead(character, point) { return point.y - character.feet.y > 1.42 - (character.crouch || 0) * 0.3; }

  // Damage a bot. attacker: the player or a bot. Returns { shield, health, killed }.
  damage(bot, amount, attacker, weaponName) {
    if (!bot.alive) return { shield: 0, health: 0, killed: false };
    const result = applyDamage(bot, amount);
    bot.onHurt(attacker, this.time);
    result.killed = bot.health <= 0;
    if (result.killed) this.eliminate(bot, attacker, weaponName);
    return result;
  }

  // A bot's bullet hit this collider.
  hitSomething(shooter, collider, damage, point) {
    const weaponName = shooter.stats.name;
    if (collider.handle === this.player.collider.handle) {
      if (!this.player.alive) return;
      if (this.isHead(this.player, point)) damage *= shooter.stats.head;
      this.player.takeDamage(damage, shooter, weaponName);
      return;
    }
    const bot = this.byCollider.get(collider.handle);
    if (bot) {
      if (this.isHead(bot, point)) damage *= shooter.stats.head;
      this.damage(bot, damage, shooter, weaponName);
      return;
    }
    const piece = this.building.lookup(collider);
    if (piece) this.building.damage(piece, damage);
    this.effects.impact(point, '#ffd27a', 4);
  }

  eliminate(bot, killer, weaponName) {
    bot.die();
    this.byCollider.delete(bot.collider.handle);
    if (killer === this.player) this.playerElims++;
    // Drop everything it carried, like a real player would
    const at = bot.feet.setY(bot.feet.y + 0.6);
    const drops = [{ ...bot.weapon, mag: SETTINGS.weapons[bot.weapon.type].mag }, makeAmmo(SETTINGS.weapons[bot.weapon.type].ammo), ...bot.heals];
    drops.forEach((item, i) => this.loot.drop(item, at, (i / drops.length) * Math.PI * 2, 1.3));
    this.onElimination?.({ killer, victim: bot, weapon: weaponName });
  }

  // A gunshot: bots close enough hear it and may come to look.
  alert(pos, source) {
    for (const b of this.list) {
      if (!b.alive || b === source) continue;
      if (Math.hypot(b.position.x - pos.x, b.position.z - pos.z) < BS.hearRange) b.heard = { pos: pos.clone(), time: this.time };
    }
  }

  // A build piece right in front of a bot (blocking its way), if any.
  pieceAhead(bot) {
    const dir = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    for (const h of [0.3, 1.2]) {
      const from = bot.feet.add(new THREE.Vector3(0, h, 0));
      const hit = this.ray(from, dir, 2.5, bot.collider);
      const piece = hit && this.building.lookup(hit.collider);
      if (piece) return piece;
    }
    return null;
  }

  // ---------- Looting ----------
  // The best thing worth walking to: a better weapon, healing, or an unopened chest.
  findLoot(bot) {
    let best = null, bestScore = Infinity;
    const range = BS.lootRange;
    for (const e of this.loot.items) {
      if (e.anim || (e.claim && e.claim !== bot && e.claim.alive)) continue;
      const it = e.item;
      const wanted = (it.kind === 'weapon' && it.rarity > bot.weapon.rarity) || (it.kind === 'heal' && bot.heals.length < 2);
      if (!wanted) continue;
      const d = Math.hypot(e.pos.x - bot.position.x, e.pos.z - bot.position.z);
      if (d > range) continue;
      const score = d - (it.kind === 'weapon' ? (it.rarity - bot.weapon.rarity) * 8 : 0);
      if (score < bestScore) { bestScore = score; best = { pos: e.pos, entry: e }; }
    }
    for (const c of this.loot.chests) {
      if (c.opened || (c.claim && c.claim !== bot && c.claim.alive)) continue;
      const d = Math.hypot(c.pos.x - bot.position.x, c.pos.z - bot.position.z);
      if (d > range) continue;
      if (d - 6 < bestScore) { bestScore = d - 6; best = { pos: c.pos, chest: c }; }
    }
    if (!best) return null;
    const target = best.entry || best.chest;
    target.claim = bot;
    best.changed = !bot.lootGoal || (bot.lootGoal.entry || bot.lootGoal.chest) !== target;
    return best;
  }

  takeLoot(bot, goal, dt) {
    if (goal.chest) {
      bot.chestTime = (bot.chestTime || 0) + dt;
      if (bot.chestTime > SETTINGS.loot.chestOpenTime && !goal.chest.opened) {
        this.loot.openChest(goal.chest);
        bot.chestTime = 0;
        bot.lootGoal = null;
        bot.thinkTimer = 1; // wait a moment for the items to land
      }
      return;
    }
    const e = goal.entry;
    if (this.loot.items.includes(e)) {
      if (e.item.kind === 'weapon') {
        const old = bot.weapon;
        bot.setWeapon(e.item);
        this.loot.remove(e);
        this.loot.drop(old, bot.feet.setY(bot.feet.y + 0.5));
      } else if (e.item.kind === 'heal') {
        bot.heals.push(e.item);
        this.loot.remove(e);
      }
    }
    bot.lootGoal = null;
    bot.thinkTimer = 0;
  }
}
