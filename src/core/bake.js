/* =====================================================================
   BAKE
   Merges a group of small colored shapes into ONE shape with the colors
   painted onto its corners ("vertex colors"). The graphics card can then
   draw the whole model in one go instead of piece by piece, which is
   much faster (fewer "draw calls").
   ===================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// One material shared by every baked model.
export const bakedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

// Turn a group of meshes into one geometry. Glowing parts are painted brighter.
export function bakeGeometry(group) {
  group.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const parts = [];
  const color = new THREE.Color();
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    // Flat list of triangles (no shared corners), so every shape can be merged the same way
    const geo = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, obj.matrixWorld));
    color.copy(obj.material.color);
    if (obj.material.emissiveIntensity && obj.material.emissive?.getHex()) color.multiplyScalar(1 + obj.material.emissiveIntensity * 0.8);
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(name)) geo.deleteAttribute(name);
    parts.push(geo);
  });
  return mergeGeometries(parts);
}

export function bakeMesh(group, castShadow = true) {
  const mesh = new THREE.Mesh(bakeGeometry(group), bakedMaterial);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  return mesh;
}
