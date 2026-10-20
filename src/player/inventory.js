/* =====================================================================
   INVENTORY
   Slot 0 is always the pickaxe. Slots 1-5 hold weapons or healing items
   (keys 2-6, or the mouse wheel). Ammo is kept separately, in a "pouch"
   with one counter per ammo type.
   ===================================================================== */
import { SETTINGS } from '../settings.js';

export const ITEM_SLOTS = 5;

export class Inventory {
  constructor() { this.reset(); }

  reset() {
    this.slots = new Array(ITEM_SLOTS).fill(null);
    this.selected = 0; // 0 = pickaxe, 1..5 = slots[0..4]
    this.ammo = Object.fromEntries(Object.keys(SETTINGS.ammo).map((k) => [k, 0]));
  }

  // The item in your hands (null means the pickaxe)
  get current() { return this.selected === 0 ? null : this.slots[this.selected - 1]; }

  select(index) {
    this.selected = Math.max(0, Math.min(ITEM_SLOTS, index));
  }

  // Mouse wheel: step to the next / previous slot, skipping empty ones.
  cycle(direction) {
    for (let step = 1; step <= ITEM_SLOTS + 1; step++) {
      const i = (((this.selected + direction * step) % (ITEM_SLOTS + 1)) + ITEM_SLOTS + 1) % (ITEM_SLOTS + 1);
      if (i === 0 || this.slots[i - 1]) { this.selected = i; return; }
    }
  }

  addAmmo(type, count) {
    const room = SETTINGS.ammo[type].max - this.ammo[type];
    const taken = Math.min(room, count);
    this.ammo[type] += taken;
    return count - taken; // what didn't fit
  }

  // Tries to put an item in the hotbar. Returns what's left over (null if it all fit).
  add(item) {
    if (item.kind === 'ammo') {
      const left = this.addAmmo(item.type, item.count);
      return left > 0 ? { ...item, count: left } : null;
    }
    if (item.kind === 'heal') {
      const stack = SETTINGS.heals[item.type].stack;
      let count = item.count;
      for (const s of this.slots) {
        if (s && s.kind === 'heal' && s.type === item.type && s.count < stack) {
          const moved = Math.min(stack - s.count, count);
          s.count += moved;
          count -= moved;
          if (count === 0) return null;
        }
      }
      item = { ...item, count };
    }
    const empty = this.slots.indexOf(null);
    if (empty === -1) return item;
    if (item.kind === 'heal' && item.count > SETTINGS.heals[item.type].stack) {
      this.slots[empty] = { ...item, count: SETTINGS.heals[item.type].stack };
      return this.add({ ...item, count: item.count - SETTINGS.heals[item.type].stack });
    }
    this.slots[empty] = item;
    return null;
  }

  // Hotbar full: swap the item in your hands for the new one. Returns the old item.
  swap(item) {
    if (this.selected === 0) return item; // can't drop the pickaxe
    const old = this.slots[this.selected - 1];
    this.slots[this.selected - 1] = item;
    return old;
  }

  // Take the item in your hands out of the hotbar (to drop it).
  removeCurrent() {
    if (this.selected === 0) return null;
    const item = this.slots[this.selected - 1];
    this.slots[this.selected - 1] = null;
    return item;
  }

  // Use up one healing item from the current slot.
  consumeCurrent() {
    const item = this.current;
    if (!item || item.kind !== 'heal') return;
    item.count -= 1;
    if (item.count <= 0) this.slots[this.selected - 1] = null;
  }
}
