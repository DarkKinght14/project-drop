/* =====================================================================
   HUD
   Copies the game's numbers onto the screen: health, shield, materials,
   the hotbar and ammo, prompts ("Pick up..."), the crosshair, the
   compass and the frames-per-second counter.
   ===================================================================== */
import { SETTINGS } from '../settings.js';
import { itemName, rarityColor } from '../loot/items.js';

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

// ---------- Hotbar ----------
function slotLabel(item) {
  if (item.kind === 'weapon') return SETTINGS.weapons[item.type].short;
  return SETTINGS.heals[item.type].short;
}
let hotbarKey = '';
function renderHotbar(inv) {
  // Build a short description of the hotbar; only redraw when it changes.
  const key = inv.selected + '|' + inv.slots.map((s) => (s ? `${s.type}${s.rarity}${s.count ?? ''}` : '-')).join(',');
  if (key === hotbarKey) return;
  hotbarKey = key;
  let html = `<div class="slot pick${inv.selected === 0 ? ' selected' : ''}"><span class="key">1</span><span class="label">Pickaxe</span></div>`;
  inv.slots.forEach((item, i) => {
    const selected = inv.selected === i + 1 ? ' selected' : '';
    if (!item) { html += `<div class="slot${selected}"><span class="key">${i + 2}</span></div>`; return; }
    const extra = item.kind === 'heal'
      ? `<span class="count">${item.count}</span><span class="swatch" style="--c:${SETTINGS.heals[item.type].color}"></span>`
      : `<span class="swatch" style="--c:${SETTINGS.ammo[SETTINGS.weapons[item.type].ammo].color}"></span>`;
    const label = slotLabel(item);
    html += `<div class="slot item${selected}" style="--r:${rarityColor(item)}"><span class="key">${i + 2}</span><span class="name${label.length > 5 ? ' long' : ''}">${label}</span>${extra}</div>`;
  });
  $('hotbar').innerHTML = html;
}

let backpackKey = '';
function renderBackpack(inv) {
  const key = inv.selected + JSON.stringify(inv.slots) + JSON.stringify(inv.ammo);
  if (key === backpackKey) return;
  backpackKey = key;
  $('backpackSlots').innerHTML = inv.slots.map((item, i) => {
    const sel = inv.selected === i + 1 ? ' class="selected"' : '';
    if (!item) return `<div${sel}><span>${i + 2}. Empty</span></div>`;
    const right = item.kind === 'heal' ? `×${item.count}` : `${item.mag} in the magazine`;
    return `<div${sel} style="--r:${rarityColor(item)}"><span>${i + 2}. ${itemName(item)}</span><span>${right}</span></div>`;
  }).join('');
  $('backpackAmmo').innerHTML = Object.entries(SETTINGS.ammo)
    .map(([type, a]) => `<div style="--c:${a.color}"><b>${inv.ammo[type]}</b>${a.name}</div>`).join('');
}

function show(id, visible) {
  const el = $(id);
  if (el.hidden === visible) el.hidden = !visible;
}

let frames = 0, fpsTime = 0;
// info: from weapons.hudInfo(); prompt: from loot.interact(); input: to check Tab
// build: from building.hudInfo()
export function updateHud(dt, player, cam, info, prompt, input, build) {
  const P = SETTINGS.player;
  const inv = player.inventory;
  renderHotbar(inv);

  // Ammo counter for the gun in your hands
  show('ammoInfo', !!info.ammo);
  if (info.ammo) {
    setText('ammoMag', String(info.ammo.mag));
    setText('ammoReserve', String(info.ammo.reserve));
    $('ammoInfo').classList.toggle('low', info.ammo.mag === 0);
  }

  // "Reloading..." / "Using bandages..." bar
  show('progress', !!info.progress);
  if (info.progress) {
    setText('progressLabel', info.progress.label);
    setText('progressTime', Math.max(0, info.progress.left).toFixed(1) + 's');
    $('progressFill').style.width = Math.min(100, info.progress.value * 100) + '%';
  }

  // "Pick up..." prompt
  show('prompt', !!prompt);
  if (prompt) {
    setText('promptText', prompt.text);
    $('promptText').style.color = prompt.color;
    $('prompt').classList.toggle('no-key', prompt.key === false);
    $('promptFill').style.width = (prompt.progress || 0) * 100 + '%';
  }

  show('toast', !!info.toast);
  if (info.toast) setText('toast', info.toast);

  // Build mode: the piece bar, and which material you're building with
  const building = build.active;
  $('hud').classList.toggle('building', building);
  show('buildBar', building);
  if (building) {
    const color = SETTINGS.building.materials[build.material].color;
    for (const el of document.querySelectorAll('.piece')) {
      el.classList.toggle('selected', el.dataset.piece === build.piece);
      el.style.setProperty('--mat', color);
    }
  }
  for (const m of ['wood', 'stone', 'metal']) {
    const el = document.querySelector('.mat.' + m);
    el.classList.toggle('current', building && build.material === m);
    el.classList.toggle('short', building && build.material === m && player.materials[m] < SETTINGS.building.cost);
  }

  // Crosshair: the gap shows how far bullets can stray
  const crosshair = $('crosshair');
  const gun = !!info.ammo && !building;
  crosshair.classList.toggle('build', building);
  crosshair.classList.toggle('dot', !gun && !building);
  if (building) crosshair.style.setProperty('--gap', '6px');
  crosshair.classList.toggle('hidden', info.scoped);
  if (gun) {
    const halfFov = (cam.camera.fov * Math.PI) / 360;
    const gap = 4 + (Math.tan((info.spread * Math.PI) / 180) / Math.tan(halfFov)) * (window.innerHeight / 2);
    crosshair.style.setProperty('--gap', Math.min(80, gap).toFixed(1) + 'px');
  }
  show('scope', info.scoped);
  $('hurt').style.opacity = String(Math.min(1, player.hurtTimer / 0.6));

  // Backpack: shown while Tab is held
  const backpackOpen = input.keys.has('Tab');
  show('backpack', backpackOpen);
  if (backpackOpen) renderBackpack(inv);

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
