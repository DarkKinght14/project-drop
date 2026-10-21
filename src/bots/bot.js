/* =====================================================================
   BOT
   One computer-controlled player. It has a body that collides like
   yours, a weapon, healing items and wood for building.

   Its "brain" is a set of states it switches between (re-thinking a few
   times a second, see think()):
     loot    - go to a better weapon or an unopened chest
     roam    - wander to a random spot
     listen  - go and look where a gunshot was heard
     fight   - an enemy is in sight: strafe, jump, shoot
     chase   - lost sight of an enemy: go to where it was last seen
     heal    - hurt and safe: use a healing item
   When shot, it may throw up a wall; if its enemy is up high, it builds
   stairs to reach them. Its aim wobbles like a human's and gets steadier
   the longer it keeps you in sight.
   ===================================================================== */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SETTINGS } from '../settings.js';
import { createCharacter } from '../player/character.js';
import { makeGunModel, makeHealModel } from '../loot/models.js';
import { weaponStats, shotDamage, makeWeapon, makeHeal, rollRarity } from '../loot/items.js';
import { sound, soundAt } from '../audio/sound.js';

const P = SETTINGS.player;
const BS = SETTINGS.bots;
const HALF = P.height / 2;
const UP = new THREE.Vector3(0, 1, 0);
const yawTo = (dx, dz) => Math.atan2(-dx, -dz); // the yaw that looks along (dx, dz)

// Random original outfits for the bots
const JACKETS = ['#3a7bd5', '#d5463a', '#7a4fd0', '#2fa37a', '#e0b52e', '#e05a9a', '#5a6270', '#f0f0f0', '#2f3b52'];
const PANTS = ['#2b3550', '#4a3b2a', '#3d4a2b', '#222222', '#5a5f6b'];
const HATS = ['#e0b52e', '#d5463a', '#1f1f1f', '#18c2b4', '#f4f4f4', '#7a4fd0', '#ff8a2a'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

export class Bot {
  constructor(manager, name, spawn, rng) {
    this.manager = manager;
    const { physics, scene } = manager;
    this.name = name;
    this.isBot = true;
    this.diff = manager.diff;
    this.rng = rng;

    // Body and movement (the same kind of controller the player uses)
    this.position = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    this.body = physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z));
    this.collider = physics.createCollider(RAPIER.ColliderDesc.capsule(HALF - P.radius, P.radius), this.body);
    this.controller = physics.createCharacterController(0.02);
    this.controller.enableAutostep(0.45, 0.2, true);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.velocity = new THREE.Vector3();
    this.grounded = false;
    this.crouch = 0;

    this.model = createCharacter({
      skin: pick(rng, SKINS), jacket: pick(rng, JACKETS), pants: pick(rng, PANTS), shoes: '#e8e8e8',
      beanie: pick(rng, HATS), backpack: pick(rng, PANTS),
    });
    scene.add(this.model.root);
    this.facing = rng() * Math.PI * 2;
    this.yaw = this.facing - Math.PI;
    this.pitch = 0;

    // Health and gear
    this.health = P.maxHealth;
    this.shield = rng() < 0.5 ? 0 : 25 + Math.floor(rng() * 3) * 25;
    this.materials = { wood: this.diff.mats, stone: 0, metal: 0 };
    const maxRarity = this.diff === BS.difficulty.easy ? 1 : this.diff === BS.difficulty.hard ? 3 : 2;
    const types = Object.keys(SETTINGS.weapons);
    this.setWeapon(makeWeapon(pick(rng, types), Math.min(maxRarity, rollRarity(rng))));
    this.heals = rng() < 0.6 ? [makeHeal(pick(rng, ['bandage', 'smallShield', 'medkit', 'bigShield']))] : [];

    // Brain
    this.state = 'roam';
    this.path = null;
    this.goal = null;
    this.thinkTimer = rng() * BS.thinkInterval; // spread the thinking out over different frames
    this.target = null;            // who we're fighting
    this.lastSeen = null;          // { pos, time } where the target was last in sight
    this.visible = false;          // can we see the target right now?
    this.reaction = 0;             // time left before we start shooting
    this.aimTrack = 0;             // 0 = just spotted, 1 = steady aim
    this.strafe = rng() < 0.5 ? 1 : -1;
    this.strafeTimer = 0;
    this.cooldown = 0;
    this.reload = 0;
    this.using = null;             // healing item being used
    this.buildCooldown = 0;
    this.lastAttacker = null;
    this.lastHitTime = -10;
    this.heard = null;             // { pos, time } of a gunshot we heard
    this.lootGoal = null;
    this.stuck = { time: 0, from: this.position.clone(), count: 0 };
    this.breakTarget = null;       // a build piece in our way that we're shooting down
    this.jumpTimer = 1 + rng() * 3;
    this.alive = true;
    this.down = 0;                 // (shared with practice dummies: > 0 means "can't be hit")
    this.deathTimer = 0;
  }

  get feet() { return new THREE.Vector3(this.position.x, this.position.y - HALF, this.position.z); }
  get eye() { return new THREE.Vector3(this.position.x, this.position.y - HALF + 1.5 - this.crouch * 0.3, this.position.z); }

  setWeapon(item) {
    this.weapon = item;
    this.stats = weaponStats(item);
    const hand = this.model.hand;
    if (this.handModel) hand.remove(this.handModel);
    const gun = makeGunModel(item.type, item.rarity);
    this.handModel = gun.group;
    this.muzzle = gun.muzzle;
    this.handModel.rotation.x = Math.PI / 2;
    hand.add(this.handModel);
  }

  // ---------- Thinking (a few times a second) ----------
  think(now) {
    const m = this.manager;
    // 1. Look around for enemies
    let best = null, bestScore = Infinity;
    const feet = this.feet;
    const candidates = m.characters()
      .filter((c) => c !== this && c.alive)
      .map((c) => ({ c, d: c.feet.distanceTo(feet) }))
      .filter((e) => e.d < BS.viewRange)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    for (const { c, d } of candidates) {
      if (!this.canSee(c, d, now)) continue;
      const score = d - (c === this.lastAttacker && now - this.lastHitTime < 4 ? 25 : 0);
      if (score < bestScore) { bestScore = score; best = c; }
    }
    this.visible = !!best;
    if (best) {
      if (best !== this.target) { this.reaction = this.diff.reaction * (0.8 + this.rng() * 0.5); this.aimTrack = 0; }
      this.target = best;
      this.lastSeen = { pos: best.feet, time: now };
    } else if (this.target && (!this.target.alive || now - this.lastSeen.time > 7)) {
      this.target = null;
    }

    // 2. Pick what to do
    const hurt = this.health + this.shield < this.diff.healAt + 25;
    const safe = !this.target || now - this.lastSeen.time > 3;
    const prev = this.state;
    if (this.using) this.state = 'heal';
    else if (hurt && safe && this.heals.some((h) => this.healHelps(h))) this.state = 'heal';
    else if (this.target && this.visible) this.state = 'fight';
    else if (this.target) this.state = 'chase';
    else if ((this.lootGoal = m.findLoot(this))) this.state = 'loot';
    else if (this.heard && now - this.heard.time < 10) this.state = 'listen';
    else this.state = 'roam';

    // 3. Plan a route when the destination changed
    if (this.state === 'chase') this.travelTo(this.lastSeen.pos, prev !== 'chase');
    else if (this.state === 'loot') this.travelTo(this.lootGoal.pos, prev !== 'loot' || this.lootGoal.changed);
    else if (this.state === 'listen') this.travelTo(this.heard.pos, prev !== 'listen');
    else if (this.state === 'roam' && (!this.path || this.path.length === 0 || prev !== 'roam')) {
      const spot = m.nav.randomSpot(this.rng, feet, 70);
      if (spot) this.travelTo(spot, true);
    }
  }

  // Can we see this character? (in range, in front of us, and nothing in between)
  canSee(c, distance, now) {
    const toX = c.position.x - this.position.x, toZ = c.position.z - this.position.z;
    const recentlyShotBy = c === this.lastAttacker && now - this.lastHitTime < 3;
    if (distance > BS.noticeRange && !recentlyShotBy) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const cos = (toX * fx + toZ * fz) / (Math.hypot(toX, toZ) || 1);
      if (cos < Math.cos(((BS.fieldOfView / 2) * Math.PI) / 180)) return false;
    }
    const eye = this.eye;
    const aim = c.feet.add(new THREE.Vector3(0, 1.2, 0));
    const dir = aim.clone().sub(eye);
    const len = dir.length();
    dir.divideScalar(len);
    const hit = this.manager.ray(eye, dir, len + 0.5, this.collider);
    return !!hit && hit.collider.handle === c.collider.handle;
  }

  travelTo(goal, force) {
    if (!force && this.goal && Math.hypot(this.goal.x - goal.x, this.goal.z - goal.z) < 3) return;
    this.goal = { x: goal.x, z: goal.z };
    this.manager.requestPath(this);
  }

  healHelps(h) {
    const H = SETTINGS.heals[h.type];
    return H.health ? this.health < Math.min(H.upTo, P.maxHealth) - 5 : this.shield < H.upTo - 5;
  }

  // ---------- Every frame ----------
  update(dt, now) {
    if (!this.alive) return this.updateDead(dt);
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) { this.thinkTimer = BS.thinkInterval; this.think(now); }
    this.cooldown -= dt;
    this.buildCooldown -= dt;
    this.reaction -= dt;
    this.strafeTimer -= dt;
    this.jumpTimer -= dt;

    let moveX = 0, moveZ = 0, speed = BS.walkSpeed, jump = false, wantCrouch = false;
    let faceYaw = null, pitch = 0;

    if (this.state === 'fight' && this.target) {
      const t = this.target;
      const dx = t.position.x - this.position.x, dz = t.position.z - this.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      const dy = t.feet.y - this.feet.y;
      faceYaw = yawTo(dx, dz);
      pitch = Math.atan2(dy + 0.2, dist);
      const [near, ideal, far] = BS.ranges[this.weapon.type];
      const ux = dx / dist, uz = dz / dist;
      if (dy > 2.5 && dist < 20 && this.materials.wood >= 10) {
        // Enemy is up high: build stairs toward them and climb
        if (this.buildCooldown <= 0 && this.manager.building.tryBuild('ramp', this, faceYaw, 'wood')) this.buildCooldown = 0.7;
        moveX = ux; moveZ = uz;
      } else if (dist > far) {
        moveX = ux; moveZ = uz; speed = BS.sprintSpeed;
      } else {
        // Strafe sideways (switching direction now and then), drifting toward the ideal distance
        if (this.strafeTimer <= 0) { this.strafe = this.rng() < 0.5 ? 1 : -1; this.strafeTimer = 0.7 + this.rng() * 1.6; }
        const inOut = dist > ideal * 1.2 ? 0.6 : dist < Math.max(near, ideal * 0.6) ? -0.6 : 0;
        moveX = -uz * this.strafe + ux * inOut;
        moveZ = ux * this.strafe + uz * inOut;
        if (this.jumpTimer <= 0) { jump = this.rng() < (this.diff === BS.difficulty.hard ? 0.5 : 0.25); this.jumpTimer = 1.5 + this.rng() * 2.5; }
        wantCrouch = this.weapon.type === 'sniper' && dist > 30;
      }
      if (dist <= far * 1.25) this.shoot(dt, now); // only shoot when the weapon can actually reach
    } else if (this.state === 'heal') {
      this.updateHeal(dt);
    } else if (this.state === 'loot' && this.lootGoal) {
      const d = Math.hypot(this.lootGoal.pos.x - this.position.x, this.lootGoal.pos.z - this.position.z);
      if (d < 1.8) this.manager.takeLoot(this, this.lootGoal, dt);
      else [moveX, moveZ] = this.followPath();
      speed = BS.sprintSpeed;
    } else {
      [moveX, moveZ] = this.followPath();
      speed = this.state === 'roam' ? BS.walkSpeed : BS.sprintSpeed;
      if (this.state === 'chase' && this.lastSeen) pitch = 0;
    }

    // A build piece in the way? Shoot it down.
    if (this.breakTarget) {
      if (!this.manager.building.slots.has(this.breakTarget.key) || this.breakTarget.hp <= 0) this.breakTarget = null;
      else {
        faceYaw = yawTo(this.breakTarget.x - this.position.x, this.breakTarget.z - this.position.z);
        this.shootAt(this.breakTarget.center, dt, 0);
        moveX = moveZ = 0;
      }
    }

    const len = Math.hypot(moveX, moveZ);
    if (len > 0) { moveX /= len; moveZ /= len; }
    if (faceYaw === null && len > 0) faceYaw = yawTo(moveX, moveZ);
    if (faceYaw !== null) {
      const turn = Math.atan2(Math.sin(faceYaw - this.yaw), Math.cos(faceYaw - this.yaw));
      this.yaw += turn * Math.min(1, dt * 10);
    }
    this.pitch += (pitch - this.pitch) * Math.min(1, dt * 8);
    this.crouch += ((wantCrouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 10);
    if (this.using) speed *= 0.4;
    this.move(dt, moveX * speed, moveZ * speed, jump);
    this.checkStuck(dt, len > 0);
  }

  // Walk along the planned path; returns the direction to walk in.
  followPath() {
    if (!this.path || this.path.length === 0) return [0, 0];
    let next = this.path[0];
    if (Math.hypot(next.x - this.position.x, next.z - this.position.z) < 0.9) {
      this.path.shift();
      if (this.path.length === 0) return [0, 0];
      next = this.path[0];
    }
    return [next.x - this.position.x, next.z - this.position.z];
  }

  move(dt, vx, vz, jump) {
    const grip = 1 - Math.exp(-(this.grounded ? 12 : 3) * dt);
    this.velocity.x += (vx - this.velocity.x) * grip;
    this.velocity.z += (vz - this.velocity.z) * grip;
    const swimLine = SETTINGS.world.waterLevel - 1.3;
    const feetY = this.position.y - HALF;
    if (feetY < swimLine + 0.05) this.velocity.y = THREE.MathUtils.clamp((swimLine - feetY) * 4, -3, 3);
    else if (this.grounded && jump) this.velocity.y = P.jumpSpeed;
    else this.velocity.y -= P.gravity * dt;

    const wanted = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    this.controller.computeColliderMovement(this.collider, wanted);
    const moved = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.velocity.y < 0) this.velocity.y = -1;
    if (this.velocity.y > 0 && moved.y < wanted.y * 0.5) this.velocity.y = 0;
    this.position.set(this.position.x + moved.x, this.position.y + moved.y, this.position.z + moved.z);
    const ground = this.manager.world.heightAt(this.position.x, this.position.z);
    if (this.position.y - HALF < ground - 2) this.position.y = ground + HALF + 0.1;
    this.body.setNextKinematicTranslation(this.position);
  }

  // Not getting anywhere? Jump; then look for a build piece to shoot through; then find a new route.
  checkStuck(dt, trying) {
    const s = this.stuck;
    s.time += dt;
    if (s.time < 1.2) return;
    const moved = Math.hypot(this.position.x - s.from.x, this.position.z - s.from.z);
    s.time = 0;
    s.from.copy(this.position);
    if (!trying || moved > 0.7 || this.state === 'fight') { s.count = 0; return; }
    s.count++;
    if (this.grounded) this.velocity.y = P.jumpSpeed;
    if (s.count >= 2) {
      const piece = this.manager.pieceAhead(this);
      if (piece) this.breakTarget = piece;
      else { this.path = null; this.goal = null; this.thinkTimer = 0; if (this.state === 'roam') this.state = 'idle'; }
    }
  }

  // ---------- Shooting ----------
  shoot(dt, now) {
    const t = this.target;
    if (this.visible) this.aimTrack = Math.min(1, this.aimTrack + dt / 1.5);
    if (this.reaction > 0 || !this.visible) return;
    const head = this.rng() < this.diff.headshot;
    const aim = t.feet.add(new THREE.Vector3(0, head ? 1.62 - t.crouch * 0.3 : 1.1 - t.crouch * 0.2, 0));
    const tv = t.velocity ? Math.hypot(t.velocity.x, t.velocity.z) : 0;
    const error = this.diff.aimError * (1 + 1.3 * (1 - this.aimTrack)) * (1 + tv / 12);
    this.shootAt(aim, dt, error);
  }

  // Fire at a point with this much aim error (degrees). Handles reloading too.
  shootAt(point, dt, error) {
    const w = this.weapon, stats = this.stats;
    if (this.reload > 0) {
      this.reload -= dt;
      if (this.reload <= 0) w.mag = stats.mag;
      return;
    }
    if (this.cooldown > 0) return;
    if (w.mag <= 0) { this.reload = stats.reload * 1.1; return; }
    w.mag -= 1;
    this.cooldown = 1 / (stats.fireRate * this.diff.fireRate);

    const eye = this.eye;
    const dir = point.clone().sub(eye).normalize();
    this.model.root.updateMatrixWorld(true);
    const muzzle = this.muzzle.getWorldPosition(new THREE.Vector3());
    const spread = (w.type === 'sniper' ? 0 : stats.spread * 0.35) + error;
    const hits = new Map();
    for (let p = 0; p < stats.pellets; p++) {
      const shot = spreadDirection(dir, spread, this.rng);
      const hit = this.manager.ray(eye, shot, stats.range, this.collider);
      const end = eye.clone().addScaledVector(shot, hit ? hit.timeOfImpact : stats.range);
      if (p < 4) this.manager.effects.tracer(muzzle, end, stats.pellets > 1 ? 0.015 : 0.025);
      if (!hit) continue;
      const entry = hits.get(hit.collider.handle) || { collider: hit.collider, damage: 0, point: end, distance: hit.timeOfImpact };
      entry.damage += shotDamage(stats, hit.timeOfImpact, false) * this.diff.damage;
      hits.set(hit.collider.handle, entry);
    }
    for (const h of hits.values()) this.manager.hitSomething(this, h.collider, h.damage, h.point);
    this.manager.effects.muzzleFlash(muzzle);
    soundAt(eye, () => sound.shot(w.type));
    this.manager.alert(this.feet, this);
  }

  // ---------- Healing ----------
  updateHeal(dt) {
    if (!this.using) {
      const item = this.heals.find((h) => this.healHelps(h));
      if (!item) { this.state = 'roam'; return; }
      this.using = { item, time: 0, total: SETTINGS.heals[item.type].useTime };
    }
    this.using.time += dt;
    if (this.using.time >= this.using.total) {
      const H = SETTINGS.heals[this.using.item.type];
      if (H.health) this.health = Math.min(H.upTo, P.maxHealth, this.health + H.health);
      if (H.shield) this.shield = Math.min(H.upTo, P.maxShield, this.shield + H.shield);
      this.using.item.count -= 1;
      if (this.using.item.count <= 0) this.heals.splice(this.heals.indexOf(this.using.item), 1);
      this.using = null;
      this.thinkTimer = 0;
    }
  }

  // Called when something damages us.
  onHurt(attacker, now) {
    this.using = null;
    this.lastAttacker = attacker;
    this.lastHitTime = now;
    if (attacker && attacker !== this.target && (!this.target || !this.visible)) {
      this.target = attacker;
      this.lastSeen = { pos: attacker.feet, time: now };
      this.reaction = this.diff.reaction;
      this.aimTrack = 0;
      this.thinkTimer = 0;
    }
    // Wall up! (Bots on harder difficulty do it more often.)
    if (attacker && this.buildCooldown <= 0 && this.materials.wood >= 10 && this.rng() < this.diff.buildChance) {
      const yaw = yawTo(attacker.position.x - this.position.x, attacker.position.z - this.position.z);
      if (this.manager.building.tryBuild('wall', this, yaw, 'wood')) this.buildCooldown = this.diff === BS.difficulty.hard ? 1.5 : 3;
    }
  }

  // ---------- Animation ----------
  animate(dt, visible, shadows) {
    const root = this.model.root;
    root.visible = visible;
    if (!visible) return;
    this.model.setShadows(shadows);
    this.facing = this.yaw + Math.PI;
    root.position.copy(this.feet);
    root.rotation.y = this.facing;
    const pose = this.using ? 'drink' : 'gun';
    this.model.animate(dt, Math.hypot(this.velocity.x, this.velocity.z), this.grounded, this.crouch, pose, this.pitch,
      this.using ? this.using.time / this.using.total : 0);
    if (this.handModel) this.handModel.visible = !this.using;
  }

  die() {
    this.alive = false;
    this.down = 1;
    this.deathTimer = 2.5;
    this.manager.physics.removeRigidBody(this.body);
  }

  // Fall over, then vanish in a puff
  updateDead(dt) {
    this.deathTimer -= dt;
    const root = this.model.root;
    root.rotation.x += (-Math.PI / 2 - root.rotation.x) * Math.min(1, dt * 8);
    if (this.deathTimer <= 0 && root.parent) {
      this.manager.effects.impact(this.feet.add(new THREE.Vector3(0, 0.4, 0)), '#ffffff', 20);
      root.parent.remove(root);
    }
  }

  dispose() {
    if (this.alive) this.manager.physics.removeRigidBody(this.body);
    this.manager.physics.removeCharacterController(this.controller);
    if (this.model.root.parent) this.model.root.parent.remove(this.model.root);
  }
}

// A random direction inside a cone around "dir" (degrees = cone width).
const tmpRight = new THREE.Vector3(), tmpUp = new THREE.Vector3();
export function spreadDirection(dir, degrees, rng = Math.random) {
  const out = dir.clone();
  if (degrees <= 0) return out;
  tmpRight.crossVectors(dir, UP).normalize();
  tmpUp.crossVectors(tmpRight, dir);
  const r = Math.tan(THREE.MathUtils.degToRad(degrees)) * Math.sqrt(rng());
  const a = rng() * Math.PI * 2;
  return out.addScaledVector(tmpRight, Math.cos(a) * r).addScaledVector(tmpUp, Math.sin(a) * r).normalize();
}
