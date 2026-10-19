/* =====================================================================
   INPUT
   Keeps track of keys and mouse buttons, plus how far the mouse moved
   this frame. Uses "pointer lock": while playing, the cursor is hidden
   and the mouse turns the camera (like any shooter game).
   ===================================================================== */
export const input = {
  keys: new Set(),        // keys held down right now (e.g. 'KeyW')
  pressed: new Set(),     // keys pressed down during this frame only
  buttons: new Set(),     // mouse buttons held (0 = left, 2 = right)
  mouseDX: 0,             // mouse movement since last frame
  mouseDY: 0,
  wheel: 0,               // scroll wheel since last frame (+1 / -1)
  canvas: null,
};

// Keys the browser would otherwise use for something else (scrolling, menus).
const BLOCKED = ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft'];

export function initInput(canvas) {
  input.canvas = canvas;

  window.addEventListener('keydown', (e) => {
    if (BLOCKED.includes(e.code)) e.preventDefault();
    if (!e.repeat) input.pressed.add(e.code);
    input.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  // Forget everything when the window loses focus, so nothing gets "stuck".
  window.addEventListener('blur', () => { input.keys.clear(); input.buttons.clear(); });

  window.addEventListener('mousemove', (e) => {
    if (!isLocked()) return;
    input.mouseDX += e.movementX;
    input.mouseDY += e.movementY;
  });
  canvas.addEventListener('mousedown', (e) => input.buttons.add(e.button));
  window.addEventListener('mouseup', (e) => input.buttons.delete(e.button));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => { input.wheel += Math.sign(e.deltaY); }, { passive: true });
}

// Call once at the end of every frame.
export function endInputFrame() {
  input.pressed.clear();
  input.mouseDX = 0;
  input.mouseDY = 0;
  input.wheel = 0;
}

export const isLocked = () => document.pointerLockElement === input.canvas;

// Ask the browser to hide the cursor and capture the mouse.
// Browsers refuse this sometimes (e.g. right after pressing Esc), so never let it crash the game.
export async function lockPointer() {
  try { await input.canvas.requestPointerLock(); return true; }
  catch (e) { return false; }
}
