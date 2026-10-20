/* =====================================================================
   THIRD-PERSON CAMERA
   The camera floats behind the player's right shoulder. Moving the mouse
   changes "yaw" (turning left/right) and "pitch" (looking up/down).
   If a wall gets between the camera and the player, the camera slides
   in closer so you never look through walls.
   ===================================================================== */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SETTINGS } from '../settings.js';

const C = SETTINGS.camera;

export class ThirdPersonCamera {
  constructor(camera, physics, world) {
    this.camera = camera;
    this.physics = physics;
    this.world = world;
    this.yaw = 0;      // 0 = looking north
    this.pitch = -0.1;
    this.distance = C.distance;
    this.aim = 0;          // 0 = normal view, 1 = fully aiming down sights
    this.aiming = false;   // set by the weapons code each frame
    this.scoped = false;   // sniper scope: zoom in a lot
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  }

  // Direction the camera looks (a 3D arrow of length 1)
  get forward() {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
  }

  // Step 1 of each frame: turn with the mouse (before the player moves)
  look(input) {
    // Zoomed in = turn slower, so aiming stays steady
    const s = C.sensitivity * (this.camera.fov / C.fov);
    this.yaw -= input.mouseDX * s;
    this.pitch = THREE.MathUtils.clamp(this.pitch - input.mouseDY * s, C.minPitch, C.maxPitch);
  }

  // Bump the view upward (gun recoil)
  kick(amount) {
    this.pitch = Math.min(C.maxPitch, this.pitch + amount);
  }

  // Step 2 of each frame: place the camera behind the player (after the player moved)
  update(dt, player) {
    // Aiming: zoom in (smaller field of view) and pull the camera closer
    this.aim += ((this.aiming ? 1 : 0) - this.aim) * Math.min(1, dt * 14);
    const fov = THREE.MathUtils.lerp(C.fov, this.scoped ? C.scopeFov : C.aimFov, this.aim);
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    const maxDistance = THREE.MathUtils.lerp(C.distance, C.aimDistance, this.aim);

    // The point we orbit around: the player's head height, shifted over the right shoulder
    const eye = THREE.MathUtils.lerp(C.height, C.crouchHeight, player.crouch);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const pivot = player.feet.add(new THREE.Vector3(0, eye, 0)).addScaledVector(right, C.shoulder);
    const back = this.forward.negate();

    // Shoot a ray from the pivot backwards: does it hit a wall before reaching the camera?
    let wanted = maxDistance;
    this.ray.origin = pivot;
    this.ray.dir = back;
    const hit = this.physics.castRay(this.ray, maxDistance, true, undefined, undefined, player.collider);
    if (hit) wanted = Math.max(0.4, hit.timeOfImpact - 0.25);
    // Snap in fast (so walls never block the view), ease back out slowly
    this.distance += (wanted - this.distance) * Math.min(1, dt * (wanted < this.distance ? 30 : 6));

    const pos = pivot.clone().addScaledVector(back, this.distance);
    pos.y = Math.max(pos.y, this.world.heightAt(pos.x, pos.z) + 0.4); // never under the ground
    this.camera.position.copy(pos);
    this.camera.lookAt(pivot.clone().addScaledVector(this.forward, 40));
  }

  // On the main menu, slowly circle over the island
  orbit(time) {
    if (this.camera.fov !== C.fov) { this.camera.fov = C.fov; this.camera.updateProjectionMatrix(); }
    const a = time * 0.05;
    this.camera.position.set(Math.cos(a) * 170, 75, Math.sin(a) * 170);
    this.camera.lookAt(0, 8, 0);
  }

  // Compass heading in degrees (0 = north, 90 = east)
  get heading() {
    return ((((-this.yaw * 180) / Math.PI) % 360) + 360) % 360;
  }
}
