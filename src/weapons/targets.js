/* =====================================================================
   PRACTICE TARGETS
   Training dummies to shoot at until the bots arrive (Build 4).
   Each one has a body and a head "hitbox": invisible physics shapes the
   bullets hit. Headshots do extra damage. A knocked-down dummy gets
   back up after a few seconds.
   ===================================================================== */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SETTINGS } from '../settings.js';
import { applyDamage } from '../loot/items.js';
import { mat } from '../loot/models.js';
import { bakeGeometry, bakedMaterial } from '../core/bake.js';

const T = SETTINGS.targets;
const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const ball = new THREE.SphereGeometry(0.5, 14, 10);
const barGeo = new THREE.PlaneGeometry(1, 1);
const barBack = new THREE.MeshBasicMaterial({ color: '#10162a', transparent: true, opacity: 0.7, depthTest: false });

function piece(group, geo, color, size, at) {
  const m = new THREE.Mesh(geo, mat(color));
  m.scale.set(...size);
  m.position.set(...at);
  group.add(m);
  return m;
}

// The dummy's shapes, each baked into one (see core/bake.js): the stand, and the
// body + head on top, which wobbles when hit.
const STAND = bakeGeometry((() => {
  const g = new THREE.Group();
  piece(g, cyl, '#6b4a2b', [0.7, 0.08, 0.7], [0, 0.04, 0]);    // base
  piece(g, cyl, '#8a5a32', [0.09, 0.8, 0.09], [0, 0.45, 0]);   // post
  return g;
})());
const DUMMY = bakeGeometry((() => {
  const g = new THREE.Group();
  piece(g, box, '#ff8a2a', [0.6, 0.62, 0.32], [0, 0.72, 0]);   // body
  piece(g, box, '#f4f4f4', [0.62, 0.12, 0.34], [0, 0.62, 0]);  // stripes
  piece(g, box, '#f4f4f4', [0.62, 0.12, 0.34], [0, 0.86, 0]);
  piece(g, ball, '#f1d6a8', [0.4, 0.4, 0.4], [0, 1.26, 0]);    // head
  piece(g, box, '#c0392b', [0.42, 0.06, 0.06], [0, 1.24, 0.19]); // "eyes" band
  return g;
})());

// Puts dummies along the practice range (chosen in world.js, kept clear of trees),
// plus one outside every house. Returns where to stand and which way to face.
export function placeTargets(targets, world) {
  const { spawn, field, houses, range } = world;
  const { forward: f, right: r } = range;
  // [distance ahead, distance to the side]
  for (const [ahead, side] of [[9, -2.5], [12, 2], [18, -4], [26, 3], [40, 0]]) {
    const x = spawn.x + f.x * ahead + r.x * side, z = spawn.z + f.z * ahead + r.z * side;
    targets.add(x, field.heightAt(x, z), z, range.yaw);
  }
  for (const h of houses.slice(1)) {
    const c = Math.cos(h.rotY), s = Math.sin(h.rotY);
    const lx = 3, lz = 9; // in front of the door, a little to the side
    const x = h.x + lx * c + lz * s, z = h.z - lx * s + lz * c;
    targets.add(x, field.heightAt(x, z), z, h.rotY);
  }
  return { x: spawn.x, y: spawn.y, z: spawn.z, yaw: range.yaw };
}

export class Targets {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.list = [];
    this.byCollider = new Map(); // physics collider handle -> { target, head }
  }

  add(x, y, z, faceYaw = 0) {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    root.rotation.y = faceYaw;
    this.scene.add(root);
    root.add(new THREE.Mesh(STAND, bakedMaterial));
    const tilt = new THREE.Mesh(DUMMY, bakedMaterial);               // the part that wobbles
    tilt.position.y = 0.4;
    root.add(tilt);
    root.traverse((m) => { m.castShadow = true; });

    // A floating health bar (only shown after the dummy is hit)
    const bar = new THREE.Group();
    bar.position.set(0, 2.25, 0);
    const back = new THREE.Mesh(barGeo, barBack);
    back.scale.set(0.9, 0.12, 1);
    const shield = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: SETTINGS.rarity[2].color, depthTest: false }));
    const health = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: '#5fe25f', depthTest: false }));
    for (const m of [back, shield, health]) { m.renderOrder = 10; bar.add(m); }
    bar.visible = false;
    root.add(bar);

    // Hitboxes on one fixed body
    const q = new THREE.Quaternion().setFromEuler(root.rotation);
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    const bodyCol = this.physics.createCollider(RAPIER.ColliderDesc.cuboid(0.32, 0.34, 0.18).setTranslation(0, 1.12, 0), body);
    const headCol = this.physics.createCollider(RAPIER.ColliderDesc.ball(0.22).setTranslation(0, 1.66, 0), body);

    const target = {
      root, tilt, bar, shieldBar: shield, healthBar: health, colliders: [bodyCol, headCol],
      health: T.health, shield: T.shield, wobble: 0, wobbleVel: 0, down: 0, barTimer: 0,
      position: new THREE.Vector3(x, y + 1.2, z),
    };
    this.byCollider.set(bodyCol.handle, { target, head: false });
    this.byCollider.set(headCol.handle, { target, head: true });
    this.list.push(target);
    return target;
  }

  // Look up what a bullet hit. Returns { target, head } or undefined.
  lookup(collider) {
    const found = this.byCollider.get(collider.handle);
    return found && { ...found, manager: this };
  }

  // Returns { shield, health, killed } so the game can show the right numbers.
  damage(target, amount) {
    if (target.down > 0) return { shield: 0, health: 0, killed: false };
    const result = applyDamage(target, amount);
    target.wobbleVel += Math.min(6, 1 + amount / 15);
    target.barTimer = 4;
    result.killed = target.health <= 0;
    if (result.killed) {
      target.down = T.respawnTime;
      for (const c of target.colliders) c.setEnabled(false);
    }
    return result;
  }

  update(dt, camera) {
    for (const t of this.list) {
      t.root.visible = t.position.distanceTo(camera.position) < 150; // far-away dummies aren't drawn
      if (t.down > 0) {
        // Knocked over: fall backwards, wait, then pop back up with full health.
        t.down -= dt;
        t.tilt.rotation.x += (-1.5 - t.tilt.rotation.x) * Math.min(1, dt * 10);
        if (t.down <= 0) {
          t.health = T.health; t.shield = T.shield; t.barTimer = 0;
          for (const c of t.colliders) c.setEnabled(true);
        }
      } else {
        // A springy wobble when hit
        t.wobbleVel += (-t.wobble * 60 - t.wobbleVel * 6) * dt;
        t.wobble += t.wobbleVel * dt;
        t.tilt.rotation.x += (-t.wobble * 0.25 - t.tilt.rotation.x) * Math.min(1, dt * 20);
      }
      // Health bar: faces the camera, shows shield (blue) and health (green)
      t.barTimer -= dt;
      t.bar.visible = t.barTimer > 0 && t.down <= 0;
      if (t.bar.visible) {
        t.bar.quaternion.copy(t.root.quaternion).invert().multiply(camera.quaternion);
        const hp = t.health / T.health, sh = t.shield / T.shield;
        t.healthBar.scale.set(0.86 * hp, 0.05, 1);
        t.healthBar.position.set(-0.43 * (1 - hp), -0.025, 0.001);
        t.shieldBar.scale.set(0.86 * sh, 0.04, 1);
        t.shieldBar.position.set(-0.43 * (1 - sh), 0.025, 0.001);
      }
    }
  }
}
