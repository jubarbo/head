// @ts-check
import { Color, MeshPhysicalMaterial } from 'three';
import { OMMATIDIA_FADE, OMMATIDIUM_SIZE, PSEUDOPUPIL } from './eyeOptics.js';

const DEG = Math.PI / 180;

/** Eye colors sampled from the reference close-up: darker green at the rim, yellow-green on top. */
const EYE_COLORS = {
  low: '#3A5810',
  high: '#93B536',
  facetBorder: '#4A6418',
  pupil: '#140E0A',
};

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vEyePosition;
varying vec3 vEyeNormal;
void main() {`;

const VERTEX_BODY = /* glsl */ `
#include <begin_vertex>
vEyePosition = position; // object space: the facet lattice is seam-free and sticks to the eye
vEyeNormal = normal;`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform mat3 normalMatrix; // also set per object for the vertex stage
uniform float uFacetScale;
uniform vec2 uFacetFade;
uniform vec2 uPupilCos;
uniform vec3 uEyeLow;
uniform vec3 uEyeHigh;
uniform vec3 uFacetBorder;
uniform vec3 uPupil;
varying vec3 vEyePosition;
varying vec3 vEyeNormal;

vec3 eyeHash( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.xxy + p.yxx ) * p.zyx );
}

// 3D cellular noise: F1, F2 and the nearest feature point. Sliced by the eye surface, the cells read
// as the irregular, roughly hexagonal facets of the reference macro shot.
void eyeCells( vec3 x, out float f1, out float f2, out vec3 nearest ) {
  vec3 cell = floor( x );
  f1 = 8.0; f2 = 8.0; nearest = vec3( 0.0 );
  for ( int k = -1; k <= 1; k ++ )
  for ( int j = -1; j <= 1; j ++ )
  for ( int i = -1; i <= 1; i ++ ) {
    vec3 c = cell + vec3( float( i ), float( j ), float( k ) );
    vec3 feature = c + 0.15 + 0.7 * eyeHash( c );
    float d = length( feature - x );
    if ( d < f1 ) { f2 = f1; f1 = d; nearest = feature; }
    else if ( d < f2 ) { f2 = d; }
  }
}

float facetVisibility; // shared between the color and normal stages of this shader
float facetInterior;
vec3 facetCenter;

void main() {`;

/** Facet color, per-facet variation and the pseudopupil (eyeOptics.js mirrors the math). */
const FRAGMENT_COLOR = /* glsl */ `
#include <color_fragment>
{
  vec3 p = vEyePosition * uFacetScale;
  float f1, f2;
  eyeCells( p, f1, f2, facetCenter );
  // facets per pixel: fade the pattern to its average before it can alias into moiré
  float footprint = length( fwidth( p ) );
  facetVisibility = 1.0 - smoothstep( uFacetFade.x, uFacetFade.y, footprint );
  float edge = f2 - f1; // 0 on the walls between facets
  float aa = max( footprint, 1e-4 );
  facetInterior = smoothstep( 0.02, 0.09 + aa, edge );

  vec3 n = normalize( vEyeNormal );
  float up = saturate( 0.55 + 0.45 * n.y + 0.25 * n.z );
  vec3 eye = mix( uEyeLow, uEyeHigh, up );
  float variation = 0.9 + 0.2 * eyeHash( floor( facetCenter * 7.0 ) ).x;
  vec3 facet = mix( uFacetBorder, eye * variation, facetInterior );
  vec3 averaged = mix( uFacetBorder, eye, 0.9 );
  diffuseColor.rgb = mix( averaged, facet, facetVisibility );

  // pseudopupil: the facets aimed at the viewer look into their own pigment and turn dark
  float nDotV = dot( normalize( vNormal ), normalize( vViewPosition ) );
  float pupil = smoothstep( uPupilCos.x, uPupilCos.y, nDotV );
  float pupilCells = mix( 0.85, mix( 0.55, 1.0, facetInterior ), facetVisibility );
  diffuseColor.rgb = mix( diffuseColor.rgb, uPupil, pupil * pupilCells );
}`;

/** Each facet is a tiny lens: tilt the normal away from its center, fading with the pattern. */
const FRAGMENT_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
  vec3 offset = vEyePosition * uFacetScale - facetCenter;
  vec3 tilt = normalMatrix * offset; // object -> view space
  tilt -= normal * dot( tilt, normal );
  normal = normalize( normal + tilt * 0.9 * facetVisibility * facetInterior );
}`;

/** On metal, the walls between facets read as engraved grooves, so the ommatidia pattern survives. */
const EYE_METAL_CAVITY = /* glsl */ `metalCavity = 0.7 * ( 1.0 - facetInterior ) * facetVisibility;`;

/**
 * Compound eye: MeshPhysicalMaterial with object-space ommatidia, a view-dependent pseudopupil and a
 * glassy clearcoat for the wet specular highlight (the clearcoat keeps the smooth geometric normal).
 */
export function createEyeMaterial() {
  const material = new MeshPhysicalMaterial({
    name: 'compound-eye',
    roughness: 0.3,
    metalness: 0,
    specularIntensity: 0.5, // most of the gloss comes from the wet clearcoat layer
    envMapIntensity: 0.5, // the studio HDRI otherwise veils the pigment at grazing angles
    clearcoat: 0.6, // 0.85 read as a milky rim at grazing angles under the T4 lighting
    clearcoatRoughness: 0.06,
    iridescence: 0.2, // faint thin-film sheen of the corneal lenses (adjustable in the material panel)
    iridescenceIOR: 1.4,
    iridescenceThicknessMinimum: 200,
    iridescenceThicknessMaximum: 450,
  });
  const uniforms = {
    uFacetScale: { value: 1 / OMMATIDIUM_SIZE },
    uFacetFade: { value: [OMMATIDIA_FADE.start, OMMATIDIA_FADE.end] },
    uPupilCos: { value: [Math.cos(PSEUDOPUPIL.outerDeg * DEG), Math.cos(PSEUDOPUPIL.innerDeg * DEG)] },
    uEyeLow: { value: new Color(EYE_COLORS.low) },
    uEyeHigh: { value: new Color(EYE_COLORS.high) },
    uFacetBorder: { value: new Color(EYE_COLORS.facetBorder) },
    uPupil: { value: new Color(EYE_COLORS.pupil) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', VERTEX_DECLARATIONS)
      .replace('#include <begin_vertex>', VERTEX_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', FRAGMENT_DECLARATIONS)
      .replace('#include <color_fragment>', FRAGMENT_COLOR)
      .replace('#include <normal_fragment_maps>', FRAGMENT_NORMAL);
  };
  material.customProgramCacheKey = () => 'mantis-eye';
  material.userData.metalCavity = EYE_METAL_CAVITY;
  material.userData.uniforms = uniforms;
  return material;
}

/** Ocelli: small glossy lenses, dark amber. */
export function createOcellusMaterial() {
  return new MeshPhysicalMaterial({
    name: 'ocellus',
    color: new Color('#3A2214'),
    roughness: 0.2,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
  });
}
