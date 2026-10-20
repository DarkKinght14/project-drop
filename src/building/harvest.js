/* =====================================================================
   HARVESTING
   Hit trees (wood), rocks (stone) and cars (metal) with the pickaxe to
   collect building materials. Each hit gives some material and makes
   the thing shake; after enough hits it breaks and disappears.
   Everything comes back at the start of a new match.
   ===================================================================== */
import * as THREE from 'three';
import { SETTINGS } from '../settings.js';

const HV = SETTINGS.harvest;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class Harvest {
  constructor(world) {
    this.byCollider = new Map();
    this.list = [];
    this.shaking = new Set();
    const add = (type, data, hits) => {
      const r = {
        type, data, material: HV[type].material, maxHits: Math.max(2, Math.round(hits)), hits: 0, shake: 0,
        // remember each instanced copy's original position, to shake it and to bring it back later
        parts: data.parts.map((p) => {
          const m = new THREE.Matrix4();
          p.mesh.getMatrixAt(p.index, m);
          return { ...p, original: m };
        }),
      };
      r.position = new THREE.Vector3(data.x, data.y + 1, data.z);
      this.list.push(r);
      this.byCollider.set(data.collider.handle, r);
    };
    for (const t of world.trees) add('tree', t, HV.tree.hits * (0.7 + t.scale * 0.4));
    for (const r of world.rocks) add('rock', r, HV.rock.hits * (0.5 + r.size * 0.35));
    for (const c of world.cars) add('car', c, HV.car.hits);
    this.matrix = new THREE.Matrix4();
  }

  lookup(collider) { return this.byCollider.get(collider.handle); }

  // One pickaxe hit. Returns { material, gained, broke }.
  hit(resource, materials) {
    const room = HV.maxMaterial - materials[resource.material];
    const gained = Math.min(room, HV[resource.type].gain);
    materials[resource.material] += gained;
    resource.hits += 1;
    resource.shake = 0.3;
    this.shaking.add(resource);
    const broke = resource.hits >= resource.maxHits;
    if (broke) {
      this.shaking.delete(resource);
      for (const p of resource.parts) { p.mesh.setMatrixAt(p.index, ZERO); p.mesh.instanceMatrix.needsUpdate = true; }
      resource.data.collider.setEnabled(false);
    }
    return { material: resource.material, gained, broke };
  }

  update(dt) {
    for (const r of this.shaking) {
      r.shake -= dt;
      const done = r.shake <= 0;
      const wobble = done ? 0 : Math.sin(r.shake * 70) * 0.08 * (r.shake / 0.3);
      for (const p of r.parts) {
        this.matrix.makeTranslation(wobble, 0, wobble * 0.6).multiply(p.original);
        p.mesh.setMatrixAt(p.index, done ? p.original : this.matrix);
        p.mesh.instanceMatrix.needsUpdate = true;
      }
      if (done) this.shaking.delete(r);
    }
  }

  // A new match: everything grows back.
  reset() {
    for (const r of this.list) {
      if (r.hits === 0) continue;
      r.hits = 0;
      r.data.collider.setEnabled(true);
      for (const p of r.parts) { p.mesh.setMatrixAt(p.index, p.original); p.mesh.instanceMatrix.needsUpdate = true; }
    }
    this.shaking.clear();
  }
}
