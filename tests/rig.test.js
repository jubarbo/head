import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BufferAttribute, BufferGeometry, Group, Mesh, Vector3 } from 'three';
import { createHeadRig, JOINTS } from '../src/model/rig.js';

const PARTS = [
  'head_capsule', 'eye_l', 'eye_r', 'antenna_l', 'antenna_r', 'mandible_l', 'mandible_r',
  'maxillary_palp_l', 'maxillary_palp_r', 'labial_palp_l', 'labial_palp_r', 'neck',
];

/** A head with one small triangle per part, offset from the origin like the GLB nodes. */
function fakeHead() {
  const head = new Group();
  PARTS.forEach((name, index) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    const mesh = new Mesh(geometry);
    mesh.name = name;
    mesh.position.set(index * 0.1, 1 - index * 0.2, 0.5);
    head.add(mesh);
  });
  head.updateMatrixWorld(true);
  return head;
}

const worldVertex = (mesh, index = 1) => {
  mesh.updateWorldMatrix(true, false);
  return new Vector3().fromBufferAttribute(mesh.geometry.attributes.position, index).applyMatrix4(mesh.matrixWorld);
};
const part = (head, name) => head.getObjectByName(name);

describe('head rig', () => {
  it('keeps every part exactly where it was at the rest pose', () => {
    const head = fakeHead();
    const before = PARTS.map((name) => worldVertex(part(head, name)));
    createHeadRig(head);
    PARTS.forEach((name, i) => expect(worldVertex(part(head, name)).distanceTo(before[i])).toBeLessThan(1e-6));
  });

  it('rotates the head around its neck joint, carrying the face and leaving the neck fixed', () => {
    const head = fakeHead();
    const rig = createHeadRig(head);
    const neck = worldVertex(part(head, 'neck'));
    const eye = worldVertex(part(head, 'eye_l'));
    const pivot = rig.joints.head.getWorldPosition(new Vector3());
    rig.joints.head.rotation.y = 0.5;
    expect(worldVertex(part(head, 'neck')).distanceTo(neck)).toBeLessThan(1e-6);
    expect(worldVertex(part(head, 'eye_l')).distanceTo(eye)).toBeGreaterThan(0.01);
    expect(worldVertex(part(head, 'eye_l')).distanceTo(pivot)).toBeCloseTo(eye.distanceTo(pivot), 5);
  });

  it('turns an appendage around its own base, and it follows the head', () => {
    const head = fakeHead();
    const rig = createHeadRig(head);
    const mandible = part(head, 'mandible_l');
    const tip = worldVertex(mandible);
    const pivot = rig.joints.mandible_l.getWorldPosition(new Vector3());
    expect(pivot.distanceTo(new Vector3(...JOINTS.mandible_l))).toBeLessThan(1e-6);
    rig.joints.mandible_l.rotation.z = 0.3;
    expect(worldVertex(mandible).distanceTo(tip)).toBeGreaterThan(0.01);
    expect(worldVertex(mandible).distanceTo(pivot)).toBeCloseTo(tip.distanceTo(pivot), 5);
    const before = worldVertex(mandible);
    rig.joints.head.rotation.x = 0.3;
    expect(worldVertex(mandible).distanceTo(before)).toBeGreaterThan(0.01);
  });

  it('mirrors the right side joints', () => {
    expect(JOINTS.antenna_r).toEqual([-JOINTS.antenna_l[0], JOINTS.antenna_l[1], JOINTS.antenna_l[2]]);
  });

  it('stores each vertex rest position, which stays put when the part moves', () => {
    const head = fakeHead();
    const rig = createHeadRig(head);
    const mesh = part(head, 'eye_l');
    const expected = worldVertex(mesh);
    rig.joints.head.rotation.y = 0.7;
    const rest = new Vector3().fromBufferAttribute(mesh.geometry.attributes.aRestPosition, 1);
    expect(rest.distanceTo(expected)).toBeLessThan(1e-6);
  });

  it('works on the placeholder or a partial model: missing parts are skipped', () => {
    const head = new Group();
    expect(() => createHeadRig(head)).not.toThrow();
  });
});

describe('rig joints on the real model', () => {
  const bytes = readFileSync(new URL('../public/models/mantis-head.glb', import.meta.url));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));

  it.each(Object.keys(JOINTS).filter((name) => name !== 'head'))('%s joint sits on its part', (name) => {
    const node = gltf.nodes.find((candidate) => candidate.name === name);
    const accessor = gltf.accessors[gltf.meshes[node.mesh].primitives[0].attributes.POSITION];
    JOINTS[name].forEach((value, axis) => {
      const low = (accessor.min[axis] / 32767) * node.scale[axis] + node.translation[axis];
      const high = (accessor.max[axis] / 32767) * node.scale[axis] + node.translation[axis];
      expect(value).toBeGreaterThanOrEqual(low - 0.05);
      expect(value).toBeLessThanOrEqual(high + 0.05);
    });
  });
});
