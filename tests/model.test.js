import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';

const MODEL = new URL('../public/models/mantis-head.glb', import.meta.url);

/** Reads the JSON chunk of a GLB without decoding buffers. */
function readGltfJson(url) {
  const bytes = readFileSync(url);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
}

const gltf = readGltfJson(MODEL);
const nodesByName = new Map(gltf.nodes.map((node) => [node.name, node]));
const extras = (name) => nodesByName.get(name)?.extras ?? {};

describe('mantis head model (T2 acceptance)', () => {
  it('contains every anatomical part of the reference sheet', () => {
    const required = [
      'head_capsule', 'eye_l', 'eye_r', 'ocellus_m', 'ocellus_l', 'ocellus_r',
      'antenna_socket_l', 'antenna_socket_r', 'antenna_l', 'antenna_r',
      'labrum', 'mandible_l', 'mandible_r', 'maxilla_l', 'maxilla_r',
      'maxillary_palp_l', 'maxillary_palp_r', 'labium', 'labial_palp_l', 'labial_palp_r', 'neck',
    ];
    const missing = required.filter((name) => !nodesByName.has(name));
    expect(missing).toEqual([]);
  });

  it('segments the appendages like the insect: 5-segment maxillary palps, 3-segment labial palps, scape + pedicel + long flagellum', () => {
    for (const side of ['l', 'r']) {
      expect(extras(`maxillary_palp_${side}`).segments).toBe(5);
      expect(extras(`labial_palp_${side}`).segments).toBe(3);
      expect(extras(`antenna_${side}`).segments).toBeGreaterThanOrEqual(40);
      expect(extras(`antenna_${side}`).setae).toBeGreaterThan(0);
      expect(extras(`mandible_${side}`).teeth).toBeGreaterThanOrEqual(3);
    }
  });

  it('marks the exoskeleton sutures carved into the capsule', () => {
    const sutures = extras('head_capsule').sutures ?? [];
    expect(sutures).toEqual(expect.arrayContaining(['epicranial', 'frontoclypeal', 'frons_lateral', 'clypeolabral', 'subgenal']));
  });

  it('has UVs on every primitive for the T3 textures', () => {
    const withoutUv = gltf.meshes.flatMap((mesh) => mesh.primitives.filter((p) => p.attributes.TEXCOORD_0 === undefined).map(() => mesh.name));
    expect(withoutUv).toEqual([]);
  });

  it('carries MikkTSpace tangents on the cuticle meshes for the baked tangent-space normal map (T3)', () => {
    const cuticle = gltf.meshes.filter((mesh) => mesh.primitives.some((p) => ['skin', 'antenna', 'palp', 'mandible'].includes(gltf.materials[p.material]?.name)));
    expect(cuticle.length).toBeGreaterThan(10);
    const withoutTangents = cuticle.filter((mesh) => mesh.primitives.some((p) => p.attributes.TANGENT === undefined)).map((mesh) => mesh.name);
    expect(withoutTangents).toEqual([]);
  });

  it('stays within the budget: < 150k triangles, < 3 MB, meshopt-compressed', () => {
    const triangles = gltf.meshes.flatMap((m) => m.primitives).reduce((sum, p) => sum + gltf.accessors[p.indices].count / 3, 0);
    expect(triangles).toBeLessThan(150_000);
    expect(statSync(MODEL).size).toBeLessThan(3 * 1024 * 1024);
    expect(gltf.extensionsUsed ?? []).toContain('EXT_meshopt_compression');
  });
});
