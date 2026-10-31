// @ts-check
import * as THREE from 'three';

const SKIN = 0x8aa84b;
const EYE = 0x9cbc55;
const ANTENNA = 0xa8764a;

/**
 * Stand-in for the real GLB until T1/T2: a downward triangle head with lateral eyes and
 * antennae, so every preset view is recognizable. Scale: 1 unit = 1 cm (~3.5 units tall).
 */
export function createPlaceholderHead() {
  const group = new THREE.Group();
  group.name = 'placeholder-head';

  const headGeometry = new THREE.SphereGeometry(1, 64, 48);
  const pos = headGeometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const taper = 0.35 + 0.65 * ((y + 1) / 2); // narrow toward the mouth
    pos.setXYZ(i, pos.getX(i) * 1.6 * taper, y * 1.75, pos.getZ(i) * 0.8);
  }
  headGeometry.computeVertexNormals();

  const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.55 });
  const head = new THREE.Mesh(headGeometry, skin);
  group.add(head);

  const eyeMaterial = new THREE.MeshPhysicalMaterial({ color: EYE, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.8, 48, 32), eyeMaterial);
    eye.scale.set(0.85, 1.15, 0.9);
    eye.position.set(side * 1.55, 0.75, 0.15);
    group.add(eye);

    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.05, 4.5, 8),
      new THREE.MeshStandardMaterial({ color: ANTENNA, roughness: 0.6 }),
    );
    antenna.geometry.translate(0, 2.25, 0);
    antenna.position.set(side * 0.35, 1.45, 0.35);
    antenna.rotation.set(-0.35, 0, -side * 0.45);
    group.add(antenna);
  }

  group.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = true;
  });
  return group;
}
