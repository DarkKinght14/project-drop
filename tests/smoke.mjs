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
  await page.waitForTimeout(2000); // the hidden test browser runs slowly; give the jump time to land

  const end = await page.evaluate(() => window.__game.player());
  const ground = await page.evaluate(({ x, z }) => window.__game.groundAt(x, z), end);
  const info = await page.evaluate(() => window.__game.renderInfo());
  await page.screenshot({ path: 'tests/output/playing.png' });

  const moved = Math.hypot(end.x - start.x, end.z - start.z);
  console.log(`state=${await page.evaluate(() => window.__game.state())} moved=${moved.toFixed(1)}m feet-above-ground=${(end.y - 0.9 - ground).toFixed(2)}m grounded=${end.grounded} drawCalls=${info.calls} triangles=${info.triangles}`);

  if (![end.x, end.y, end.z].every(Number.isFinite)) fail('player position is not a number');
  if (moved < 3) fail(`player only moved ${moved.toFixed(1)} m`);
  if (end.y - 0.9 < ground - 0.5) fail('player fell through the ground');
  if (errors.length) fail('page errors:\n  ' + errors.join('\n  '));
  if (!process.exitCode) console.log('PASS  (screenshots in tests/output/)');
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
