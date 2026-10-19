/* =====================================================================
   CHARACTER MODEL
   A cartoon character built from simple shapes. Arms and legs hang from
   "pivots" (joints), so we can swing them to make a walking animation.
   The model faces +Z; the player code turns it to face the camera.
   ===================================================================== */
import * as THREE from 'three';

const mat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

// Our own original outfit: "Scout", in an orange jacket and teal beanie.
export const OUTFIT = {
  skin: '#f1c27d', jacket: '#ff8a2a', pants: '#2b3550', shoes: '#f4f4f4',
  beanie: '#18c2b4', backpack: '#3f7f47',
};

function part(geometry, color, x, y, z) {
  const mesh = new THREE.Mesh(geometry, mat(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
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

  let phase = 0;
  return {
    root,
    // speed: how fast we're moving; grounded: on the floor?; crouch: 0..1
    animate(dt, speed, grounded, crouch) {
      const swing = grounded ? Math.min(1, speed / 6) : 0;
      phase += dt * (4 + speed * 1.3);
      const s = Math.sin(phase) * 0.75 * swing;
      legs[0].rotation.x = grounded ? s : 0.5;
      legs[1].rotation.x = grounded ? -s : -0.3;
      arms[0].rotation.x = -s * 0.8;
      arms[1].rotation.x = s * 0.8;
      // Crouching: drop the upper body and bend the legs
      body.position.y = -0.3 * crouch;
      legs[0].scale.y = legs[1].scale.y = 1 - 0.35 * crouch;
      legs[0].position.y = legs[1].position.y = 0.85 - 0.3 * crouch;
    },
  };
}
