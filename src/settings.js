/* =====================================================================
   SETTINGS
   Every number that controls how the game looks and feels lives here.
   Distances are in meters, speeds in meters per second, angles in radians.
   ===================================================================== */
export const SETTINGS = {
  graphics: {
    pixelRatioMax: 1.5,     // sharper = slower; 1.5 suits a laptop with built-in graphics
    shadows: true,
    shadowMapSize: 2048,
    shadowRange: 70,        // shadows are drawn this far around the player
    fogNear: 140,
    fogFar: 520,
  },

  world: {
    seed: 20261020,         // same seed = same island every time
    size: 420,              // the island area is size x size meters
    resolution: 168,        // terrain detail (grid squares per side)
    maxHeight: 30,          // tallest hills
    waterLevel: 0,
    trees: 520,
    rocks: 140,
    bushes: 260,
    houses: 8,
  },

  player: {
    walkSpeed: 5.5,
    sprintSpeed: 8.5,
    crouchSpeed: 2.6,
    swimSpeed: 3.2,
    jumpSpeed: 7.6,
    gravity: 22,
    radius: 0.4,            // the player's collision capsule
    height: 1.8,
    maxHealth: 100,
    maxShield: 100,
  },

  camera: {
    fov: 75,
    distance: 3.6,          // how far behind the player
    shoulder: 0.7,          // how far to the right (over-the-shoulder view)
    height: 1.55,           // eye height when standing
    crouchHeight: 1.1,
    sensitivity: 0.0022,    // mouse look speed
    minPitch: -1.25,
    maxPitch: 1.2,
  },
};
