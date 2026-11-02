// @ts-check
import { Bone, BufferAttribute, Group, Mesh, Skeleton, SkinnedMesh, Vector3 } from 'three';

/** @param {readonly number[]} point @returns {number[]} */
const mirrored = ([x, y, z]) => [-x, y, z];

const LEFT_JOINTS = {
  antenna_l: [0.48, 1.15, 0.75], // ANTENNA_SOCKET_XY in build_head.py
  mandible_l: [0.34, -1.05, 0.98], // MANDIBLE[0]
  maxillary_palp_l: [0.5, -0.5, 0.82], // MAXILLARY_PALP[0]
  labial_palp_l: [0.16, -1.35, 0.82], // LABIAL_PALP[0]
};

/**
 * Articulation points in the head's frame. The GLB keeps its origins at the mesh centers because the
 * baked maps depend on its object space, so the pivots are built here and the file stays unchanged.
 * @type {Record<string, number[]>}
 */
export const JOINTS = {
  head: [0, 0.1, -0.5], // NECK[0]: the top of the neck
  ...LEFT_JOINTS,
  ...Object.fromEntries(Object.entries(LEFT_JOINTS).map(([name, point]) => [name.replace(/_l$/, '_r'), mirrored(point)])),
};

/** Bones per antenna: enough for a smooth curve over its ~5 cm. */
export const ANTENNA_BONES = 8;
const MIN_SKINNED_VERTICES = 30; // anything smaller is not a real antenna (test doubles, placeholders)

/** The neck stays on the body; everything else belongs to the head. */
const FIXED_PARTS = new Set(['neck']);

/**
 * Stores each vertex's rest position in world space. The skin → metal front reads it, so the front
 * stays on the surface instead of sliding across a part that moves.
 * @param {Mesh} mesh
 */
function storeRestPosition(mesh) {
  const { position } = mesh.geometry.attributes;
  const rest = new Float32Array(position.count * 3);
  const vertex = new Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).toArray(rest, i * 3);
  }
  mesh.geometry.setAttribute('aRestPosition', new BufferAttribute(rest, 3));
}

/**
 * Replaces an antenna by a skinned mesh, with its chain of bones built from the mesh itself: the GLB
 * ships it as one rigid part, and a new export would invalidate the baked maps. Bones sit at the
 * vertex centroid of even steps of distance from the joint; each vertex blends the two nearest bones.
 * @param {Mesh} mesh must already hold `aRestPosition`
 * @param {Group} joint
 * @returns {Bone[] | null} null when the mesh is too small to be an antenna
 */
function skinAntenna(mesh, joint) {
  const { aRestPosition: rest } = mesh.geometry.attributes;
  if (rest.count < MIN_SKINNED_VERTICES) return null;
  const base = joint.getWorldPosition(new Vector3());
  const vertex = new Vector3();
  const distances = new Float32Array(rest.count);
  let reach = 0;
  for (let i = 0; i < rest.count; i++) {
    distances[i] = vertex.fromBufferAttribute(rest, i).distanceTo(base);
    reach = Math.max(reach, distances[i]);
  }
  const step = reach / ANTENNA_BONES;

  const centers = Array.from({ length: ANTENNA_BONES }, () => ({ sum: new Vector3(), count: 0 }));
  const skinIndex = new Uint16Array(rest.count * 4);
  const skinWeight = new Float32Array(rest.count * 4);
  for (let i = 0; i < rest.count; i++) {
    const along = distances[i] / step;
    const nearest = Math.min(ANTENNA_BONES - 1, Math.round(along));
    centers[nearest].sum.add(vertex.fromBufferAttribute(rest, i));
    centers[nearest].count++;
    const lower = Math.max(0, Math.floor(along - 0.5));
    const upper = Math.min(ANTENNA_BONES - 1, lower + 1);
    const blend = Math.min(1, Math.max(0, along - 0.5 - lower));
    skinIndex.set([lower, upper], i * 4);
    skinWeight.set([1 - blend, blend], i * 4);
  }

  /** @type {Bone[]} */
  const bones = [];
  const previous = base.clone();
  for (const [index, center] of centers.entries()) {
    const position = index === 0 || center.count === 0 ? previous.clone() : center.sum.divideScalar(center.count);
    const bone = new Bone();
    bone.name = `${mesh.name}_bone_${index}`;
    (bones[index - 1] ?? joint).add(bone);
    bone.position.copy(index === 0 ? new Vector3() : position.clone().sub(previous));
    previous.copy(position);
    bones.push(bone);
  }

  mesh.geometry.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
  mesh.geometry.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  const skinned = new SkinnedMesh(mesh.geometry, mesh.material);
  skinned.name = mesh.name;
  skinned.castShadow = mesh.castShadow;
  skinned.receiveShadow = mesh.receiveShadow;
  skinned.frustumCulled = false; // the bounds of the rest pose do not cover a bent antenna
  skinned.position.copy(mesh.position);
  skinned.quaternion.copy(mesh.quaternion);
  skinned.scale.copy(mesh.scale);
  joint.remove(mesh);
  joint.add(skinned);
  joint.updateWorldMatrix(true, true);
  skinned.bind(new Skeleton(bones), skinned.matrixWorld);
  return bones;
}

/**
 * Inserts pivot groups into the loaded head without moving anything at rest. Rotating `joints.head`
 * turns the face around the neck; rotating an appendage's joint turns it around its base, and the
 * antenna bones bend each antenna along its length.
 * Parts the model lacks are skipped.
 * @param {import('three').Object3D} head
 * @returns {{ joints: Record<string, Group>, antennae: Record<string, Bone[]> }}
 */
export function createHeadRig(head) {
  head.updateWorldMatrix(true, true);
  const parts = [...head.children];
  for (const part of parts) {
    part.traverse((object) => {
      if (object instanceof Mesh) storeRestPosition(object);
    });
  }

  const pivot = (/** @type {string} */ name, /** @type {import('three').Object3D} */ parent) => {
    const joint = new Group();
    joint.name = `joint_${name}`;
    joint.position.fromArray(JOINTS[name]); // given in the head's frame, whatever the parent is
    head.add(joint);
    joint.updateWorldMatrix(true, false);
    parent.attach(joint);
    return joint;
  };

  const headJoint = pivot('head', head);
  /** @type {Record<string, Group>} */
  const joints = { head: headJoint };
  for (const part of parts) {
    if (!FIXED_PARTS.has(part.name)) headJoint.attach(part);
  }
  for (const name of Object.keys(JOINTS)) {
    const part = name === 'head' ? null : head.getObjectByName(name);
    if (!part) continue;
    joints[name] = pivot(name, headJoint);
    joints[name].attach(part);
  }
  /** @type {Record<string, Bone[]>} */
  const antennae = {};
  for (const name of ['antenna_l', 'antenna_r']) {
    const mesh = head.getObjectByName(name);
    const bones = mesh instanceof Mesh ? skinAntenna(mesh, joints[name]) : null;
    if (bones) antennae[name] = bones;
  }
  return { joints, antennae };
}
