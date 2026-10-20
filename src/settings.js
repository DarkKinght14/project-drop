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
    aimSpeed: 0.6,          // you move slower while aiming down sights (x walk speed)
    safeFall: 7,            // falls shorter than this don't hurt
    fallDamagePerMeter: 9,  // ...longer falls do this much damage per extra meter
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
    aimDistance: 2.1,       // the camera moves closer when you aim
    aimFov: 52,
    scopeFov: 16,           // sniper scope zoom
  },

  /* ---------- Rarity: grey → green → blue → purple → gold ----------
     damage / reload: multipliers on the weapon's base numbers.
     weight: how often it drops from the floor (chests use chestWeight). */
  rarity: [
    { name: 'Common',    color: '#b4b8c0', damage: 1.00, reload: 1.00, weight: 40, chestWeight: 10 },
    { name: 'Uncommon',  color: '#5fd13c', damage: 1.05, reload: 0.95, weight: 32, chestWeight: 32 },
    { name: 'Rare',      color: '#3aa8ff', damage: 1.10, reload: 0.90, weight: 18, chestWeight: 32 },
    { name: 'Epic',      color: '#b65cff', damage: 1.16, reload: 0.85, weight: 8,  chestWeight: 18 },
    { name: 'Legendary', color: '#ffb02e', damage: 1.22, reload: 0.80, weight: 2,  chestWeight: 8 },
  ],

  /* ---------- Weapons ----------
     damage: per bullet (per pellet for the shotgun); fireRate: shots per second;
     spread / aimSpread: how wide bullets scatter in degrees (hip / aiming);
     recoil: how much the view kicks up per shot (radians);
     range: full damage up to falloffStart, then down to minDamage x at range. */
  weapons: {
    pistol:  { name: 'Pistol',         short: 'PISTOL', ammo: 'light',  damage: 24, head: 2,   fireRate: 6,   auto: false, mag: 16, reload: 1.4, spread: 1.6, aimSpread: 0.5, recoil: 0.012, pellets: 1,  falloffStart: 30, range: 160, minDamage: 0.6 },
    smg:     { name: 'SMG',            short: 'SMG',    ammo: 'light',  damage: 17, head: 1.75,fireRate: 12,  auto: true,  mag: 30, reload: 2.2, spread: 3.2, aimSpread: 1.6, recoil: 0.008, pellets: 1,  falloffStart: 22, range: 140, minDamage: 0.55 },
    ar:      { name: 'Assault Rifle',  short: 'AR',     ammo: 'medium', damage: 31, head: 2,   fireRate: 5.5, auto: true,  mag: 30, reload: 2.3, spread: 2.2, aimSpread: 0.45,recoil: 0.016, pellets: 1,  falloffStart: 50, range: 260, minDamage: 0.7 },
    shotgun: { name: 'Pump Shotgun',   short: 'PUMP',   ammo: 'shells', damage: 9,  head: 2,   fireRate: 0.8, auto: false, mag: 5,  reload: 4.4, spread: 7,   aimSpread: 5.5, recoil: 0.07,  pellets: 10, falloffStart: 6,  range: 40,  minDamage: 0.25 },
    sniper:  { name: 'Sniper Rifle',   short: 'SNIPER', ammo: 'heavy',  damage: 105,head: 2.5, fireRate: 0.35,auto: false, mag: 1,  reload: 2.7, spread: 9,   aimSpread: 0,   recoil: 0.09,  pellets: 1,  falloffStart: 200,range: 600, minDamage: 0.9 },
  },
  ammo: {
    // max: the most you can carry; drop: how much one ammo box gives
    light:  { name: 'Light Ammo',  color: '#9fd0ff', max: 999, drop: 30 },
    medium: { name: 'Medium Ammo', color: '#7bd36a', max: 999, drop: 30 },
    heavy:  { name: 'Heavy Ammo',  color: '#e0605a', max: 999, drop: 6 },
    shells: { name: 'Shells',      color: '#ffd23f', max: 999, drop: 8 },
  },
  spreadGrow: 0.35,         // each shot adds this much of the base spread ("bloom")
  spreadRecover: 4,         // how fast the bloom shrinks back (per second)
  recoilRecover: 6,         // how fast the view settles back after a kick
  pickaxe: { damage: 20, range: 2.6, swingTime: 0.45 },

  /* ---------- Healing ----------
     health / shield: how much it gives; upTo: it won't heal above this;
     useTime: seconds to use; stack: how many fit in one hotbar slot. */
  heals: {
    bandage:     { name: 'Bandages',      short: 'BANDAGE', color: '#f2f2f2', health: 15,  upTo: 75,  useTime: 3.5, stack: 15, rarity: 0, drop: 5 },
    medkit:      { name: 'Med Kit',       short: 'MEDKIT',  color: '#ff4d4d', health: 100, upTo: 100, useTime: 10,  stack: 3,  rarity: 1, drop: 1 },
    smallShield: { name: 'Small Shield',  short: 'MINI',    color: '#53c7ff', shield: 25,  upTo: 50,  useTime: 2,   stack: 6,  rarity: 1, drop: 3 },
    bigShield:   { name: 'Shield Potion', short: 'SHIELD',  color: '#2e7bff', shield: 50,  upTo: 100, useTime: 5,   stack: 3,  rarity: 2, drop: 1 },
  },

  /* ---------- Loot spawns ---------- */
  loot: {
    chestsPerHouse: 1,
    floorPerHouse: 2,
    outdoorChests: 10,
    outdoorFloor: 28,
    chestOpenTime: 0.55,    // hold E this long to open a chest
    pickupRange: 2.4,
    ammoPickupRange: 1.4,   // ammo is picked up just by walking over it
    showDistance: 90,       // loot further away than this isn't drawn (faster)
  },

  /* ---------- Practice targets ---------- */
  targets: { health: 100, shield: 50, respawnTime: 4 },
};
