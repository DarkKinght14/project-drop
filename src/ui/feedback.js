/* =====================================================================
   HIT FEEDBACK
   Floating damage numbers (white = health, blue = shield, yellow =
   headshot) that pop up where you hit, and the "hit marker" X that
   flashes on the crosshair.
   ===================================================================== */
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const POOL = 24;
const LIFE = 0.9;

export class Feedback {
  constructor() {
    this.layer = $('damageLayer');
    this.marker = $('hitMarker');
    this.numbers = [];
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'dmg';
      el.hidden = true;
      this.layer.appendChild(el);
      this.numbers.push({ el, pos: new THREE.Vector3(), life: 0, drift: 0 });
    }
    this.next = 0;
    this.markerTimer = 0;
    this.v = new THREE.Vector3();
  }

  // kind: 'health' | 'shield' | 'head'
  number(position, amount, kind) {
    const n = this.numbers[this.next];
    this.next = (this.next + 1) % POOL;
    n.pos.copy(position);
    n.life = LIFE;
    n.drift = (Math.random() - 0.5) * 40;
    n.el.textContent = String(Math.round(amount));
    n.el.className = 'dmg ' + kind;
    n.el.hidden = false;
  }

  hitMarker(head, killed) {
    this.marker.className = 'hit-marker show' + (head ? ' head' : '') + (killed ? ' kill' : '');
    this.markerTimer = killed ? 0.35 : 0.15;
  }

  update(dt, camera) {
    if (this.markerTimer > 0) {
      this.markerTimer -= dt;
      if (this.markerTimer <= 0) this.marker.className = 'hit-marker';
    }
    const w = window.innerWidth, h = window.innerHeight;
    for (const n of this.numbers) {
      if (n.life <= 0) continue;
      n.life -= dt;
      // Project the 3D point onto the screen
      this.v.copy(n.pos).project(camera);
      const visible = n.life > 0 && this.v.z < 1;
      n.el.hidden = !visible;
      if (!visible) continue;
      const age = 1 - n.life / LIFE;
      const x = (this.v.x * 0.5 + 0.5) * w + n.drift * age;
      const y = (-this.v.y * 0.5 + 0.5) * h - 50 * age;
      const pop = age < 0.12 ? 1.5 - age * 4 : 1;
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${pop})`;
      n.el.style.opacity = String(Math.min(1, n.life / 0.3));
    }
  }
}
