# Project Drop (working title)

A single-player, offline, 3D battle royale for the browser, inspired by the genre (loot, shoot, build, survive) with its own original world and characters. Built with [Three.js](https://threejs.org/) and the [Rapier](https://rapier.rs/) physics engine.

**Play:** https://darkkinght14.github.io/project-drop/. In Chrome or Edge, click the install icon in the address bar to install it as an app that works offline.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse | Look |
| Left mouse | Shoot / swing the pickaxe / use a healing item |
| Right mouse | Aim down sights (sniper: scope) |
| R | Reload |
| E | Pick up (hold to open chests) |
| 1–6 / mouse wheel | Choose a hotbar slot (1 = pickaxe) |
| Q | Drop the selected item |
| Tab (hold) | Backpack: items and ammo |
| Space | Jump |
| Shift | Sprint |
| C | Crouch |
| Z / X / V / F | Build mode: wall / floor / stairs / roof (click or hold to build) |
| R (in build mode) | Switch material: wood → stone → metal |
| 1–6 (in build mode) | Back to your weapons |
| M | Mute |
| Esc | Pause |

## Roadmap

1. ✅ The island and your character
2. ✅ Shooting and loot: 5 weapons in 5 rarities, chests, ammo, healing, practice range
3. ✅ Building: harvest wood/stone/metal, build walls, floors, stairs and roofs
4. ✅ Smart AI bots: they loot, fight you and each other, wall up and build stairs. Choose 5/12/20 bots and Easy/Normal/Hard
5. The full battle royale match (bus, glider, storm)
6. Polish: models, sound, effects, settings

## Develop

```bash
npm install
npm run dev      # play locally with live reload
npm run build    # make the release version in dist/
npm test         # automated smoke test (run after build)
```
