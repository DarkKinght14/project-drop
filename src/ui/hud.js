/* =====================================================================
   HUD
   Copies the game's numbers onto the screen: health, shield,
   materials, the compass and the frames-per-second counter.
   ===================================================================== */
import { SETTINGS } from '../settings.js';

const $ = (id) => document.getElementById(id);
let lastText = {};
// Only touch the page when a value actually changes (keeps things fast).
function setText(id, text) {
  if (lastText[id] !== text) { $(id).textContent = text; lastText[id] = text; }
}

// The compass is a long strip of letters and numbers, slid left/right as you turn.
const PX_PER_DEGREE = 3;
export function buildCompass() {
  const strip = $('compassStrip');
  const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  let html = '';
  for (let d = -360; d <= 720; d += 15) {
    const deg = ((d % 360) + 360) % 360;
    const label = names[deg];
    const cls = label ? (label.length === 1 ? 'major' : '') : 'tick';
    html += `<span class="${cls}" style="left:${d * PX_PER_DEGREE}px">${label || (deg % 45 === 0 ? deg : '·')}</span>`;
  }
  strip.innerHTML = html;
}

let frames = 0, fpsTime = 0;
export function updateHud(dt, player, cam) {
  const P = SETTINGS.player;
  setText('healthNum', String(Math.ceil(player.health)));
  setText('shieldNum', String(Math.ceil(player.shield)));
  $('healthFill').style.width = (player.health / P.maxHealth) * 100 + '%';
  $('shieldFill').style.width = (player.shield / P.maxShield) * 100 + '%';
  setText('matWood', String(player.materials.wood));
  setText('matStone', String(player.materials.stone));
  setText('matMetal', String(player.materials.metal));

  $('compassStrip').style.transform = `translateX(${-cam.heading * PX_PER_DEGREE}px)`;

  frames++; fpsTime += dt;
  if (fpsTime >= 0.5) { setText('fps', Math.round(frames / fpsTime) + ' FPS'); frames = 0; fpsTime = 0; }
}
