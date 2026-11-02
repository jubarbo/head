// @ts-check
import { BufferAttribute, Group, Mesh, Vector3 } from 'three';

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
 * Inserts pivot groups into the loaded head without moving anything at rest. Rotating `joints.head`
 * turns the face around the neck; rotating an appendage's joint turns it around its base.
 * Parts the model lacks are skipped.
 * @param {import('three').Object3D} head
 * @returns {{ joints: Record<string, Group> }}
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
  return { joints };
}
