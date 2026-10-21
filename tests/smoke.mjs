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
  await page.evaluate(() => window.__game.freezeBots(true)); // bots wait until their part of the test
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

  // Mini shields: hold the mouse to drink them one after another (up to 50 shield)
  await game(() => window.__game.giveHeal('smallShield', 3));
  inv = await game(() => window.__game.inventory());
  const miniSlot = inv.slots.findIndex((s) => s && s.type === 'smallShield');
  await page.keyboard.press(`Digit${miniSlot + 2}`);
  await page.waitForTimeout(400);
  await page.mouse.down();
  await page.waitForFunction(() => window.__game.player().shield >= 50, null, { timeout: 30000 }).catch(() => {});
  await page.mouse.up();
  const afterMinis = await game(() => ({ shield: window.__game.player().shield, inv: window.__game.inventory() }));
  console.log(`mini shields: shield ${afterMinis.shield}, ${afterMinis.inv.slots[miniSlot]?.count ?? 0} left`);
  if (afterMinis.shield !== 50) fail('holding the mouse did not drink two mini shields');

  // ---------- Build 3: harvesting and building ----------
  await game(() => window.__game.goToTree());
  await page.keyboard.press('Digit1'); // pickaxe
  await page.waitForTimeout(400);
  await page.mouse.down();
  await page.waitForFunction(() => window.__game.materials().wood >= 20, null, { timeout: 30000 }).catch(() => {});
  await page.mouse.up();
  const wood = (await game(() => window.__game.materials())).wood;
  console.log(`harvesting: ${wood} wood`);
  if (wood < 20) fail('the pickaxe did not harvest wood from a tree');

  await game(() => { window.__game.respawn(); window.__game.setMaterials({ wood: 200, stone: 50 }); });
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyZ'); // wall
  await page.waitForTimeout(300);
  const mode = await game(() => window.__game.buildMode());
  if (!mode.active) fail('Z did not enter build mode');
  if (mode.reason) console.log(`(build target not allowed: ${mode.reason})`);
  await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up();
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyV'); // stairs, to the side
  await game(() => { /* look left a little */ });
  await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up();
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyR'); // stone
  await page.keyboard.press('KeyX'); // floor
  await page.waitForTimeout(200);
  await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tests/output/building.png' });
  let builds = await game(() => window.__game.builds());
  const mats = await game(() => window.__game.materials());
  console.log(`building: ${builds.map((b) => b.mat + ' ' + b.type).join(', ')}; ${mats.wood} wood, ${mats.stone} stone left`);
  if (builds.length < 2) fail('could not place build pieces');
  if (mats.wood >= 200) fail('building did not cost materials');

  // Leave build mode with the rifle and shoot the wall down
  await page.keyboard.press(`Digit${arSlot + 2}`);
  await page.waitForTimeout(300);
  if ((await game(() => window.__game.buildMode())).active) fail('pressing a slot key did not leave build mode');
  const wallBefore = builds.find((b) => b.type === 'wall');
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  builds = await game(() => window.__game.builds());
  const wallAfter = builds.find((b) => b.type === 'wall');
  console.log(`shooting the wall: ${wallBefore?.hp} -> ${wallAfter ? wallAfter.hp : 'destroyed'}`);
  if (wallAfter && wallAfter.hp >= wallBefore.hp) fail('bullets did not damage the wall');

  // ---------- Build 4: bots ----------
  const nav = await game(() => window.__game.navInfo());
  const botList = await game(() => window.__game.bots());
  console.log(`bots: ${botList.length} spawned; navigation map has ${nav.walkable} walkable cells of ${nav.cells}`);
  if (botList.length < 5) fail('bots did not spawn');
  if (nav.walkable < 20000) fail("the bots' navigation map is almost empty");

  // Fight one: a Legendary rifle against a bot 12 m away
  await game(() => { window.__game.respawn(); window.__game.clearBuilds(); window.__game.give('ar', 4); });
  inv = await game(() => window.__game.inventory());
  const goldAr = inv.slots.findIndex((s) => s && s.type === 'ar' && s.rarity === 4);
  await page.keyboard.press(`Digit${goldAr + 2}`);
  await page.waitForTimeout(300);
  const foe = await game(() => window.__game.botInFront(12));
  const foeBefore = (await game(() => window.__game.bots())).find((b) => b.name === foe);
  // 1. Your bullets hurt a bot (holding still for this part, so the test can aim)
  await page.mouse.down();
  for (let i = 0; i < 8; i++) { await game((n) => window.__game.aimAt(n), foe); await page.waitForTimeout(150); }
  await page.mouse.up();
  let foeNow = (await game(() => window.__game.bots())).find((b) => b.name === foe);
  console.log(`bot fight: you shot ${foe} from ${foeBefore.health + foeBefore.shield} down to ${foeNow.alive ? foeNow.health + foeNow.shield : 'eliminated'}`);
  if (foeNow.alive && foeNow.health + foeNow.shield >= foeBefore.health + foeBefore.shield) fail('bullets did not hurt the bot');
  // 2. Bots fight back
  await game(() => { window.__game.freezeBots(false); window.__game.botInFront(10); });
  await page.waitForFunction(() => window.__game.player().health < 100 || window.__game.state() !== 'playing', null, { timeout: 30000 }).catch(() => {});
  await page.screenshot({ path: 'tests/output/bot-fight.png' });
  const me = await game(() => window.__game.player());
  console.log(`bots fight back: you have ${Math.round(me.health)} health, ${Math.round(me.shield)} shield`);
  if (me.health >= 100) fail('a bot right in front of you never shot you');

  // Victory: when every bot is gone, the results screen says so
  if ((await game(() => window.__game.state())) === 'playing') {
    await game(() => window.__game.killBots());
    await page.waitForFunction(() => window.__game.state() === 'over', null, { timeout: 20000 }).catch(() => {});
    const title = await page.textContent('#resultTitle');
    await page.screenshot({ path: 'tests/output/results.png' });
    console.log(`end of match: "${title}", feed: ${await page.textContent('#killFeed')}`.slice(0, 200));
    if (!title.includes('VICTORY')) fail('winning did not show the victory screen');
  } else {
    console.log('(you were eliminated by the bot during the fight test; skipping the victory check)');
  }
  if (errors.length) fail('page errors:\n  ' + errors.join('\n  '));
  if (!process.exitCode) console.log('PASS  (screenshots in tests/output/)');
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
