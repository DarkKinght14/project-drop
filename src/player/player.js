/* =====================================================================
   PLAYER
   Movement uses Rapier's "character controller": we say where we'd LIKE
   to move, and it works out how far we really can go without walking
   through walls, and slides us along them. It also climbs small steps
   and sticks us to slopes so we don't bounce down hills.
   ===================================================================== */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SETTINGS } from '../settings.js';
import { createCharacter } from './character.js';

const P = SETTINGS.player;
const HALF = P.height / 2; // distance from the capsule's center to the feet

export class Player {
  constructor(scene, physics, world) {
    this.physics = physics;
    this.world = world;
    this.velocity = new THREE.Vector3();
    this.grounded = false;
    this.swimming = false;
    this.crouch = 0;          // 0 = standing, 1 = fully crouched (animated in between)
    this.facing = 0;          // which way the model faces (radians)
    this.health = P.maxHealth;
    this.shield = 0;
    this.materials = { wood: 0, stone: 0, metal: 0 };

    // Physics capsule: a pill shape, moved by our code ("kinematic"), not pushed around by physics.
    const s = world.spawn;
    this.body = physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(s.x, s.y, s.z));
    this.collider = physics.createCollider(RAPIER.ColliderDesc.capsule(HALF - P.radius, P.radius), this.body);

    this.controller = physics.createCharacterController(0.02);
    this.controller.enableAutostep(0.45, 0.2, true);     // walk up steps up to 45 cm
    this.controller.enableSnapToGround(0.4);             // stay glued to the ground going downhill
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);

    this.model = createCharacter();
    scene.add(this.model.root);
    this.position = new THREE.Vector3(s.x, s.y, s.z); // center of the capsule
  }

  respawn() {
    const s = this.world.spawn;
    this.body.setTranslation({ x: s.x, y: s.y, z: s.z }, true);
    this.position.set(s.x, s.y, s.z);
    this.velocity.set(0, 0, 0);
    this.health = P.maxHealth;
    this.shield = 0;
  }

  // Feet position (where the model stands)
  get feet() { return new THREE.Vector3(this.position.x, this.position.y - HALF, this.position.z); }

  update(dt, input, yaw) {
    const k = input.keys;

    // 1. Which way do the keys point? (relative to where the camera looks)
    let ahead = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    let side = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const len = Math.hypot(ahead, side);
    if (len > 0) { ahead /= len; side /= len; }

    const crouching = k.has('KeyC') && !this.swimming;
    this.crouch += ((crouching ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);
    const sprinting = k.has('ShiftLeft') && ahead > 0 && !crouching;
    let speed = crouching ? P.crouchSpeed : sprinting ? P.sprintSpeed : P.walkSpeed;
    if (this.swimming) speed = P.swimSpeed;

    // Camera "forward" (flat on the ground) and "right"
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const targetX = (fx * ahead + rx * side) * speed;
    const targetZ = (fz * ahead + rz * side) * speed;

    // 2. Speed up / slow down smoothly (less control in the air)
    const grip = 1 - Math.exp(-(this.grounded || this.swimming ? 14 : 3) * dt);
    this.velocity.x += (targetX - this.velocity.x) * grip;
    this.velocity.z += (targetZ - this.velocity.z) * grip;

    // 3. Up and down: jumping, gravity, swimming
    const feetY = this.position.y - HALF;
    const swimLine = SETTINGS.world.waterLevel - 1.3; // float with your head above water
    this.swimming = feetY < swimLine + 0.05;
    if (this.swimming) {
      this.velocity.y = THREE.MathUtils.clamp((swimLine - feetY) * 4, -3, 3);
    } else if (this.grounded && input.pressed.has('Space')) {
      this.velocity.y = P.jumpSpeed;
    } else {
      this.velocity.y -= P.gravity * dt;
    }

    // 4. Ask the physics engine how far we can actually go
    const wanted = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    this.controller.computeColliderMovement(this.collider, wanted);
    const moved = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.velocity.y < 0) this.velocity.y = -1;            // rest on the ground
    if (this.velocity.y > 0 && moved.y < wanted.y * 0.5) this.velocity.y = 0;  // bumped our head

    this.position.set(this.position.x + moved.x, this.position.y + moved.y, this.position.z + moved.z);
    // Safety net: if anything ever pushes us under the island, pop back up on top.
    const ground = this.world.heightAt(this.position.x, this.position.z);
    if (this.position.y - HALF < ground - 2) this.position.y = ground + HALF + 0.1;
    this.body.setNextKinematicTranslation(this.position);

    // 5. Move and animate the model: face where the camera looks
    const turn = Math.atan2(Math.sin(yaw + Math.PI - this.facing), Math.cos(yaw + Math.PI - this.facing));
    this.facing += turn * Math.min(1, dt * 14);
    this.model.root.position.copy(this.feet);
    this.model.root.rotation.y = this.facing;
    const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
    this.model.animate(dt, horizontal, this.grounded || this.swimming, this.crouch);
  }
}
