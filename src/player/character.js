/* =====================================================================
   CHARACTER MODEL
   A cartoon character built from simple shapes. Arms and legs hang from
   "pivots" (joints), so we can swing them to make a walking animation.
   The model faces +Z; the player code turns it to face the camera.
   Each body part (both legs, both arms, the body) is baked into one shape
   (core/bake.js), so a character costs only 5 draw calls.
   ===================================================================== */
import * as THREE from 'three';
import { bakeGeometry, bakedMaterial } from '../core/bake.js';

const materials = new Map();
const mat = (color) => {
  if (!materials.has(color)) materials.set(color, new THREE.MeshBasicMaterial({ color }));
  return materials.get(color);
};

// Our own original outfit: "Scout", in an orange jacket and teal beanie.
export const OUTFIT = {
  skin: '#f1c27d', jacket: '#ff8a2a', pants: '#2b3550', shoes: '#f4f4f4',
  beanie: '#18c2b4', backpack: '#3f7f47',
};

function part(geometry, color, x, y, z) {
  const mesh = new THREE.Mesh(geometry, mat(color));
  mesh.position.set(x, y, z);
  return mesh;
}

// Merge the meshes directly inside a joint into one (keeping child joints, like the arms).
// Shapes are remembered per outfit, so characters wearing the same outfit share them.
const bakedParts = new Map();
function bakeJoint(joint, key) {
  const meshes = joint.children.filter((c) => c.isMesh);
  if (!bakedParts.has(key)) {
    const temp = new THREE.Group();
    for (const m of meshes) temp.add(m.clone());
    bakedParts.set(key, bakeGeometry(temp));
  }
  for (const m of meshes) joint.remove(m);
  const baked = new THREE.Mesh(bakedParts.get(key), bakedMaterial);
  baked.castShadow = true;
  joint.add(baked);
  return baked;
}

export function createCharacter(outfit = OUTFIT) {
  const root = new THREE.Group();   // stands on the ground at y = 0
  const body = new THREE.Group();   // everything above the hips (moves down when crouching)
  root.add(body);

  // Legs: each leg hangs from a hip joint at 0.85 m
  const legGeo = new THREE.BoxGeometry(0.22, 0.75, 0.24);
  const shoeGeo = new THREE.BoxGeometry(0.24, 0.12, 0.34);
  const legs = [-0.13, 0.13].map((x) => {
    const hip = new THREE.Group();
    hip.position.set(x, 0.85, 0);
    hip.add(part(legGeo, outfit.pants, 0, -0.4, 0));
    hip.add(part(shoeGeo, outfit.shoes, 0, -0.8, 0.05));
    root.add(hip);
    return hip;
  });

  // Torso, head and beanie
  body.add(part(new THREE.BoxGeometry(0.56, 0.62, 0.32), outfit.jacket, 0, 1.15, 0));
  body.add(part(new THREE.BoxGeometry(0.58, 0.08, 0.34), outfit.pants, 0, 0.86, 0)); // belt
  body.add(part(new THREE.SphereGeometry(0.2, 12, 10), outfit.skin, 0, 1.64, 0));
  body.add(part(new THREE.SphereGeometry(0.215, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), outfit.beanie, 0, 1.68, 0));
  body.add(part(new THREE.BoxGeometry(0.05, 0.05, 0.02), '#222222', -0.07, 1.66, 0.19)); // eyes
  body.add(part(new THREE.BoxGeometry(0.05, 0.05, 0.02), '#222222', 0.07, 1.66, 0.19));
  body.add(part(new THREE.BoxGeometry(0.4, 0.46, 0.2), outfit.backpack, 0, 1.15, -0.25));

  // Arms: each arm hangs from a shoulder joint
  const armGeo = new THREE.BoxGeometry(0.16, 0.6, 0.18);
  const handGeo = new THREE.BoxGeometry(0.15, 0.14, 0.16);
  const arms = [-0.37, 0.37].map((x) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(x, 1.4, 0);
    shoulder.add(part(armGeo, outfit.jacket, 0, -0.28, 0));
    shoulder.add(part(handGeo, outfit.skin, 0, -0.62, 0));
    body.add(shoulder);
    return shoulder;
  });

  // Whatever you hold goes in the right hand. The hand's "forward" points
  // down the arm, so a held gun points wherever the arm points.
  // (The model faces +Z, so its right side is -X: arms[0] is the right arm.)
  const [rightArm, leftArm] = arms;
  const hand = new THREE.Group();
  hand.position.set(0, -0.62, 0.02);
  rightArm.add(hand);

  // Bake every joint's pieces into one mesh each
  const key = JSON.stringify(outfit);
  const parts = [
    bakeJoint(legs[0], key + 'leg'), bakeJoint(legs[1], key + 'leg'),
    bakeJoint(rightArm, key + 'arm'), bakeJoint(leftArm, key + 'arm'),
    bakeJoint(body, key + 'body'),
  ];

  let phase = 0;
  return {
    root,
    hand,
    // Far-away characters skip shadows (faster)
    setShadows(on) { for (const p of parts) p.castShadow = on; },
    // speed: how fast we're moving; grounded: on the floor?; crouch: 0..1
    // pose: 'none' | 'gun' | 'item' | 'pick'; pitch: where the camera looks (up/down);
    // action: 0..1 for a pickaxe swing or a little kick when a gun fires
    animate(dt, speed, grounded, crouch, pose = 'none', pitch = 0, action = 0) {
      const swing = grounded ? Math.min(1, speed / 6) : 0;
      phase += dt * (4 + speed * 1.3);
      const s = Math.sin(phase) * 0.75 * swing;
      legs[0].rotation.x = grounded ? s : 0.5;
      legs[1].rotation.x = grounded ? -s : -0.3;
      rightArm.rotation.z = leftArm.rotation.z = 0;
      if (pose === 'gun') {
        // Both arms point the gun where you aim; the left hand reaches across to hold it
        rightArm.rotation.x = -Math.PI / 2 - pitch - action * 0.25;
        leftArm.rotation.x = -Math.PI / 2 - pitch + 0.1;
        leftArm.rotation.z = -0.9;
      } else if (pose === 'pick') {
        // Swing: lift the pickaxe up high, then chop down
        const chop = action > 0 ? Math.sin(action * Math.PI) : 0;
        rightArm.rotation.x = -0.5 - chop * 1.9 + s * 0.3;
        leftArm.rotation.x = s * 0.8;
      } else if (pose === 'drink') {
        // Lift the item up to the face, with a little bob while using it
        rightArm.rotation.x = -2.5 + Math.sin(action * Math.PI * 8) * 0.12;
        rightArm.rotation.z = 0.45;
        leftArm.rotation.x = -0.4;
      } else if (pose === 'item') {
        rightArm.rotation.x = -1.1;
        leftArm.rotation.x = -1.0;
        leftArm.rotation.z = -0.6;
      } else {
        arms[0].rotation.x = -s * 0.8;
        arms[1].rotation.x = s * 0.8;
      }
      // Crouching: drop the upper body and bend the legs
      body.position.y = -0.3 * crouch;
      legs[0].scale.y = legs[1].scale.y = 1 - 0.35 * crouch;
      legs[0].position.y = legs[1].position.y = 0.85 - 0.3 * crouch;
    },
  };
}
