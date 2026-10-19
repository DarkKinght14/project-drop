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
  physics.step(); // register everything so the first collision checks work

  const player = new Player(scene, physics, world);
  const cam = new ThirdPersonCamera(camera, physics, world);
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

  $('playBtn').addEventListener('click', () => {
    player.respawn();
    cam.yaw = 0; cam.pitch = -0.1;
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
      world.sky.update(dt, player.feet);
      updateHud(dt, player, cam);
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
    player: () => ({ x: player.position.x, y: player.position.y, z: player.position.z, grounded: player.grounded }),
    groundAt: (x, z) => world.heightAt(x, z),
    renderInfo: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  };
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('.loading-text').textContent = 'Something went wrong: ' + err.message;
});
