/* =====================================================================
   MAIN
   Starts the game and runs the game loop. The game is always in one of
   these states: 'loading' -> 'menu' -> 'playing' <-> 'paused'.
   ===================================================================== */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import '@fontsource/lilita-one/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/700.css';
import './style.css';

import { SETTINGS } from './settings.js';
import { input, initInput, endInputFrame, isLocked, lockPointer } from './core/input.js';
import { buildWorld } from './world/world.js';
import { Player } from './player/player.js';
import { ThirdPersonCamera } from './player/camera.js';
import { buildCompass, updateHud } from './ui/hud.js';
import { Feedback } from './ui/feedback.js';
import { Loot } from './loot/loot.js';
import { makeWeapon, makeAmmo, makeHeal } from './loot/items.js';
import { Targets, placeTargets } from './weapons/targets.js';
import { Effects } from './weapons/effects.js';
import { Weapons } from './weapons/weapons.js';
import { initAudio, toggleMute } from './audio/sound.js';

const $ = (id) => document.getElementById(id);
let state = 'loading';

async function boot() {
  // The physics engine is written in another language (Rust → WebAssembly) and needs a moment to start.
  await RAPIER.init();

  // ---------- Renderer: draws the 3D scene onto the page ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, SETTINGS.graphics.pixelRatioMax));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = SETTINGS.graphics.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(SETTINGS.camera.fov, window.innerWidth / window.innerHeight, 0.1, 2000);
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------- Physics world and the island ----------
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const world = buildWorld(scene, physics);
  const targets = new Targets(scene, physics);
  const start = placeTargets(targets, world);   // practice range + where you start
  const loot = new Loot(scene, physics, world);
  physics.step(); // register everything so the first collision checks work

  const player = new Player(scene, physics, world);
  const cam = new ThirdPersonCamera(camera, physics, world);
  const effects = new Effects(scene);
  const feedback = new Feedback();
  const weapons = new Weapons({ physics, player, cam, targets, loot, effects, feedback });
  initInput(renderer.domElement);
  buildCompass();

  // ---------- Screens ----------
  function show(newState) {
    state = newState;
    $('loading').hidden = true;
    $('mainMenu').hidden = state !== 'menu';
    $('pauseMenu').hidden = state !== 'paused';
    $('hud').hidden = state !== 'playing' && state !== 'paused';
    $('pauseHint').textContent = '';
  }

  // A new match: fresh loot, empty hands, standing at the practice range.
  function newMatch() {
    player.respawn();
    player.inventory.reset();
    loot.reset(start);
    cam.yaw = start.yaw; cam.pitch = -0.1;
  }

  $('playBtn').addEventListener('click', () => {
    initAudio(); // sound is only allowed after a click
    newMatch();
    show('playing');
    lockPointer(); // hide the cursor so the mouse can turn the camera
  });
  $('resumeBtn').addEventListener('click', async () => {
    // Browsers make you wait about a second after pressing Esc before locking the mouse again.
    if (await lockPointer()) show('playing');
    else $('pauseHint').textContent = 'Click Resume again in a moment.';
  });
  $('menuBtn').addEventListener('click', () => show('menu'));
  // Pressing Esc releases the mouse; that's our signal to pause.
  document.addEventListener('pointerlockchange', () => {
    if (!isLocked() && state === 'playing') show('paused');
  });
  // If the mouse ever isn't captured while playing, a click on the game captures it.
  renderer.domElement.addEventListener('mousedown', () => { if (state === 'playing' && !isLocked()) lockPointer(); });

  // ---------- The game loop: runs about 60 times a second ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); // seconds since the last frame (capped)
    last = now;

    if (state === 'playing') {
      cam.look(input);
      player.update(dt, input, cam.yaw);
      physics.timestep = dt;
      physics.step();
      cam.update(dt, player);
      weapons.update(dt, input, camera);   // shoot after the camera moved, so bullets go where you see
      const prompt = loot.interact(dt, input, player, cam.forward);
      loot.update(dt, now / 1000, player);
      targets.update(dt, camera);
      effects.update(dt);
      feedback.update(dt, camera);
      world.sky.update(dt, player.feet);
      if (input.pressed.has('KeyM')) weapons.say(toggleMute() ? 'Sound off (M)' : 'Sound on (M)');
      if (player.health <= 0) {
        // No real matches yet (Build 5): just start again at the range, keeping your loot.
        player.respawn();
        weapons.say('You were eliminated! Back to the start.');
      }
      updateHud(dt, player, cam, weapons.hudInfo(), prompt, input);
    } else if (state === 'menu') {
      cam.orbit(now / 1000);
      world.sky.update(dt, new THREE.Vector3(0, 0, 0));
    }

    renderer.render(scene, camera);
    endInputFrame();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  show('menu');

  // A small window into the game for the automated test (tests/smoke.mjs).
  window.__game = {
    ready: true,
    state: () => state,
    player: () => ({ x: player.position.x, y: player.position.y, z: player.position.z, grounded: player.grounded, health: player.health, shield: player.shield }),
    groundAt: (x, z) => world.heightAt(x, z),
    renderInfo: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    // How many visible meshes are in the scene, grouped by what they belong to (for performance checks)
    meshCount: () => {
      const counts = {};
      scene.traverseVisible((o) => {
        if (!o.isMesh) return;
        let top = o; while (top.parent && top.parent !== scene) top = top.parent;
        const key = top.isMesh ? top.geometry.type : top.type + top.children.length;
        counts[key] = (counts[key] || 0) + 1;
      });
      return counts;
    },
    inventory: () => JSON.parse(JSON.stringify({ slots: player.inventory.slots, ammo: player.inventory.ammo, selected: player.inventory.selected })),
    targets: () => targets.list.map((t) => ({ health: t.health, shield: t.shield, down: t.down > 0 })),
    lootCount: () => ({ floor: loot.items.length, chests: loot.chests.length, opened: loot.chests.filter((c) => c.opened).length }),
    give: (type, rarity = 2) => {
      player.inventory.add(makeWeapon(type, rarity));
      player.inventory.add(makeAmmo(SETTINGS.weapons[type].ammo, 60));
    },
    giveHeal: (type, count) => player.inventory.add(makeHeal(type, count)),
    hurt: (amount) => player.takeDamage(amount),
    respawn: () => { player.respawn(); cam.yaw = start.yaw; },
    // Point the camera at a practice target (the camera looks along a line through the shoulder point)
    aimAt: (i) => {
      const t = targets.list[i].position;
      for (let k = 0; k < 3; k++) {
        const right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
        const pivot = player.feet.add(new THREE.Vector3(0, SETTINGS.camera.height, 0)).addScaledVector(right, SETTINGS.camera.shoulder);
        const d = t.clone().sub(pivot);
        cam.yaw = Math.atan2(-d.x, -d.z);
        cam.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      }
    },
    // Move next to the nearest closed chest (for testing)
    goToChest: () => {
      const c = loot.chests.find((ch) => !ch.opened);
      const x = c.pos.x + Math.sin(c.rotY) * 1.6, z = c.pos.z + Math.cos(c.rotY) * 1.6;
      player.body.setTranslation({ x, y: c.pos.y + 1.0, z }, true);
      player.position.set(x, c.pos.y + 1.0, z);
      cam.yaw = Math.atan2(x - c.pos.x, z - c.pos.z); // face the chest
    },
  };
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('.loading-text').textContent = 'Something went wrong: ' + err.message;
});
