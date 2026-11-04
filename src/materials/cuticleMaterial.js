// @ts-check
import { Color, MeshPhysicalMaterial } from 'three';
import { PALETTE } from './palette.js';

/**
 * @typedef {'skin' | 'antenna' | 'palp' | 'mandible'} CuticleZone
 * @typedef {{ albedo: import('three').Texture, normal: import('three').Texture, orm: import('three').Texture }} CuticleMaps
 */

/**
 * Per-zone look on top of the shared baked atlas. `color` is only used when the maps are missing.
 * Translucency: thin, chitin-light parts (antennae, palps) glow more when backlit than the capsule;
 * the dark sclerotized mandibles barely transmit. The tint saturates the transmitted light, which is
 * filtered by the pigmented cuticle. `organicRelief` softens the baked relief (metalTransition.js).
 */
const ZONE_LOOK = {
  skin: { color: PALETTE.green, clearcoat: 0.22, translucency: 0.6, tint: [1.1, 1.25, 0.45], organicRelief: 0.4 },
  antenna: { color: PALETTE.antennaBrown, clearcoat: 0.2, translucency: 0.9, tint: [1.4, 0.95, 0.45] },
  palp: { color: PALETTE.antennaBrown, clearcoat: 0.25, translucency: 1.0, tint: [1.3, 1.0, 0.5] },
  mandible: { color: PALETTE.mandibleBrown, clearcoat: 0.6, translucency: 0.15, tint: [1.3, 0.7, 0.4] },
};

/** Fast back-light translucency (wrap of -L around N, Barré-Brisebois & Bouchard 2011), scaled by the
 * baked thinness, for every directional light. Shadows are ignored on purpose: a backlit part is in
 * its own shadow. Only directDiffuse grows, so specular and clearcoat stay physically based. */
const TRANSLUCENCY_FRAGMENT = /* glsl */ `
#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
{
  #ifdef USE_ROUGHNESSMAP
    float thin = 1.0 - texture2D( roughnessMap, vRoughnessMapUv ).b; // orm.b = baked thickness
  #else
    float thin = 0.3;
  #endif
  vec3 transmitted = vec3( 0.0 );
  for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
    vec3 h = normalize( directionalLights[ i ].direction + normal * 0.35 );
    transmitted += directionalLights[ i ].color * pow( saturate( dot( geometryViewDir, -h ) ), 2.5 );
  }
  reflectedLight.directDiffuse += diffuseColor.rgb * uTranslucencyTint * transmitted * thin * uTranslucency;
}
#endif
`;

/**
 * Exoskeleton material for the atlas zones: baked albedo / tangent-space normal / ORM (AO, roughness,
 * thickness) plus a thin waxy clearcoat and subtle translucency. T5 extends this same material.
 * @param {CuticleZone} zone
 * @param {CuticleMaps | null} maps null keeps a flat zone color (textures failed to load)
 */
export function createCuticleMaterial(zone, maps) {
  const look = ZONE_LOOK[zone];
  const material = new MeshPhysicalMaterial({
    name: `cuticle-${zone}`,
    color: maps ? 0xffffff : new Color(look.color),
    map: maps?.albedo ?? null,
    normalMap: maps?.normal ?? null,
    aoMap: maps?.orm ?? null, // AO in R
    roughnessMap: maps?.orm ?? null, // roughness in G
    roughness: maps ? 1 : 0.45,
    metalness: 0,
    clearcoat: look.clearcoat,
    clearcoatRoughness: 0.3,
  });
  material.userData.organicRelief = look.organicRelief;
  const uniforms = {
    uTranslucency: { value: look.translucency },
    uTranslucencyTint: { value: new Color(...look.tint) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uTranslucency;\nuniform vec3 uTranslucencyTint;\nvoid main() {')
      .replace('#include <lights_fragment_end>', TRANSLUCENCY_FRAGMENT);
  };
  // Same GLSL for every zone; the zone only changes uniform values, so one program is shared.
  material.customProgramCacheKey = () => 'mantis-cuticle';
  material.userData.uniforms = uniforms;
  return material;
}

/**
 * Swaps the baked maps of materials that already use them (quality tier change). Only the texture
 * objects change, not which maps exist, so the program is reused. Flat-color materials are skipped:
 * adding maps would recompile them. The previous textures are disposed once each.
 * @param {MeshPhysicalMaterial[]} materials
 * @param {CuticleMaps} maps
 * @returns {boolean} whether anything was swapped
 */
export function swapCuticleMaps(materials, maps) {
  /** @type {Set<import('three').Texture>} */
  const previous = new Set();
  for (const material of materials) {
    if (!material.map) continue;
    for (const texture of [material.map, material.normalMap, material.aoMap, material.roughnessMap]) {
      if (texture) previous.add(texture);
    }
    material.map = maps.albedo;
    material.normalMap = maps.normal;
    material.aoMap = maps.orm;
    material.roughnessMap = maps.orm;
  }
  for (const texture of [maps.albedo, maps.normal, maps.orm]) previous.delete(texture);
  for (const texture of previous) texture.dispose();
  return previous.size > 0;
}
