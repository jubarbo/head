import { describe, it, expect } from 'vitest';
import { Box3, Color, ShaderLib, Vector3 } from 'three';
import { METAL_PRESETS, METAL_PRESET_NAMES } from '../src/materials/metalPresets.js';
import { metalCoverage, frontEdge, advanceFrame, ADVANCE_EDGE_WIDTH } from '../src/materials/metalAdvance.js';
import { createMetalUniforms, applyMetalTransition, createMetalControls, MIN_EYE_IRIDESCENCE } from '../src/materials/metalTransition.js';
import { createCuticleMaterial } from '../src/materials/cuticleMaterial.js';
import { createEyeMaterial, createOcellusMaterial } from '../src/materials/eyeMaterial.js';

describe('metal presets (S3)', () => {
  it('offers chrome, gold, copper, aged bronze and titanium', () => {
    expect(METAL_PRESET_NAMES).toEqual(['chrome', 'gold', 'copper', 'agedBronze', 'titanium']);
  });

  it('uses physically plausible base reflectance (F0) and roughness', () => {
    for (const name of METAL_PRESET_NAMES) {
      const preset = METAL_PRESETS[name];
      const f0 = new Color(preset.color); // linear working space
      for (const channel of [f0.r, f0.g, f0.b]) {
        expect(channel).toBeGreaterThan(0.3); // metals reflect far more than dielectrics (~0.04)
        expect(channel).toBeLessThanOrEqual(1);
      }
      expect(preset.roughness).toBeGreaterThanOrEqual(0.05);
      expect(preset.roughness).toBeLessThanOrEqual(0.6);
    }
  });

  it('keeps chrome neutral and gold/copper warm', () => {
    const chrome = new Color(METAL_PRESETS.chrome.color);
    expect(Math.max(chrome.r, chrome.g, chrome.b) - Math.min(chrome.r, chrome.g, chrome.b)).toBeLessThan(0.03);
    for (const name of ['gold', 'copper']) {
      const warm = new Color(METAL_PRESETS[name].color);
      expect(warm.r).toBeGreaterThan(warm.b + 0.2);
    }
  });

  it('only aged bronze grows verdigris in the cavities', () => {
    for (const name of METAL_PRESET_NAMES) expect(METAL_PRESETS[name].patina > 0).toBe(name === 'agedBronze');
  });
});

describe('metal advance mask (S3: noise/dissolve front)', () => {
  const fields = [0, 0.1, 0.35, 0.5, 0.8, 0.99, 1];

  it('is fully organic at 0 and fully metallic at 1, for every point of the surface', () => {
    for (const field of fields) {
      expect(metalCoverage(0, field)).toBe(0);
      expect(metalCoverage(1, field)).toBe(1);
    }
  });

  it('grows monotonically with the slider, so the metal never retreats while sliding forward', () => {
    for (const field of fields) {
      let previous = 0;
      for (let p = 0; p <= 1.0001; p += 0.01) {
        const coverage = metalCoverage(p, field);
        expect(coverage).toBeGreaterThanOrEqual(previous - 1e-12);
        previous = coverage;
      }
    }
  });

  it('reaches the points near the mandibles (low field) before the vertex (high field)', () => {
    expect(metalCoverage(0.3, 0.1)).toBe(1);
    expect(metalCoverage(0.3, 0.9)).toBe(0);
    expect(metalCoverage(0.5, 0.2)).toBeGreaterThan(metalCoverage(0.5, 0.6));
  });

  it('is a continuous transition, not a hard switch: the front is a soft band', () => {
    const p = 0.5;
    const middle = metalCoverage(p, p * (1 + ADVANCE_EDGE_WIDTH) - ADVANCE_EDGE_WIDTH / 2);
    expect(middle).toBeGreaterThan(0.2);
    expect(middle).toBeLessThan(0.8);
  });

  it('draws a thin front edge only where the metal is advancing', () => {
    expect(frontEdge(0)).toBe(0);
    expect(frontEdge(1)).toBe(0);
    expect(frontEdge(0.5)).toBe(1);
    expect(frontEdge(0.25)).toBeGreaterThan(0);
    expect(frontEdge(0.25)).toBeLessThan(1);
  });

  it('measures the advance from the mouth to the farthest point of the head', () => {
    const box = new Box3(new Vector3(-3, -3, -2), new Vector3(3, 5, 1));
    const mouth = new Vector3(0, -3, 1);
    const frame = advanceFrame(box, mouth);
    expect(frame.origin.equals(mouth)).toBe(true);
    expect(frame.reach).toBeCloseTo(Math.hypot(3, 8, 3), 6); // to a top-back corner
  });
});

/** The physical template with its #include markers still unresolved, as three passes it to onBeforeCompile. */
const physicalShader = () => ({
  uniforms: {},
  vertexShader: ShaderLib.physical.vertexShader,
  fragmentShader: ShaderLib.physical.fragmentShader,
});

describe('skin → metal shader patch', () => {
  const uniforms = createMetalUniforms();
  const materials = [
    createCuticleMaterial('skin', null),
    createCuticleMaterial('mandible', null),
    createEyeMaterial(),
    createOcellusMaterial(),
  ];
  for (const material of materials) applyMetalTransition(material, uniforms);

  it('injects the metal mask into every zone, keeping each zone\'s own patch', () => {
    for (const material of materials) {
      const shader = physicalShader();
      material.onBeforeCompile(shader, /** @type {any} */ (null));
      expect(shader.uniforms.uMetalProgress).toBe(uniforms.uMetalProgress); // shared object, not a copy
      expect(shader.vertexShader).toContain('vMetalPosition =');
      expect(shader.vertexShader).toContain('vMetalPosition = aRestPosition'); // sticks to moving parts
      expect(shader.fragmentShader).toContain('metalMask =');
      expect(shader.fragmentShader).toContain('metalnessFactor = mix(');
      expect(shader.fragmentShader).toContain('roughnessFactor = mix(');
      expect(shader.fragmentShader).toContain('totalEmissiveRadiance +=');
    }
    const eye = physicalShader();
    materials[2].onBeforeCompile(eye, /** @type {any} */ (null));
    expect(eye.fragmentShader).toContain('eyeCells('); // ommatidia survive the metal
    const skin = physicalShader();
    materials[0].onBeforeCompile(skin, /** @type {any} */ (null));
    expect(skin.fragmentShader).toContain('uTranslucency * ( 1.0 - metalMask )'); // no backlight glow through metal
  });

  it('pre-saturates the metal color so AgX does not wash gold and bronze to beige (L15)', () => {
    for (const name of ['gold', 'copper', 'agedBronze']) expect(METAL_PRESETS[name].saturation).toBeGreaterThan(1);
    expect(METAL_PRESETS.chrome.saturation).toBe(1);
    const shader = physicalShader();
    materials[0].onBeforeCompile(shader, /** @type {any} */ (null));
    expect(shader.fragmentShader).toContain('uMetalSaturation');
  });

  it('keeps one shader program per material kind', () => {
    expect(materials[0].customProgramCacheKey()).toBe(materials[1].customProgramCacheKey());
    expect(materials[0].customProgramCacheKey()).toContain('metal');
    expect(materials[2].customProgramCacheKey()).toContain('metal');
  });
});

describe('organic relief (S11: the skin is smoother, nothing else changes)', () => {
  const uniforms = createMetalUniforms();
  const compiled = (material) => {
    applyMetalTransition(material, uniforms);
    const shader = physicalShader();
    material.onBeforeCompile(shader, /** @type {any} */ (null));
    return shader;
  };

  it('softens the skin before the metal takes over, keeping the polished relief', () => {
    const shader = compiled(createCuticleMaterial('skin', null));
    expect(shader.uniforms.uOrganicRelief.value).toBe(0.5);
    expect(shader.fragmentShader).toContain('uRelief * mix( uOrganicRelief, 0.6, metalMask )');
  });

  it.each(['antenna', 'palp', 'mandible'])('keeps the baked relief on the %s', (zone) => {
    expect(compiled(createCuticleMaterial(zone, null)).uniforms.uOrganicRelief.value).toBe(1);
  });

  it('keeps the baked relief on the eye', () => {
    expect(compiled(createEyeMaterial()).uniforms.uOrganicRelief.value).toBe(1);
  });
});

describe('material controls (S3: slider, presets, roughness, relief, hue, eye iridescence)', () => {
  const setup = () => {
    const uniforms = createMetalUniforms();
    const eye = createEyeMaterial();
    const skin = createCuticleMaterial('skin', null);
    applyMetalTransition(skin, uniforms);
    applyMetalTransition(eye, uniforms);
    const controls = createMetalControls(uniforms, { eye });
    return { uniforms, eye, skin, controls };
  };

  it('starts organic, on chrome', () => {
    const { uniforms, controls } = setup();
    expect(uniforms.uMetalProgress.value).toBe(0);
    expect(controls.state.preset).toBe('chrome');
    expect(uniforms.uMetalColor.value.equals(new Color(METAL_PRESETS.chrome.color))).toBe(true);
  });

  it('clamps the slider to 0..1', () => {
    const { uniforms, controls } = setup();
    controls.setProgress(1.7);
    expect(uniforms.uMetalProgress.value).toBe(1);
    controls.setProgress(-2);
    expect(uniforms.uMetalProgress.value).toBe(0);
  });

  it('applies a preset\'s color, roughness and patina, and resets the hue and roughness overrides', () => {
    const { uniforms, controls } = setup();
    controls.setHue(30);
    controls.setRoughness(0.5);
    controls.setPreset('agedBronze');
    expect(controls.state.hue).toBe(0);
    expect(uniforms.uMetalColor.value.equals(new Color(METAL_PRESETS.agedBronze.color))).toBe(true);
    expect(uniforms.uMetalRoughness.value).toBe(METAL_PRESETS.agedBronze.roughness);
    expect(uniforms.uMetalPatina.value).toBe(METAL_PRESETS.agedBronze.patina);
    expect(uniforms.uMetalSaturation.value).toBe(METAL_PRESETS.agedBronze.saturation);
  });

  it('rejects unknown presets', () => {
    const { controls } = setup();
    expect(() => controls.setPreset('plutonium')).toThrow(/plutonium/);
  });

  it('shifts the metal tone without changing its brightness much', () => {
    const { uniforms, controls } = setup();
    controls.setPreset('gold');
    const base = uniforms.uMetalColor.value.clone();
    controls.setHue(-25);
    const shifted = uniforms.uMetalColor.value;
    expect(shifted.equals(base)).toBe(false);
    const hsl = (c) => c.getHSL({ h: 0, s: 0, l: 0 });
    expect(hsl(shifted).l).toBeCloseTo(hsl(base).l, 2);
    expect(hsl(shifted).h).toBeCloseTo((hsl(base).h - 25 / 360 + 1) % 1, 2);
  });

  it('sets roughness and relief strength', () => {
    const { uniforms, controls } = setup();
    controls.setRoughness(0.42);
    controls.setRelief(1.5);
    expect(uniforms.uMetalRoughness.value).toBe(0.42);
    expect(uniforms.uRelief.value).toBe(1.5);
  });

  it('never recompiles a shader while sliding or switching presets', () => {
    const { eye, skin, controls } = setup();
    const versions = [eye.version, skin.version];
    for (let p = 0; p <= 1; p += 0.05) controls.setProgress(p);
    for (const name of METAL_PRESET_NAMES) controls.setPreset(name);
    controls.setRoughness(0.3);
    controls.setRelief(0);
    controls.setHue(40);
    controls.setEyeIridescence(0);
    controls.setEyeIridescence(1);
    controls.setEyeIridescence(0);
    expect([eye.version, skin.version]).toEqual(versions);
    // three.js recompiles when iridescence crosses 0, so "off" keeps a negligible amount
    expect(eye.iridescence).toBe(MIN_EYE_IRIDESCENCE);
    expect(MIN_EYE_IRIDESCENCE).toBeGreaterThan(0);
    expect(MIN_EYE_IRIDESCENCE).toBeLessThan(0.01);
  });
});
