/* =====================================================================
   WEAPONS & HANDS
   Runs whatever is in your hands this frame:
   - a gun: aim (right mouse), shoot (left mouse), reload (R)
   - the pickaxe: swing it (left mouse)
   - a healing item: click to use it, which takes a few seconds
   Also switches slots (keys 1-6, mouse wheel) and drops items (Q).

   Shooting is "hitscan": each bullet is an invisible line (a ray) from
   the middle of the screen. The first thing the line touches is hit.
   ===================================================================== */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SETTINGS } from '../settings.js';
import { weaponStats, shotDamage, itemName } from '../loot/items.js';
import { makeGunModel, makeHealModel, makePickaxeModel } from '../loot/models.js';
import { sound } from '../audio/sound.js';

const SLOT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
const UP = new THREE.Vector3(0, 1, 0);

export class Weapons {
  constructor({ physics, player, cam, targets, loot, effects, feedback, building, harvest }) {
    Object.assign(this, { physics, player, cam, targets, loot, effects, feedback, building, harvest });
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    this.heldItem = undefined;  // what the hand model currently shows
    this.handModel = null;
    this.muzzle = null;
    this.cooldown = 0;          // time until the gun can fire again
    this.reload = null;         // { time, total } while reloading
    this.use = null;            // { time, total, item } while using a healing item
    this.swing = 0;             // pickaxe swing time left
    this.swingHit = false;
    this.bloom = 0;             // extra spread from shooting fast
    this.sinceShot = 10;
    this.recoilDebt = 0;        // how much recoil still has to settle back
    this.kick = 0;
    this.spread = 0;            // current spread in degrees (for the crosshair)
    this.toast = null;          // a short message, e.g. "Health is full"
    this.aiming = false;
    // Scratch vectors (reused every frame instead of making new ones)
    this.v = { dir: new THREE.Vector3(), origin: new THREE.Vector3(), shot: new THREE.Vector3(), end: new THREE.Vector3(),
      muzzle: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), head: new THREE.Vector3() };
  }

  say(text) { this.toast = { text, time: 1.6 }; }

  cancelActions() {
    this.reload = null;
    this.use = null;
  }

  // Swap the model in the character's hand when the selected item changes.
  updateHandModel() {
    const item = this.player.inventory.current;
    if (item === this.heldItem) return;
    this.heldItem = item;
    const hand = this.player.model.hand;
    if (this.handModel) hand.remove(this.handModel);
    this.muzzle = null;
    if (!item) {
      this.handModel = makePickaxeModel();
      this.handModel.rotation.x = 0.4;
    } else if (item.kind === 'weapon') {
      const gun = makeGunModel(item.type, item.rarity);
      this.handModel = gun.group;
      this.muzzle = gun.muzzle;
      this.handModel.rotation.x = Math.PI / 2; // point the gun down the arm
    } else {
      this.handModel = makeHealModel(item.type);
      this.handModel.rotation.x = Math.PI / 2;
      this.handModel.scale.setScalar(1.8); // big enough to see what you're holding
    }
    hand.add(this.handModel);
  }

  update(dt, input, camera) {
    const { player, cam } = this;
    const inv = player.inventory;
    if (this.toast && (this.toast.time -= dt) <= 0) this.toast = null;

    // ---------- Build mode: hands are busy building, no weapons ----------
    if (this.building.active) {
      this.cancelActions();
      if (this.handModel) this.handModel.visible = false;
      cam.aiming = cam.scoped = this.aiming = false;
      player.model.root.visible = true;
      this.spread = 0;
      Object.assign(player, { slowdown: 1, canSprint: true, pose: 'none', pitch: cam.pitch, action: 0 });
      if (this.building.reason === 'materials' && input.clicked.has(0)) {
        this.say(`Not enough ${SETTINGS.building.materials[this.building.material].name.toLowerCase()}: hit trees, rocks and cars with the pickaxe`);
      }
      return;
    }
    if (this.handModel) this.handModel.visible = true;

    // ---------- Switching slots ----------
    const before = inv.selected;
    SLOT_KEYS.forEach((key, i) => { if (input.pressed.has(key)) inv.select(i); });
    if (input.wheel) inv.cycle(Math.sign(input.wheel));
    if (inv.selected !== before) { this.cancelActions(); this.cooldown = Math.max(this.cooldown, 0.25); sound.equip(); }

    // ---------- Dropping (Q) ----------
    if (input.pressed.has('KeyQ') && inv.current) {
      this.cancelActions();
      const item = inv.removeCurrent();
      this.loot.drop(item, player.feet.setY(player.feet.y + 0.6), cam.yaw + Math.PI, 1.6);
      this.say(`Dropped ${itemName(item)}`);
    }
    this.updateHandModel();

    const item = inv.current;
    const isGun = item?.kind === 'weapon';
    const isHeal = item?.kind === 'heal';
    this.cooldown -= dt;
    this.sinceShot += dt;
    this.kick = Math.max(0, this.kick - dt * 8);

    // Recoil settles back down a little at a time
    const settle = this.recoilDebt * Math.min(1, SETTINGS.recoilRecover * dt);
    cam.pitch -= settle;
    this.recoilDebt -= settle;
    if (this.sinceShot > 0.2) this.bloom = Math.max(0, this.bloom - SETTINGS.spreadRecover * dt);

    // ---------- Aiming ----------
    this.aiming = isGun && input.buttons.has(2) && !this.use;
    cam.aiming = this.aiming;
    cam.scoped = this.aiming && item.type === 'sniper';
    player.model.root.visible = !(cam.scoped && cam.aim > 0.8); // hide yourself while looking through the scope

    if (isGun) this.updateGun(dt, input, camera, item);
    else if (isHeal) this.updateHeal(dt, input, item);
    else this.updatePickaxe(dt, input, camera);

    // Tell the player how to move and hold the arms
    player.slowdown = this.aiming ? SETTINGS.player.aimSpeed : this.use ? 0.7 : 1;
    player.canSprint = !this.aiming && !this.use && this.sinceShot > 0.4;
    player.pose = isGun ? 'gun' : isHeal ? (this.use ? 'drink' : 'item') : 'pick';
    player.pitch = cam.pitch;
    player.action = isGun ? this.kick
      : this.use ? this.use.time / this.use.total
      : this.swing > 0 ? 1 - this.swing / SETTINGS.pickaxe.swingTime : 0;
  }

  // ---------- Guns ----------
  updateGun(dt, input, camera, item) {
    const stats = weaponStats(item);
    const pouch = this.player.inventory.ammo;

    if (this.reload) {
      this.reload.time += dt;
      if (this.reload.time >= this.reload.total) {
        const take = Math.min(stats.mag - item.mag, pouch[stats.ammo]);
        item.mag += take;
        pouch[stats.ammo] -= take;
        this.reload = null;
        sound.reloaded();
      }
    }
    const startReload = () => {
      if (this.reload || item.mag >= stats.mag) return;
      if (pouch[stats.ammo] <= 0) { this.say(`No ${SETTINGS.ammo[stats.ammo].name}`); return; }
      this.reload = { time: 0, total: stats.reload };
      sound.reload();
    };
    if (input.pressed.has('KeyR')) startReload();

    // Spread: wider when moving or jumping, tighter when crouching or aiming
    const P = this.player;
    const moving = Math.hypot(P.velocity.x, P.velocity.z) > 1;
    let spread = (this.aiming ? stats.aimSpread : stats.spread) * (1 + this.bloom);
    if (moving) spread *= 1.35;
    if (!P.grounded && !P.swimming) spread *= 1.8;
    if (P.crouch > 0.5) spread *= 0.75;
    this.spread = spread;

    const wantsFire = stats.auto ? input.buttons.has(0) || input.clicked.has(0) : input.clicked.has(0);
    if (!wantsFire || this.cooldown > 0) return;
    if (this.reload) return; // wait for the reload to finish
    if (item.mag <= 0) {
      if (pouch[stats.ammo] > 0) startReload();
      else if (input.clicked.has(0)) { sound.empty(); this.say(`No ${SETTINGS.ammo[stats.ammo].name}`); }
      return;
    }
    this.fire(item, stats, spread, camera);
    this.cooldown = 1 / stats.fireRate;
    if (item.mag <= 0 && pouch[stats.ammo] > 0) {
      // Auto-reload right after the last bullet (after a tiny pause)
      this.cooldown = Math.max(this.cooldown, 0.2);
      this.reload = { time: -0.2, total: stats.reload };
      sound.reload();
    }
  }

  fire(item, stats, spread, camera) {
    const { dir, origin, shot, end, muzzle, head } = this.v;
    camera.getWorldDirection(dir);
    // Start the bullet level with the player, so nothing between the camera and the player gets hit.
    head.copy(this.player.position).setY(this.player.position.y + 0.5);
    origin.copy(camera.position).addScaledVector(dir, Math.max(0, head.sub(camera.position).dot(dir)));

    this.player.model.root.updateMatrixWorld(true);
    if (this.muzzle) this.muzzle.getWorldPosition(muzzle); else muzzle.copy(origin);

    const hits = new Map(); // target -> { damage, head, point }
    const builds = new Map(); // build piece -> { damage, point }
    for (let p = 0; p < stats.pellets; p++) {
      this.spreadDirection(dir, spread, shot);
      this.ray.origin = origin;
      this.ray.dir = shot;
      const hit = this.physics.castRay(this.ray, stats.range, true, undefined, undefined, this.player.collider);
      end.copy(origin).addScaledVector(shot, hit ? hit.timeOfImpact : stats.range);
      if (p < 6) this.effects.tracer(muzzle, end, stats.pellets > 1 ? 0.015 : 0.025);
      if (!hit) continue;
      const found = this.targets.lookup(hit.collider);
      if (found && found.target.down <= 0) {
        const entry = hits.get(found.target) || { damage: 0, head: false, point: end.clone() };
        entry.damage += shotDamage(stats, hit.timeOfImpact, found.head);
        entry.head ||= found.head;
        hits.set(found.target, entry);
        this.effects.impact(end, '#ff7a3a', 4);
        continue;
      }
      const piece = this.building.lookup(hit.collider);
      if (piece) {
        const entry = builds.get(piece) || { damage: 0, point: end.clone() };
        entry.damage += shotDamage(stats, hit.timeOfImpact, false);
        builds.set(piece, entry);
      }
      this.effects.impact(end, '#ffd27a', 5);
    }

    for (const [target, h] of hits) this.applyHit(target, h.damage, h.head, h.point);
    for (const [piece, h] of builds) this.hitPiece(piece, h.damage, h.point);

    item.mag -= 1;
    this.bloom = Math.min(2, this.bloom + SETTINGS.spreadGrow);
    this.sinceShot = 0;
    this.kick = 1;
    const recoil = stats.recoil * (this.aiming ? 0.7 : 1) * (this.player.crouch > 0.5 ? 0.8 : 1);
    this.cam.kick(recoil);
    this.recoilDebt += recoil * 0.7; // most (not all) of the kick settles back by itself
    this.effects.muzzleFlash(muzzle);
    sound.shot(item.type);
  }

  applyHit(target, damage, head, point) {
    const result = this.targets.damage(target, damage);
    const total = result.shield + result.health;
    if (total <= 0) return;
    this.feedback.number(point, total, head ? 'head' : result.health > 0 ? 'health' : 'shield');
    this.feedback.hitMarker(head, result.killed);
    if (result.killed) { sound.knockdown(); this.effects.impact(point, '#ff8a2a', 18); }
    else if (head) sound.headshot();
    else if (result.health > 0) sound.hit();
    else sound.shieldHit();
  }

  // Damage a build piece (yours or, later, a bot's).
  hitPiece(piece, damage, point) {
    const { dealt } = this.building.damage(piece, damage);
    if (dealt > 0) this.feedback.number(point, dealt, 'build');
  }

  // A random direction inside a cone around "dir" (degrees = how wide the cone is).
  spreadDirection(dir, degrees, out) {
    out.copy(dir);
    if (degrees <= 0) return out;
    const { right, up } = this.v;
    right.crossVectors(dir, UP).normalize();
    up.crossVectors(right, dir);
    const r = Math.tan(THREE.MathUtils.degToRad(degrees)) * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    return out.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
  }

  // ---------- Pickaxe ----------
  updatePickaxe(dt, input, camera) {
    const PX = SETTINGS.pickaxe;
    this.spread = 0;
    if (this.swing > 0) {
      this.swing -= dt;
      // The pickaxe connects halfway through the swing
      if (!this.swingHit && this.swing < PX.swingTime / 2) {
        this.swingHit = true;
        const { dir, origin, end } = this.v;
        camera.getWorldDirection(dir);
        origin.copy(this.player.position).setY(this.player.position.y + 0.5);
        this.ray.origin = origin;
        this.ray.dir = dir;
        const hit = this.physics.castRay(this.ray, PX.range, true, undefined, undefined, this.player.collider);
        if (hit) {
          end.copy(origin).addScaledVector(dir, hit.timeOfImpact);
          const found = this.targets.lookup(hit.collider);
          const piece = this.building.lookup(hit.collider);
          const resource = this.harvest.lookup(hit.collider);
          if (found && found.target.down <= 0) this.applyHit(found.target, PX.damage, false, end.clone());
          else if (piece) { this.hitPiece(piece, PX.buildDamage, end.clone()); sound.hit(); }
          else if (resource) {
            // Harvest: materials go straight into your pockets
            const got = this.harvest.hit(resource, this.player.materials);
            const color = SETTINGS.building.materials[got.material].color;
            this.effects.impact(end, color, got.broke ? 20 : 8);
            if (got.gained > 0) this.feedback.number(end.clone(), got.gained, got.material);
            else this.say(`You can't carry more ${got.material}`);
            sound.harvest(got.material);
          } else { this.effects.impact(end, '#c9b48a', 6); sound.hit(); }
        }
      }
    }
    if (this.swing <= 0 && (input.buttons.has(0) || input.clicked.has(0)) && this.cooldown <= 0) {
      this.swing = PX.swingTime;
      this.swingHit = false;
      sound.swing();
    }
  }

  // ---------- Healing items ----------
  updateHeal(dt, input, item) {
    const H = SETTINGS.heals[item.type];
    const P = this.player;
    this.spread = 0;
    if (this.use) {
      this.use.time += dt;
      if (this.use.time >= this.use.total) {
        if (H.health) P.health = Math.min(H.upTo, SETTINGS.player.maxHealth, P.health + H.health);
        if (H.shield) P.shield = Math.min(H.upTo, SETTINGS.player.maxShield, P.shield + H.shield);
        P.inventory.consumeCurrent();
        this.use = null;
        this.cooldown = SETTINGS.healChainDelay; // short pause, then the next one if you keep holding
        sound.healDone();
        this.say(H.shield ? `+${H.shield} shield` : H.health >= 100 ? 'Health fully restored' : `+${H.health} health`);
      }
      return;
    }
    // Click to use one; keep holding to use the next one straight after
    const wants = input.clicked.has(0) || (input.buttons.has(0) && this.cooldown <= 0);
    if (!wants) return;
    // Don't waste an item that wouldn't help
    if (H.health && P.health >= Math.min(H.upTo, SETTINGS.player.maxHealth)) {
      if (input.clicked.has(0)) this.say(H.upTo < 100 ? `${H.name} only heal up to ${H.upTo} health. Use a Med Kit for more.` : 'Health is already full');
      return;
    }
    if (H.shield && P.shield >= H.upTo) {
      if (input.clicked.has(0)) this.say(H.upTo < 100 ? `Mini Shields only fill up to ${H.upTo}. Use a Shield Potion for more.` : 'Shield is already full');
      return;
    }
    this.use = { time: 0, total: H.useTime, name: `Using ${H.name}` };
  }

  // Numbers for the HUD
  hudInfo() {
    const item = this.player.inventory.current;
    const info = { toast: this.toast?.text, spread: this.spread, scoped: this.cam.scoped && this.cam.aim > 0.85 };
    if (item?.kind === 'weapon') {
      const stats = SETTINGS.weapons[item.type];
      info.ammo = { mag: item.mag, reserve: this.player.inventory.ammo[stats.ammo] };
    }
    if (this.reload) info.progress = { label: 'Reloading', value: Math.max(0, this.reload.time) / this.reload.total, left: this.reload.total - this.reload.time };
    if (this.use) info.progress = { label: this.use.name, value: this.use.time / this.use.total, left: this.use.total - this.use.time };
    return info;
  }
}
