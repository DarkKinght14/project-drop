/* =====================================================================
   SKY, SUN, WATER & CLOUDS
   ===================================================================== */
import * as THREE from 'three';
import { SETTINGS } from '../settings.js';

const SKY_TOP = new THREE.Color('#3d8bff');
const SKY_HORIZON = new THREE.Color('#bfe4ff');

export function buildSky(scene, rng) {
  // A giant ball around the world, colored from deep blue (top) to pale blue (horizon).
  const skyGeo = new THREE.SphereGeometry(900, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON } },
    vertexShader: `varying float vHeight;
      void main() { vHeight = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying float vHeight;
      void main() { gl_FragColor = vec4(mix(horizon, top, pow(max(vHeight, 0.0), 0.6)), 1.0); }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
  scene.fog = new THREE.Fog(SKY_HORIZON, SETTINGS.graphics.fogNear, SETTINGS.graphics.fogFar);

  // Soft light from the sky above and the grass below, plus the sun for shadows.
  scene.add(new THREE.HemisphereLight('#cfe8ff', '#5d7d3f', 1.6));
  const sun = new THREE.DirectionalLight('#fff3dc', 2.6);
  sun.position.set(80, 140, 60);
  if (SETTINGS.graphics.shadows) {
    sun.castShadow = true;
    const r = SETTINGS.graphics.shadowRange;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 10, far: 400 });
    sun.shadow.mapSize.set(SETTINGS.graphics.shadowMapSize, SETTINGS.graphics.shadowMapSize);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
  }
  scene.add(sun, sun.target);
  const sunOffset = sun.position.clone();

  // The sea: one big see-through blue plane.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshPhongMaterial({ color: '#2f9be8', transparent: true, opacity: 0.82, shininess: 90, specular: '#bfe8ff' }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = SETTINGS.world.waterLevel;
  water.receiveShadow = true;
  scene.add(water);

  // Puffy low-poly clouds drifting slowly.
  const clouds = new THREE.Group();
  const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, emissive: '#dfefff', emissiveIntensity: 0.35 });
  const puff = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 26; i++) {
    const cloud = new THREE.Group();
    const parts = 3 + Math.floor(rng() * 4);
    for (let p = 0; p < parts; p++) {
      const m = new THREE.Mesh(puff, cloudMat);
      const s = 6 + rng() * 8;
      m.scale.set(s * 1.4, s * 0.7, s);
      m.position.set(p * 9 - parts * 4, rng() * 3, (rng() - 0.5) * 8);
      cloud.add(m);
    }
    const angle = rng() * Math.PI * 2, dist = 80 + rng() * 380;
    cloud.position.set(Math.cos(angle) * dist, 95 + rng() * 45, Math.sin(angle) * dist);
    clouds.add(cloud);
  }
  scene.add(clouds);

  return {
    // Keep the sun's shadow area centered on the player, and drift the clouds.
    update(dt, focus) {
      sun.position.copy(focus).add(sunOffset);
      sun.target.position.copy(focus);
      sky.position.copy(focus).setY(0);
      for (const cloud of clouds.children) {
        cloud.position.x += dt * 1.5;
        if (cloud.position.x > 500) cloud.position.x = -500;
      }
    },
  };
}
