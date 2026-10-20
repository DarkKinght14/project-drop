/* =====================================================================
   ITEMS
   What an item IS (a weapon, a healing item or ammo), how rare it is,
   how much damage it does, and what drops from chests and the floor.
   Nothing here draws anything, so it can be tested on its own.
   ===================================================================== */
import { SETTINGS } from '../settings.js';

const WEAPON_TYPES = Object.keys(SETTINGS.weapons);
const HEAL_TYPES = Object.keys(SETTINGS.heals);

// ---------- Making items ----------
export const makeWeapon = (type, rarity) => ({ kind: 'weapon', type, rarity, mag: SETTINGS.weapons[type].mag });
export const makeHeal = (type, count = SETTINGS.heals[type].drop) => ({ kind: 'heal', type, rarity: SETTINGS.heals[type].rarity, count });
export const makeAmmo = (type, count = SETTINGS.ammo[type].drop) => ({ kind: 'ammo', type, rarity: 0, count });

// ---------- Names and colors ----------
export function itemName(item) {
  if (item.kind === 'weapon') return `${SETTINGS.rarity[item.rarity].name} ${SETTINGS.weapons[item.type].name}`;
  if (item.kind === 'heal') return SETTINGS.heals[item.type].name;
  return SETTINGS.ammo[item.type].name;
}
export const rarityColor = (item) => SETTINGS.rarity[item.rarity].color;

// A weapon's real numbers: the base stats, made stronger by its rarity.
export function weaponStats(item) {
  const base = SETTINGS.weapons[item.type];
  const r = SETTINGS.rarity[item.rarity];
  return { ...base, damage: base.damage * r.damage, reload: base.reload * r.reload };
}

// ---------- Damage ----------
// Damage of one bullet, after distance falloff and headshots.
export function shotDamage(stats, distance, headshot) {
  let dmg = stats.damage;
  if (distance > stats.falloffStart) {
    const t = Math.min(1, (distance - stats.falloffStart) / Math.max(1, stats.range - stats.falloffStart));
    dmg *= 1 - t * (1 - stats.minDamage);
  }
  if (headshot) dmg *= stats.head;
  return dmg;
}

// Shield soaks damage first, then health. Returns how much each one lost.
export function applyDamage(target, amount) {
  const toShield = Math.min(target.shield, amount);
  target.shield -= toShield;
  const toHealth = Math.min(target.health, amount - toShield);
  target.health -= toHealth;
  return { shield: toShield, health: toHealth };
}

// ---------- Random loot ----------
function pickWeighted(rng, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll < 0) return i; }
  return weights.length - 1;
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

export function rollRarity(rng, fromChest = false) {
  return pickWeighted(rng, SETTINGS.rarity.map((r) => (fromChest ? r.chestWeight : r.weight)));
}

// A weapon always comes with some ammo that fits it.
function weaponWithAmmo(rng, fromChest) {
  const type = pick(rng, WEAPON_TYPES);
  const weapon = makeWeapon(type, rollRarity(rng, fromChest));
  return [weapon, makeAmmo(SETTINGS.weapons[type].ammo)];
}

export function rollFloorLoot(rng) {
  const roll = rng();
  if (roll < 0.6) return weaponWithAmmo(rng, false);
  if (roll < 0.85) return [makeHeal(pick(rng, HEAL_TYPES))];
  return [makeAmmo(pick(rng, Object.keys(SETTINGS.ammo)))];
}

// Chests are better: a weapon (higher rarity), a healing item and extra ammo.
export function rollChestLoot(rng) {
  return [...weaponWithAmmo(rng, true), makeHeal(pick(rng, HEAL_TYPES)), makeAmmo(pick(rng, Object.keys(SETTINGS.ammo)))];
}
