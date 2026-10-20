/* =====================================================================
   SMOKE TEST
   Builds nothing itself: run `npm run build` first, then `npm test`.
   It starts the built game, opens it in a hidden Microsoft Edge window,
   clicks Play, walks and jumps, takes a screenshot, and fails if the
   page reported any errors or the player didn't move.
   ===================================================================== */
import { preview } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const PORT = 4174;
const errors = [];
const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
  mkdirSync('tests/output', { recursive: true });
  await page.screenshot({ path: 'tests/output/menu.png' });

  await page.click('#playBtn');
  await page.waitForTimeout(800);
  const start = await page.evaluate(() => window.__game.player());

  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  // The hidden test browser runs slowly; wait for the jump to land.
  await page.waitForFunction(() => window.__game.player().grounded, null, { timeout: 10000 }).catch(() => {});

  const end = await page.evaluate(() => window.__game.player());
  const ground = await page.evaluate(({ x, z }) => window.__game.groundAt(x, z), end);
  const info = await page.evaluate(() => window.__game.renderInfo());
  await page.screenshot({ path: 'tests/output/playing.png' });

  const moved = Math.hypot(end.x - start.x, end.z - start.z);
  console.log(`state=${await page.evaluate(() => window.__game.state())} moved=${moved.toFixed(1)}m feet-above-ground=${(end.y - 0.9 - ground).toFixed(2)}m grounded=${end.grounded} drawCalls=${info.calls} triangles=${info.triangles}`);

  if (![end.x, end.y, end.z].every(Number.isFinite)) fail('player position is not a number');
  if (moved < 3) fail(`player only moved ${moved.toFixed(1)} m`);
  if (end.y - 0.9 < ground - 0.5) fail('player fell through the ground');

  // ---------- Build 2: chests, shooting, healing ----------
  const game = (fn, arg) => page.evaluate(fn, arg);
  const loot = await game(() => window.__game.lootCount());
  console.log(`loot: ${loot.floor} floor items, ${loot.chests} chests`);
  if (loot.floor < 20 || loot.chests < 8) fail('not enough loot spawned');

  // Open a chest by holding E, then pick something up with E
  await game(() => window.__game.goToChest());
  await page.waitForTimeout(500);
  // (The hidden test browser is slow, so wait for things to happen rather than a fixed time.)
  await page.keyboard.down('KeyE');
  const opened = await page.waitForFunction(() => window.__game.lootCount().opened === 1, null, { timeout: 15000 }).then(() => true, () => false);
  await page.keyboard.up('KeyE');
  if (!opened) fail('holding E did not open the chest');
  await page.waitForTimeout(2500); // let the items fly out and land
  await page.screenshot({ path: 'tests/output/chest.png' });
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(400);
  let inv = await game(() => window.__game.inventory());
  const carried = inv.slots.filter(Boolean).length + Object.values(inv.ammo).reduce((a, b) => a + b, 0);
  if (carried === 0) fail('could not pick up anything from the chest');

  // Back to the practice range with a Rare assault rifle; shoot the first dummy
  await game(() => { window.__game.respawn(); window.__game.give('ar', 2); });
  await page.waitForTimeout(600);
  inv = await game(() => window.__game.inventory());
  const arSlot = inv.slots.findIndex((s) => s && s.type === 'ar' && s.rarity === 2);
  await page.keyboard.press(`Digit${arSlot + 2}`);
  await page.waitForTimeout(500);
  await game(() => window.__game.aimAt(0));
  await page.mouse.move(640, 360);
  await page.mouse.down();
  for (let i = 0; i < 8; i++) { await game(() => window.__game.aimAt(0)); await page.waitForTimeout(150); }
  await page.screenshot({ path: 'tests/output/shooting.png' });
  await page.mouse.up();
  const dummy = (await game(() => window.__game.targets()))[0];
  inv = await game(() => window.__game.inventory());
  const shots = 30 - inv.slots[arSlot].mag;
  console.log(`shooting: fired ${shots} shots, dummy now ${Math.round(dummy.shield)} shield / ${Math.round(dummy.health)} health${dummy.down ? ' (knocked down)' : ''}`);
  if (shots < 2) fail('the rifle did not fire');
  if (!dummy.down && dummy.shield + dummy.health >= 150) fail('the dummy was not damaged');

  // Get hurt, then heal with bandages
  await game(() => { window.__game.hurt(40); window.__game.giveHeal('bandage', 5); });
  inv = await game(() => window.__game.inventory());
  const bandageSlot = inv.slots.findIndex((s) => s && s.type === 'bandage');
  await page.keyboard.press(`Digit${bandageSlot + 2}`);
  await page.waitForTimeout(400);
  const hurtHealth = (await game(() => window.__game.player())).health;
  await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up();
  await page.waitForFunction((h) => window.__game.player().health > h, hurtHealth, { timeout: 30000 }).catch(() => {});
  const healed = (await game(() => window.__game.player())).health;
  console.log(`healing: ${Math.round(hurtHealth)} -> ${Math.round(healed)} health`);
  if (!(healed > hurtHealth)) fail('bandages did not heal');
  if (errors.length) fail('page errors:\n  ' + errors.join('\n  '));
  if (!process.exitCode) console.log('PASS  (screenshots in tests/output/)');
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
