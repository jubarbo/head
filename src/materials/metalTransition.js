// @ts-check
import { Vector3 } from 'three';
import { ADVANCE_EDGE_WIDTH } from './metalAdvance.js';
import { METAL_PRESETS, PATINA_COLOR } from './metalPresets.js';

/**
 * Below this the eye would lose its iridescence define and three.js would recompile its program, so
 * the "off" end of the slider keeps an invisible amount instead.
 */
export const MIN_EYE_IRIDESCENCE = 0.001;

/** Emission of the advancing front, as a fraction of the metal color (stays under the bloom threshold). */
const EDGE_GLOW = 0.25;

/**
 * Environment reflections on bare metal relative to the cuticle. A full-strength mirror of the studio
 * HDRI is ~3x brighter than the green cuticle, so AgX washes gold and bronze toward beige and bloom
 * floods the background; this keeps the exposure close across the slider, like a photographer would.
 */
const METAL_ENV_INTENSITY = 0.6;

/**
 * Uniforms shared by every patched material: the slider only writes these values, so sliding, presets
 * and the extra controls never trigger a shader recompilation.
 */
export function createMetalUniforms() {
  const chrome = METAL_PRESETS.chrome;
  return {
    uMetalProgress: { value: 0 },
    uMetalColor: { value: chrome.color.clone() },
    uMetalRoughness: { value: chrome.roughness },
    uMetalPatina: { value: chrome.patina },
    uPatinaColor: { value: PATINA_COLOR.clone() },
    uRelief: { value: 1 },
    uEdgeWidth: { value: ADVANCE_EDGE_WIDTH },
    uEdgeGlow: { value: chrome.color.clone().multiplyScalar(EDGE_GLOW) },
    uAdvanceOrigin: { value: new Vector3(0, -2.5, 1) },
    uAdvanceReach: { value: 8 },
    uMetalEnv: { value: METAL_ENV_INTENSITY },
    // AgX grade of the tint (an artistic choice over Neutral tone mapping, L15); see metalPresets.js
    uMetalSaturation: { value: chrome.saturation },
  };
}

/** @typedef {ReturnType<typeof createMetalUniforms>} MetalUniforms */

const VERTEX_DECLARATIONS = /* glsl */ `
attribute vec3 aRestPosition;
varying vec3 vMetalPosition;
void main() {`;

const VERTEX_BODY = /* glsl */ `
#include <project_vertex>
vMetalPosition = aRestPosition; // world space at rest: one front across all parts, fixed to moving ones`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform float uMetalProgress;
uniform vec3 uMetalColor;
uniform float uMetalRoughness;
uniform float uMetalPatina;
uniform vec3 uPatinaColor;
uniform float uRelief;
uniform float uOrganicRelief;
uniform float uEdgeWidth;
uniform vec3 uEdgeGlow;
uniform vec3 uAdvanceOrigin;
uniform float uAdvanceReach;
uniform float uMetalEnv;
uniform float uMetalSaturation;
varying vec3 vMetalPosition;

float metalMask; // 0 organic .. 1 metal, shared by every stage below
float metalEdge;

float metalHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}

float metalNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( metalHash( i ), metalHash( i + vec3( 1, 0, 0 ) ), f.x ),
         mix( metalHash( i + vec3( 0, 1, 0 ) ), metalHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( metalHash( i + vec3( 0, 0, 1 ) ), metalHash( i + vec3( 1, 0, 1 ) ), f.x ),
         mix( metalHash( i + vec3( 0, 1, 1 ) ), metalHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}

// Rotated octaves hide the axis-aligned blocks of plain value noise.
const mat3 METAL_OCTAVE = mat3( 0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64 );

float metalFbm( vec3 p ) {
  float sum = 0.5 * metalNoise( p );
  p = METAL_OCTAVE * p * 2.03;
  sum += 0.25 * metalNoise( p );
  p = METAL_OCTAVE * p * 2.01;
  sum += 0.125 * metalNoise( p );
  return sum / 0.875;
}

// Arrival time of the metal (metalAdvance.js): distance from the mouth, broken up by a few octaves of
// noise so the front creeps like a dissolve instead of a clean sphere.
float metalField( vec3 p ) {
  float distanceTerm = saturate( distance( p, uAdvanceOrigin ) / uAdvanceReach );
  float n = 0.75 * metalFbm( p * 1.3 ) + 0.25 * metalFbm( p * 9.0 + 3.0 );
  return saturate( distanceTerm * 0.82 + ( n - 0.5 ) * 0.4 + 0.09 );
}

void main() {`;

/**
 * Cavity estimate for the cuticle: the baked AO (orm.r). Other zones pass their own snippet.
 * It assigns `metalCavity` (0 open surface .. 1 deep crevice).
 */
const AO_CAVITY = /* glsl */ `
#ifdef USE_AOMAP
  metalCavity = 1.0 - texture2D( aoMap, vAoMapUv ).r;
#endif`;

/** @param {string} cavity */
const fragmentSurface = (cavity) => /* glsl */ `
#include <metalnessmap_fragment>
{
  float edge = uMetalProgress * ( 1.0 + uEdgeWidth );
  metalMask = 1.0 - smoothstep( edge - uEdgeWidth, edge, metalField( vMetalPosition ) );
  metalEdge = 4.0 * metalMask * ( 1.0 - metalMask );
  float metalCavity = 0.0;
  ${cavity}
  // Cavities stay a bit darker so the relief still reads on mirror metal; aged bronze fills them with
  // a rough verdigris (a dielectric) and mottles it over the open surface.
  float mottle = smoothstep( 0.52, 0.7, metalFbm( vMetalPosition * 3.5 + 11.0 ) );
  float patina = uMetalPatina * saturate( smoothstep( 0.12, 0.5, metalCavity ) + 0.7 * mottle );
  vec3 tint = clamp( mix( vec3( dot( uMetalColor, vec3( 0.2126, 0.7152, 0.0722 ) ) ), uMetalColor, uMetalSaturation ), 0.0, 1.0 );
  vec3 metalAlbedo = mix( tint * ( 1.0 - 0.35 * metalCavity ), uPatinaColor, patina );
  diffuseColor.rgb = mix( diffuseColor.rgb, metalAlbedo, metalMask );
  metalnessFactor = mix( metalnessFactor, 1.0 - patina, metalMask );
  roughnessFactor = mix( roughnessFactor, mix( uMetalRoughness, 0.85, patina ), metalMask );
  roughnessFactor = mix( roughnessFactor, 0.6, 0.5 * metalEdge ); // the front is a duller seam
}`;

/** Relief strength (slider) and smoother micro-relief once polished; runs after every normal patch. */
const FRAGMENT_NORMAL = /* glsl */ `
normal = normalize( mix( nonPerturbedNormal, normal, uRelief * mix( uOrganicRelief, 0.6, metalMask ) ) );
#include <clearcoat_normal_fragment_begin>`;

const FRAGMENT_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
totalEmissiveRadiance += uEdgeGlow * metalEdge;`;

/** The waxy/wet clearcoat of the cuticle and eyes mostly goes away on bare metal. */
const FRAGMENT_LIGHTS = /* glsl */ `
#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= 1.0 - 0.75 * metalMask;
#endif`;

/** Every metal zone reflects the environment at uMetalEnv, whatever its organic envMapIntensity (eyes 0.5). */
const FRAGMENT_REFLECTIONS = /* glsl */ `
#if defined( RE_IndirectSpecular ) && defined( USE_ENVMAP )
  radiance *= mix( 1.0, uMetalEnv / max( envMapIntensity, 1e-3 ), metalMask );
#endif
#include <lights_fragment_end>`;

/**
 * Extends a viewer material with the skin → metal transition on top of its own onBeforeCompile patch.
 * The GLSL that sets `metalCavity` comes from `material.userData.metalCavity` (the eye uses its facet
 * walls) and defaults to the baked AO. `material.userData.organicRelief` softens the baked relief of
 * the organic surface only, and defaults to 1.
 * @param {import('three').MeshPhysicalMaterial} material
 * @param {MetalUniforms} uniforms shared by all materials
 */
export function applyMetalTransition(material, uniforms) {
  const cavity = material.userData.metalCavity ?? AO_CAVITY;
  const previous = material.onBeforeCompile;
  const baseKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms, { uOrganicRelief: { value: material.userData.organicRelief ?? 1 } });
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', VERTEX_DECLARATIONS)
      .replace('#include <project_vertex>', VERTEX_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', FRAGMENT_DECLARATIONS)
      .replace('#include <metalnessmap_fragment>', fragmentSurface(cavity))
      .replace('#include <clearcoat_normal_fragment_begin>', FRAGMENT_NORMAL)
      .replace('#include <emissivemap_fragment>', FRAGMENT_EMISSIVE)
      .replace('#include <lights_physical_fragment>', FRAGMENT_LIGHTS)
      .replace('#include <lights_fragment_end>', FRAGMENT_REFLECTIONS)
      // cuticle backlight (cuticleMaterial.js): light does not shine through metal
      .replace('* uTranslucency;', '* uTranslucency * ( 1.0 - metalMask );');
  };
  material.customProgramCacheKey = () => `${baseKey}+metal`;
  return material;
}

/**
 * The material panel's model: every setter only writes uniform values (or a material scalar that keeps
 * its define), so none of them recompiles a shader.
 * @param {MetalUniforms} uniforms
 * @param {{ eye: import('three').MeshPhysicalMaterial }} materials
 */
export function createMetalControls(uniforms, { eye }) {
  const state = {
    progress: uniforms.uMetalProgress.value,
    preset: /** @type {import('./metalPresets.js').MetalPresetName} */ ('chrome'),
    roughness: uniforms.uMetalRoughness.value,
    relief: uniforms.uRelief.value,
    hue: 0,
    eyeIridescence: eye.iridescence,
  };

  const updateColor = () => {
    const color = uniforms.uMetalColor.value.copy(METAL_PRESETS[state.preset].color);
    if (state.hue) color.offsetHSL(state.hue / 360, 0, 0); // the HSL round trip is not exact at 0
    uniforms.uEdgeGlow.value.copy(color).multiplyScalar(EDGE_GLOW);
  };

  return {
    state,
    /** @param {number} value 0 organic .. 1 metal */
    setProgress(value) {
      state.progress = Math.min(1, Math.max(0, value));
      uniforms.uMetalProgress.value = state.progress;
    },
    /** Applies a finish and resets the tone and roughness overrides to it. @param {string} name */
    setPreset(name) {
      const preset = METAL_PRESETS[/** @type {import('./metalPresets.js').MetalPresetName} */ (name)];
      if (!preset) throw new Error(`Unknown metal preset: ${name}`);
      state.preset = /** @type {import('./metalPresets.js').MetalPresetName} */ (name);
      state.hue = 0;
      state.roughness = preset.roughness;
      uniforms.uMetalRoughness.value = preset.roughness;
      uniforms.uMetalPatina.value = preset.patina;
      uniforms.uMetalSaturation.value = preset.saturation;
      updateColor();
    },
    /** @param {number} value metal roughness, 0..1 */
    setRoughness(value) {
      state.roughness = value;
      uniforms.uMetalRoughness.value = value;
    },
    /** @param {number} value relief strength, 1 = baked */
    setRelief(value) {
      state.relief = value;
      uniforms.uRelief.value = value;
    },
    /** @param {number} degrees hue shift of the metal color */
    setHue(degrees) {
      state.hue = degrees;
      updateColor();
    },
    /** @param {number} value thin-film iridescence of the compound eyes, 0..1 */
    setEyeIridescence(value) {
      state.eyeIridescence = value;
      eye.iridescence = Math.max(MIN_EYE_IRIDESCENCE, value);
    },
  };
}

/** @typedef {ReturnType<typeof createMetalControls>} MetalControls */

/**
 * Sets where the advance starts and how far it travels, from the loaded head.
 * @param {MetalUniforms} uniforms
 * @param {{ origin: Vector3, reach: number }} frame see advanceFrame()
 */
export function setAdvanceFrame(uniforms, frame) {
  uniforms.uAdvanceOrigin.value.copy(frame.origin);
  uniforms.uAdvanceReach.value = frame.reach;
}
