/* =====================================================================
   MAIN
   Starts the game and runs the game loop. The game is always in one of
   these states: 'loading' -> 'menu' -> 'playing' <-> 'paused' -> 'over'
   ('over' = the results screen after you win or get eliminated).
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
import { buildCompass, updateHud, addKill, clearKillFeed } from './ui/hud.js';
import { Feedback } from './ui/feedback.js';
import { Loot } from './loot/loot.js';
import { makeWeapon, makeAmmo, makeHeal } from './loot/items.js';
import { Targets, placeTargets } from './weapons/targets.js';
import { Effects } from './weapons/effects.js';
import { Weapons } from './weapons/weapons.js';
import { Harvest } from './building/harvest.js';
import { Building } from './building/building.js';
import { initAudio, toggleMute, setListener } from './audio/sound.js';
import { Bots } from './bots/bots.js';
import { makeRandom } from './core/random.js';

const $ = (id) => document.getElementById(id);
let state = 'loading';

// Match options from the main menu, remembered in this browser (if storage works).
const options = { bots: SETTINGS.bots.count, difficulty: 'normal' };
try { Object.assign(options, JSON.parse(localStorage.getItem('drop-options') || '{}')); } catch (e) { /* storage unavailable */ }
const saveOptions = () => { try { localStorage.setItem('drop-options', JSON.stringify(options)); } catch (e) { /* ignore */ } };

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
  const harvest = new Harvest(world);
  const building = new Building(scene, physics, world, effects);
  // Bots (this also maps the island for them: it can take a moment)
  const bots = new Bots({ scene, physics, world, building, loot, effects, player, onElimination });
  const weapons = new Weapons({ physics, player, cam, targets, bots, loot, effects, feedback, building, harvest });
  initInput(renderer.domElement);
  buildCompass();

  // ---------- Screens ----------
  function show(newState) {
    state = newState;
    $('loading').hidden = true;
    $('mainMenu').hidden = state !== 'menu';
    $('pauseMenu').hidden = state !== 'paused';
    $('hud').hidden = state !== 'playing' && state !== 'paused';
    $('results').hidden = state !== 'over';
    $('pauseHint').textContent = '';
  }

  // A new match: fresh loot, empty hands, no builds, trees grown back, at the practice range.
  function newMatch() {
    player.respawn();
    player.inventory.reset();
    player.materials = { wood: 0, stone: 0, metal: 0 };
    loot.reset(start);
    harvest.reset();
    building.reset();
    cam.yaw = start.yaw; cam.pitch = -0.1;
    bots.start(options.bots, options.difficulty, makeRandom(Date.now() >>> 0), start);
    clearKillFeed();
    match.time = 0;
    match.victory = 0;
  }

  // ---------- The match: eliminations, winning and losing ----------
  const match = { time: 0, victory: 0 };
  function onElimination({ killer, victim, weapon }) {
    if (killer === player) {
      addKill(`<b>You</b> eliminated ${victim.name} <i>(${weapon})</i>`, 'mine');
      weapons.say(`You eliminated ${victim.name}!`);
    } else {
      addKill(`${killer ? killer.name : 'The island'} eliminated ${victim.name} <i>(${weapon})</i>`);
    }
  }

  function endMatch(won) {
    state = 'over'; // set first, so losing the mouse doesn't count as pausing
    document.exitPointerLock?.();
    const by = player.lastAttacker;
    $('resultTitle').textContent = won ? '#1 VICTORY' : 'ELIMINATED';
    $('resultTitle').classList.toggle('win', won);
    $('resultSub').textContent = won ? 'Last one standing. Well played!'
      : by ? `by ${by.name} with ${by.weapon}` : 'You fell too far';
    $('resultPlace').textContent = '#' + (won ? 1 : bots.aliveCount + 1);
    $('resultElims').textContent = String(bots.playerElims);
    const t = Math.floor(match.time);
    $('resultTime').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    if (!won && by) addKill(`${by.name} eliminated <b>You</b> <i>(${by.weapon})</i>`, 'me');
    show('over');
  }

  // Main menu: number of bots and difficulty
  function renderOptions() {
    $('optBots').innerHTML = SETTINGS.bots.counts.map((n) => `<button data-v="${n}" class="${n === options.bots ? 'on' : ''}">${n}</button>`).join('');
    $('optDiff').innerHTML = Object.entries(SETTINGS.bots.difficulty)
      .map(([k, d]) => `<button data-v="${k}" class="${k === options.difficulty ? 'on' : ''}">${d.name}</button>`).join('');
  }
  $('optBots').addEventListener('click', (e) => { if (e.target.dataset.v) { options.bots = Number(e.target.dataset.v); saveOptions(); renderOptions(); } });
  $('optDiff').addEventListener('click', (e) => { if (e.target.dataset.v) { options.difficulty = e.target.dataset.v; saveOptions(); renderOptions(); } });
  renderOptions();

  function startPlaying() {
    initAudio(); // sound is only allowed after a click
    newMatch();
    show('playing');
    lockPointer(); // hide the cursor so the mouse can turn the camera
  }
  $('againBtn').addEventListener('click', startPlaying);
  $('resultMenuBtn').addEventListener('click', () => { bots.clear(); show('menu'); });

  $('playBtn').addEventListener('click', startPlaying);
  $('resumeBtn').addEventListener('click', async () => {
    // Browsers make you wait about a second after pressing Esc before locking the mouse again.
    if (await lockPointer()) show('playing');
    else $('pauseHint').textContent = 'Click Resume again in a moment.';
  });
  $('menuBtn').addEventListener('click', () => { bots.clear(); show('menu'); });
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
      building.update(dt, input, player, cam); // before weapons: pressing 1-6 leaves build mode first
      weapons.update(dt, input, camera);   // shoot after the camera moved, so bullets go where you see
      setListener(player.feet);
      bots.update(dt, camera.position);
      match.time += dt;
      harvest.update(dt);
      const prompt = loot.interact(dt, input, player, cam.forward);
      loot.update(dt, now / 1000, player);
      targets.update(dt, camera);
      effects.update(dt);
      feedback.update(dt, camera);
      world.sky.update(dt, player.feet);
      if (input.pressed.has('KeyM')) weapons.say(toggleMute() ? 'Sound off (M)' : 'Sound on (M)');
      updateHud(dt, player, cam, weapons.hudInfo(), prompt, input, building.hudInfo(), { alive: bots.aliveCount + 1, elims: bots.playerElims });
      if (!player.alive) endMatch(false);
      else if (bots.list.length && bots.aliveCount === 0 && (match.victory += dt) > 1.5) endMatch(true);
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
    materials: () => ({ ...player.materials }),
    setMaterials: (m) => Object.assign(player.materials, m),
    builds: () => [...building.slots.values()].map((p) => ({ type: p.type, mat: p.mat, hp: Math.round(p.hp), grow: p.grow })),
    buildMode: () => ({ ...building.hudInfo(), target: building.target && { key: building.target.key, x: +building.target.x.toFixed(2), y: +building.target.y.toFixed(2), z: +building.target.z.toFixed(2), rotY: building.target.rotY } }),
    debugBuilds: () => [...building.slots.values()].map((p) => ({ key: p.key, x: p.x, y: p.y, z: p.z, rotY: p.rotY })),
    // Stand next to the nearest tree and face it (for testing the pickaxe)
    goToTree: () => {
      const f = player.feet;
      const tree = harvest.list.filter((r) => r.type === 'tree' && r.hits < r.maxHits)
        .sort((a, b) => Math.hypot(a.data.x - f.x, a.data.z - f.z) - Math.hypot(b.data.x - f.x, b.data.z - f.z))[0];
      const x = tree.data.x + 1.3, z = tree.data.z;
      const y = world.heightAt(x, z) + 1.0;
      player.body.setTranslation({ x, y, z }, true);
      player.position.set(x, y, z);
      cam.yaw = Math.PI / 2; // face -X, toward the tree
      cam.pitch = -0.05;
      return { x: tree.data.x, z: tree.data.z };
    },
    hurt: (amount) => player.takeDamage(amount),
    bots: () => bots.list.map((b) => ({ name: b.name, alive: b.alive, state: b.state, x: +b.position.x.toFixed(1), z: +b.position.z.toFixed(1),
      health: Math.round(b.health), shield: Math.round(b.shield), weapon: b.weapon.type, target: b.target?.name || null })),
    navInfo: () => ({ walkable: bots.nav.walk.reduce((a, b) => a + b, 0), cells: bots.nav.walk.length }),
    setOptions: (o) => { Object.assign(options, o); renderOptions(); },
    // Put a bot this far in front of you (for testing fights)
    botInFront: (distance) => {
      const b = bots.list.find((x) => x.alive);
      const x = player.position.x - Math.sin(cam.yaw) * distance, z = player.position.z - Math.cos(cam.yaw) * distance;
      const y = world.heightAt(x, z) + 1.2;
      b.position.set(x, y, z); b.body.setTranslation({ x, y, z }, true);
      b.yaw = Math.atan2(x - player.position.x, z - player.position.z); // facing you
      return b.name;
    },
    killBots: (except = 0) => bots.list.filter((b) => b.alive).slice(except).forEach((b) => bots.damage(b, 999, null, 'test')),
    respawn: () => { player.respawn(); cam.yaw = start.yaw; },
    teleport: (x, z, yaw) => {
      const y = world.heightAt(x, z) + 1.0;
      player.body.setTranslation({ x, y, z }, true);
      player.position.set(x, y, z);
      if (yaw !== undefined) cam.yaw = yaw;
    },
    freezeBots: (on) => { bots.frozen = on; },
    clearBuilds: () => building.reset(),
    // Point the camera at a practice target, or at a bot by name (the camera looks along a line through the shoulder point)
    aimAt: (i) => {
      const bot = typeof i === 'string' && bots.list.find((b) => b.name === i);
      const t = bot ? bot.feet.add(new THREE.Vector3(0, 1.1, 0)) : targets.list[i].position;
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
