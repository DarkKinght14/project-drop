# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Project Drop** (a working title; the user will choose the real name) is a single-player, offline, 3D battle royale in the browser. It's inspired by Fortnite-style gameplay, but **original**: never use Epic's names, characters, logos, art or sounds. The user is a beginner. Build in playable stages, explain each one in simple language, and keep code comments beginner-friendly, matching the existing `/* ===== SECTION ===== */` style.

Hard constraints:
- **Offline**: no CDN or network loads at runtime. Libraries, fonts (`@fontsource/*`) and any future assets are installed or committed locally and bundled by Vite. Any 3D models added later must be CC0 (e.g. Kenney, Quaternius).
- **Target hardware**: the user's laptop has an Intel Core Ultra 5 125U with **integrated Intel graphics** and 16 GB RAM. Keep the defaults in `src/settings.js` (`graphics.*`) running smoothly there. Prefer `InstancedMesh`, shared materials and few draw calls.
- All tunable numbers go in `src/settings.js`.

## Version control (required)

Commit and push to GitHub **regularly as you work**, so no progress is lost and any change can be reverted.
- Commit after each meaningful working step, with a short imperative subject (e.g. `Add rarity colors to loot`) and an optional body. Push right after every commit.
- Run `npm run build` and `npm test` before committing gameplay changes. Don't commit a broken game.
- Undo with `git revert`. Never rewrite pushed history.
- Remote: `origin` → `github.com/DarkKinght14/project-drop` (public, `main`). If `git` isn't on PATH, it's at `C:\Program Files\Git\cmd`. The GitHub CLI is at `C:\Program Files\GitHub CLI\gh.exe`.

## Commands

```bash
npm run dev      # dev server with live reload (http://localhost:5173)
npm run build    # production build to dist/ (also generates the PWA service worker)
npm test         # smoke test: needs a build first; drives headless Microsoft Edge via playwright-core
```
`npm test` runs two files:
- `tests/logic.mjs`: plain Node checks of the rules (damage, rarity, loot rolls, inventory). It imports `src/` modules directly, so anything it tests must not import three.js.
- `tests/smoke.mjs`: starts `vite preview` and opens the game in headless Edge (`channel: 'msedge'`; there's no Playwright browser download, since `playwright-core` is used). It clicks Play, sprints and jumps, opens a chest with E, shoots a dummy and heals with bandages. It fails on any console error or a step that didn't work. It drives the game through the `window.__game` hooks in `main.js` (`give`, `aimAt`, `goToChest`, `meshCount`…).

Screenshots go to `tests/output/` (gitignored). Read them to check visuals. The headless browser renders with SwiftShader at about 20 FPS, and game time runs slower than real time because `dt` is capped. So wait for conditions with `waitForFunction`, not fixed timeouts.

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes to GitHub Pages at https://darkkinght14.github.io/project-drop/. `vite.config.js` uses `base: './'` so relative paths work there. `vite-plugin-pwa` makes it installable and offline.

## Architecture

- **`src/main.js`** boots Rapier (`await RAPIER.init()`), creates the renderer, scene and physics world, and builds the world, targets, loot, player, camera and weapons. Then it runs the loop. Game state is `'loading' | 'menu' | 'playing' | 'paused'`. Pausing is driven by pointer lock: losing the lock while playing pauses. Play calls `newMatch()`, which respawns, empties the inventory and re-rolls loot.
  - Per-frame order while playing: `cam.look` → `player.update` → `physics.step()` → `cam.update` → `weapons.update` (shoots along the camera's real direction, so it must come after `cam.update`) → `loot.interact` / `loot.update` → `targets.update` → `effects.update` → `feedback.update` → `sky.update` → `updateHud`, then `endInputFrame()`.
  - Weapons talks to the player through flags it sets each frame (`player.slowdown`, `canSprint`, `pose`, `pitch`, `action`), which `player.update` uses on the next frame.
  - `window.__game` exposes hooks for the smoke test. Extend it when tests need more.
- **Draw calls are the main performance cost** on integrated graphics. Multi-part static models are merged into one mesh with vertex colors via `src/core/bake.js` (`bakeGeometry` / `bakeMesh`, shared flat-shaded `bakedMaterial`): houses, clouds, guns, chests and dummies. `loot/models.js` caches baked geometry per model key. Floor loot doesn't cast shadows, and loot, chests and dummies are hidden beyond a distance. Check `__game.renderInfo()` / `meshCount()` after adding scenery (the smoke test prints draw calls, currently about 120–140).
- **`src/core/`**: `input.js` holds the shared `input` object (`keys` held, `pressed` this frame, mouse deltas only while pointer-locked, wheel) plus `lockPointer()`, which never throws. `random.js` provides the seeded RNG (`makeRandom`), value noise and `fbm`. **All world generation must use the seeded RNG**, so the island is identical every run.
- **`src/world/`**: `world.js` sets the build order. House spots are picked first, then `field.addFlatZone` flattens the ground under them, *then* the terrain mesh is built, then nature is scattered with an `isFree` check that keeps it out of houses. `field.heightAt(x, z)` is the single source of truth for ground height. The terrain's physics is a trimesh built from the same vertices as the mesh. Trees and rocks are `InstancedMesh` with one fixed collider each, and their data is returned in `world.trees` / `world.rocks` for later harvesting. Houses are box parts on one fixed rigid body (local-space colliders). `sky.js` moves the sun's shadow camera with the player.
- **`src/player/`**: `Player` is a kinematic capsule moved by Rapier's `KinematicCharacterController` (autostep, snap-to-ground, slope limits). `position` is the capsule center, and `feet` is `position.y - height/2`. Swimming clamps the feet to `waterLevel - 1.3`. The model (`character.js`) is primitives with hip and shoulder pivot groups, faces +Z, and is rotated to `yaw + π`. `ThirdPersonCamera` is an over-the-shoulder orbit that raycasts from the pivot (excluding the player collider) to avoid clipping through walls. Yaw 0 looks toward −Z (north), and `heading` = −yaw in degrees.
  - World generation also picks the practice-range direction (`world.range`, the flattest of 8 directions from spawn) *before* scattering nature. `isFree` keeps trees and rocks out of the start area and the shooting lane.
- **Items** (`src/loot/items.js`, no three.js) are plain objects: `{ kind: 'weapon', type, rarity, mag }`, `{ kind: 'heal', type, rarity, count }`, `{ kind: 'ammo', type, count }`. Base stats come from `SETTINGS.weapons` / `heals` / `ammo`, and `weaponStats(item)` applies the rarity multipliers. `Inventory` (`player/inventory.js`) has slot index 0 = pickaxe and 1–5 = `slots[0..4]`, and keeps ammo separately in `inventory.ammo`.
- **Loot** (`src/loot/loot.js`): chest and floor-loot *spots* are seeded and fixed (inside houses via `houseToWorld`, plus outdoors). Their *contents* are rolled with `Math.random` on every `reset()`. Items fly out in an arc to a point found by a downward ray (`groundBelow`). Ammo is picked up by walking over it; everything else uses E. Hold E to open a chest.
- **Shooting** (`src/weapons/weapons.js`) is hitscan. A Rapier ray starts from the camera, pushed forward to the player's depth so nothing behind the player is hit, and goes along `camera.getWorldDirection` plus a random spread cone. It excludes the player collider. Hits are mapped to targets through `targets.byCollider` (collider handle → `{ target, head }`). Shotgun pellets are summed per target into one damage number. Recoil kicks `cam.pitch` and most of it settles back (`recoilDebt`).
- **Practice targets** (`src/weapons/targets.js`) are fixed bodies with a body cuboid and a head ball. A knocked-down dummy disables its colliders and respawns after `SETTINGS.targets.respawnTime`. Bots in Build 4 should reuse the same `byCollider` / damage flow.
- **Sound** (`src/audio/sound.js`) is generated with Web Audio (no files). `initAudio()` must be called from a click (the Play button).
- **`src/ui/`**: `hud.js` writes to the DOM in `index.html` (only when values change; the hotbar and backpack re-render from a key string). `feedback.js` projects floating damage numbers and flashes the hit marker. Screens and HUD markup live in `index.html`, and styling in `src/style.css` (CSS variables at the top: Lilita One display font, Barlow text).
