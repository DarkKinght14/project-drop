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
`npm test` (`tests/smoke.mjs`) starts `vite preview`, opens the game in headless Edge (`channel: 'msedge'`; there's no Playwright browser download, since `playwright-core` is used), clicks Play, sprints and jumps, and fails on any console error, a player that didn't move, or one that fell through the ground. Screenshots go to `tests/output/` (gitignored). Read them to check visuals. The headless browser renders with SwiftShader at about 20 FPS, so allow generous waits.

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes to GitHub Pages at https://darkkinght14.github.io/project-drop/. `vite.config.js` uses `base: './'` so relative paths work there. `vite-plugin-pwa` makes it installable and offline.

## Architecture

- **`src/main.js`** boots Rapier (`await RAPIER.init()`), creates the renderer, scene and physics world, builds the world, player and camera, and runs the loop. Game state is `'loading' | 'menu' | 'playing' | 'paused'`. Pausing is driven by pointer lock: losing the lock while playing pauses. Per-frame order while playing: `cam.look(input)` → `player.update(dt, input, cam.yaw)` → `physics.step()` → `cam.update(dt, player)` → `sky.update` → `updateHud`, then `endInputFrame()`. `window.__game` exposes read-only hooks used by the smoke test. Extend it when tests need more.
- **`src/core/`**: `input.js` holds the shared `input` object (`keys` held, `pressed` this frame, mouse deltas only while pointer-locked, wheel) plus `lockPointer()`, which never throws. `random.js` provides the seeded RNG (`makeRandom`), value noise and `fbm`. **All world generation must use the seeded RNG**, so the island is identical every run.
- **`src/world/`**: `world.js` sets the build order. House spots are picked first, then `field.addFlatZone` flattens the ground under them, *then* the terrain mesh is built, then nature is scattered with an `isFree` check that keeps it out of houses. `field.heightAt(x, z)` is the single source of truth for ground height. The terrain's physics is a trimesh built from the same vertices as the mesh. Trees and rocks are `InstancedMesh` with one fixed collider each, and their data is returned in `world.trees` / `world.rocks` for later harvesting. Houses are box parts on one fixed rigid body (local-space colliders). `sky.js` moves the sun's shadow camera with the player.
- **`src/player/`**: `Player` is a kinematic capsule moved by Rapier's `KinematicCharacterController` (autostep, snap-to-ground, slope limits). `position` is the capsule center, and `feet` is `position.y - height/2`. Swimming clamps the feet to `waterLevel - 1.3`. The model (`character.js`) is primitives with hip and shoulder pivot groups, faces +Z, and is rotated to `yaw + π`. `ThirdPersonCamera` is an over-the-shoulder orbit that raycasts from the pivot (excluding the player collider) to avoid clipping through walls. Yaw 0 looks toward −Z (north), and `heading` = −yaw in degrees.
- **`src/ui/`**: `hud.js` writes to the DOM in `index.html` (only when values change). Screens and HUD markup live in `index.html`, and styling in `src/style.css` (CSS variables at the top: Lilita One display font, Barlow text).
