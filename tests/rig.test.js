import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BufferAttribute, BufferGeometry, Group, Mesh, Vector3 } from 'three';
import { ANTENNA_BONES, createHeadRig, JOINTS } from '../src/model/rig.js';

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

/** A curved tube rising from the antenna joint, like the real antenna. */
function antennaHead() {
  const head = new Group();
  const [bx, by, bz] = JOINTS.antenna_l;
  const positions = [];
  const indices = [];
  const RINGS = 40;
  for (let ring = 0; ring < RINGS; ring++) {
    const t = ring / (RINGS - 1);
    for (let side = 0; side < 6; side++) {
      const angle = (side / 6) * Math.PI * 2;
      positions.push(bx + t * 2 + 0.03 * Math.cos(angle), by + t * 3 + t * t * 0.4, bz - t * 1.5 + 0.03 * Math.sin(angle));
      if (ring) indices.push((ring - 1) * 6 + side, ring * 6 + side, ring * 6 + ((side + 1) % 6));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  const mesh = new Mesh(geometry);
  mesh.name = 'antenna_l';
  head.add(mesh);
  head.updateMatrixWorld(true);
  return head;
}

/** World position of a vertex after skinning. */
function skinnedVertex(mesh, index) {
  mesh.parent.updateWorldMatrix(true, true); // the bones are siblings of the mesh
  mesh.skeleton.update();
  const point = new Vector3();
  mesh.getVertexPosition(index, point);
  return point.applyMatrix4(mesh.matrixWorld);
}

describe('antenna skeleton', () => {
  it('turns the antenna into a skinned mesh with a chain of bones', () => {
    const head = antennaHead();
    const rig = createHeadRig(head);
    const mesh = head.getObjectByName('antenna_l');
    expect(mesh.isSkinnedMesh).toBe(true);
    expect(rig.antennae.antenna_l.length).toBe(ANTENNA_BONES);
  });

  it('keeps every vertex in place at rest', () => {
    const head = antennaHead();
    const before = head.getObjectByName('antenna_l').geometry.attributes.position.clone();
    createHeadRig(head);
    const mesh = head.getObjectByName('antenna_l');
    for (let i = 0; i < before.count; i += 7) {
      expect(skinnedVertex(mesh, i).distanceTo(new Vector3().fromBufferAttribute(before, i))).toBeLessThan(1e-4);
    }
  });

  it('gives every vertex weights that add up to 1', () => {
    const head = antennaHead();
    createHeadRig(head);
    const { skinWeight } = head.getObjectByName('antenna_l').geometry.attributes;
    for (let i = 0; i < skinWeight.count; i++) {
      expect(skinWeight.getX(i) + skinWeight.getY(i) + skinWeight.getZ(i) + skinWeight.getW(i)).toBeCloseTo(1, 5);
    }
  });

  it('bends: the tip moves far more than the base, and the bend stays smooth along the antenna', () => {
    const head = antennaHead();
    const rig = createHeadRig(head);
    const mesh = head.getObjectByName('antenna_l');
    const count = mesh.geometry.attributes.position.count;
    const rest = [];
    for (let i = 0; i < count; i += 6) rest.push(skinnedVertex(mesh, i));
    rig.antennae.antenna_l.forEach((bone) => (bone.rotation.z = 0.05));
    const moved = rest.map((point, ring) => skinnedVertex(mesh, ring * 6).distanceTo(point));
    expect(moved[0]).toBeLessThan(0.02);
    expect(moved.at(-1)).toBeGreaterThan(moved[0] + 0.3);
    for (let ring = 1; ring < moved.length; ring++) expect(Math.abs(moved[ring] - moved[ring - 1])).toBeLessThan(0.08);
  });

  it('follows the head and the antenna joint', () => {
    const head = antennaHead();
    const rig = createHeadRig(head);
    const mesh = head.getObjectByName('antenna_l');
    const tip = skinnedVertex(mesh, mesh.geometry.attributes.position.count - 1);
    rig.joints.head.rotation.y = 0.4;
    expect(skinnedVertex(mesh, mesh.geometry.attributes.position.count - 1).distanceTo(tip)).toBeGreaterThan(0.2);
  });

  it('leaves tiny placeholder meshes as plain meshes', () => {
    const head = fakeHead();
    const rig = createHeadRig(head);
    expect(part(head, 'antenna_l').isSkinnedMesh).toBeFalsy();
    expect(rig.antennae.antenna_l).toBeUndefined();
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
