/* =====================================================================
   LOGIC TESTS
   Quick checks of the game rules (no graphics, no browser):
   damage, shields, rarity, loot rolls and the inventory.
   Run with: node tests/logic.mjs  (npm test runs it too)
   ===================================================================== */
import assert from 'node:assert/strict';
import { SETTINGS } from '../src/settings.js';
import { makeRandom } from '../src/core/random.js';
import { makeWeapon, makeHeal, makeAmmo, weaponStats, shotDamage, applyDamage, rollRarity, rollChestLoot, rollFloorLoot } from '../src/loot/items.js';
import { Inventory } from '../src/player/inventory.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error(`FAIL: ${name}\n  ${e.message}`); process.exitCode = 1; }
}

test('higher rarity does more damage and reloads faster', () => {
  const grey = weaponStats(makeWeapon('ar', 0)), gold = weaponStats(makeWeapon('ar', 4));
  assert.ok(gold.damage > grey.damage);
  assert.ok(gold.reload < grey.reload);
});

test('headshots double AR damage; falloff reduces damage far away', () => {
  const ar = weaponStats(makeWeapon('ar', 0));
  assert.equal(shotDamage(ar, 10, true), ar.damage * 2);
  assert.ok(shotDamage(ar, 200, false) < ar.damage);
  assert.ok(shotDamage(ar, 10_000, false) >= ar.damage * ar.minDamage - 1e-9);
});

test('a close pump shotgun blast does about 90', () => {
  const pump = weaponStats(makeWeapon('shotgun', 0));
  assert.equal(shotDamage(pump, 3, false) * pump.pellets, 90);
});

test('shield absorbs damage before health', () => {
  const t = { health: 100, shield: 30 };
  assert.deepEqual(applyDamage(t, 50), { shield: 30, health: 20 });
  assert.deepEqual(t, { health: 80, shield: 0 });
  applyDamage(t, 999);
  assert.equal(t.health, 0);
});

test('chests roll better rarity than floor loot', () => {
  const rng = makeRandom(1);
  let floor = 0, chest = 0;
  for (let i = 0; i < 4000; i++) { floor += rollRarity(rng, false); chest += rollRarity(rng, true); }
  assert.ok(chest > floor, `chest avg ${chest / 4000} should beat floor avg ${floor / 4000}`);
});

test('chests always give a weapon with matching ammo, plus healing', () => {
  const rng = makeRandom(7);
  for (let i = 0; i < 200; i++) {
    const items = rollChestLoot(rng);
    const weapon = items.find((x) => x.kind === 'weapon');
    assert.ok(weapon);
    assert.ok(items.some((x) => x.kind === 'ammo' && x.type === SETTINGS.weapons[weapon.type].ammo));
    assert.ok(items.some((x) => x.kind === 'heal'));
    assert.equal(weapon.mag, SETTINGS.weapons[weapon.type].mag);
  }
  for (let i = 0; i < 200; i++) assert.ok(rollFloorLoot(rng).length >= 1);
});

test('inventory: pickaxe slot, adding, stacking, swapping', () => {
  const inv = new Inventory();
  assert.equal(inv.current, null); // pickaxe
  assert.equal(inv.add(makeWeapon('ar', 1)), null);
  assert.equal(inv.add(makeAmmo('medium', 30)), null);
  assert.equal(inv.ammo.medium, 30);
  assert.equal(inv.add(makeHeal('bandage', 10)), null);
  assert.equal(inv.add(makeHeal('bandage', 10)), null); // 15 in one stack, 5 in the next
  assert.deepEqual(inv.slots.filter((s) => s?.type === 'bandage').map((s) => s.count), [15, 5]);
  inv.add(makeWeapon('smg', 0)); inv.add(makeWeapon('sniper', 0));
  const left = inv.add(makeWeapon('pistol', 0));
  assert.equal(left.type, 'pistol', 'hotbar is full, so the pistol is left over');
  inv.select(1);
  const old = inv.swap(left);
  assert.equal(old.type, 'ar');
  assert.equal(inv.current.type, 'pistol');
  inv.select(0);
  assert.equal(inv.swap(makeWeapon('ar', 0)).type, 'ar', "can't swap away the pickaxe");
});

test('inventory: the mouse wheel skips empty slots', () => {
  const inv = new Inventory();
  inv.add(makeWeapon('ar', 1));
  inv.cycle(1); assert.equal(inv.selected, 1);
  inv.cycle(1); assert.equal(inv.selected, 0);
  inv.cycle(-1); assert.equal(inv.selected, 1);
});

test('using healing items uses them up', () => {
  const inv = new Inventory();
  inv.add(makeHeal('medkit', 1));
  inv.select(1);
  inv.consumeCurrent();
  assert.equal(inv.slots[0], null);
});

console.log(process.exitCode ? 'Logic tests FAILED' : `Logic tests: ${passed} passed`);
