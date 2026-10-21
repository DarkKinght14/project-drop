/* =====================================================================
   SHOOTING EFFECTS
   Bullet trails ("tracers"), the flash at the end of the barrel and the
   little sparks where a bullet hits. Everything is made once at the start
   and reused ("pooled"), so shooting never slows the game down.
   ===================================================================== */
import * as THREE from 'three';

const TRACERS = 30;
const SPARKS = 160;
const additive = (color, opacity) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
});

export class Effects {
  constructor(scene) {
    // Tracers: thin glowing sticks from the gun to where the bullet landed.
    const tracerGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5); // starts at 0, ends at z = 1
    this.tracers = [];
    for (let i = 0; i < TRACERS; i++) {
      const mesh = new THREE.Mesh(tracerGeo, additive('#ffe7a0', 0.9));
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0 });
    }
    this.nextTracer = 0;

    // Muzzle flashes: small bright stars that show for a split second (several, for bots too).
    const flashGeo = new THREE.OctahedronGeometry(0.12, 0), flashMat = additive('#fff1b0', 1);
    this.flashes = Array.from({ length: 8 }, () => {
      const mesh = new THREE.Mesh(flashGeo, flashMat);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, life: 0 };
    });
    this.nextFlash = 0;

    // Sparks: many tiny cubes drawn in one go (InstancedMesh).
    this.sparkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: '#ffffff' }), SPARKS);
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparks = Array.from({ length: SPARKS }, () => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0 }));
    this.nextSpark = 0;
    this.color = new THREE.Color();
    for (let i = 0; i < SPARKS; i++) this.sparkMesh.setColorAt(i, this.color.set('#ffffff'));
    scene.add(this.sparkMesh);
    this.matrix = new THREE.Matrix4();
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < SPARKS; i++) this.sparkMesh.setMatrixAt(i, this.zero);
  }

  tracer(from, to, width = 0.025) {
    const t = this.tracers[this.nextTracer];
    this.nextTracer = (this.nextTracer + 1) % TRACERS;
    const length = from.distanceTo(to);
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(width, width, length);
    t.mesh.visible = true;
    t.mesh.material.opacity = 0.9;
    t.life = 0.07;
  }

  muzzleFlash(position) {
    const f = this.flashes[this.nextFlash];
    this.nextFlash = (this.nextFlash + 1) % this.flashes.length;
    f.mesh.position.copy(position);
    f.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    f.mesh.scale.setScalar(0.8 + Math.random() * 0.6);
    f.mesh.visible = true;
    f.life = 0.05;
  }

  // A burst of sparks. color: '#ffd27a' for ground/walls, '#ff6040' for targets, etc.
  impact(point, color = '#ffd27a', count = 6) {
    for (let i = 0; i < count; i++) {
      const s = this.sparks[this.nextSpark];
      this.sparkMesh.setColorAt(this.nextSpark, this.color.set(color));
      this.nextSpark = (this.nextSpark + 1) % SPARKS;
      s.pos.copy(point);
      s.vel.set((Math.random() - 0.5) * 5, Math.random() * 4 + 1, (Math.random() - 0.5) * 5);
      s.life = 0.25 + Math.random() * 0.25;
    }
    this.sparkMesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) f.mesh.visible = false;
    }
    this.sparks.forEach((s, i) => {
      if (s.life <= 0) return;
      s.life -= dt;
      s.vel.y -= 14 * dt;
      s.pos.addScaledVector(s.vel, dt);
      if (s.life <= 0) this.sparkMesh.setMatrixAt(i, this.zero);
      else this.sparkMesh.setMatrixAt(i, this.matrix.makeTranslation(s.pos.x, s.pos.y, s.pos.z));
    });
    this.sparkMesh.instanceMatrix.needsUpdate = true;
  }
}
