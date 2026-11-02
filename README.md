# Mantis Head 3D

Interactive, realistic 3D praying-mantis head in the browser (Three.js + Vite), with a skin → metal material transition.
Plan and progress: [`odd/tasks/mantis-head-3d.md`](odd/tasks/mantis-head-3d.md).

## Run

```bash
npm install
npm run dev       # development server
npm test          # unit tests (Vitest)
npm run build     # static build in dist/ (relative base, GitHub Pages ready)
npm run preview   # serve the build locally
npm run test:visual  # Playwright: delivery check + visual snapshots (desktop Chromium)
npm run test:ios     # same checks in WebKit with an iPhone 13 viewport
```

## Visual and delivery tests (Playwright)

`playwright.config.js` builds the app and serves `dist/` with `vite preview --base /mantis/`, so every check runs
under a GitHub Pages-like subpath. `tests/visual/delivery.spec.js` asserts that the GLB, HDRI, KTX2 maps and the
Basis transcoder (`.wasm`) all load from inside that subpath, the real model (not the placeholder) is shown, and
there are no console errors or failed requests. `tests/visual/snapshots.spec.js` compares the four reference views,
gold at 50 %, full chrome and the Low tier against the PNGs in `tests/visual/__snapshots__/<project>/`
(quality pinned to a manual tier, fps readout masked).

Headless browsers render WebGL on the CPU (SwiftShader), so a run takes a few minutes and the baselines are
specific to the machine that wrote them. After an intended visual change, inspect the diff in
`test-results/` and refresh the baselines with `npx playwright test --project=desktop-chromium --update-snapshots`.

The `iphone-webkit` project uses Playwright's WebKit build (the Safari engine) with the iPhone 13 viewport,
touch and user agent. On Linux it needs system libraries once: `sudo npx playwright install-deps webkit`.
Its baselines are not committed yet, so the first run must create them:
`npm run test:ios -- --update-snapshots`; review the new PNGs in `tests/visual/__snapshots__/iphone-webkit/`
before committing them.
It is a stand-in, not a substitute, for a real iPhone: GPU limits, memory and fps must still be checked on a device.

## Deploy (GitHub Pages)

`.github/workflows/pages.yml` runs on every push to `main` (or manually): `npm ci`, unit tests, `vite build`, then
publishes `dist/` with the official Pages actions. Only the deploy job gets the `pages: write` and
`id-token: write` permissions; the build job, which runs dependency code, can only read the repository. The build uses a relative `base`, so it works at
`https://<user>.github.io/<repository>/` without configuration. One-time setup: push the repository to GitHub and
set **Settings → Pages → Source** to **GitHub Actions**. Model and texture builds are not run in CI (they need
Blender and KTX-Software); their outputs in `public/` are committed.

## Controls

| Action | Mouse / trackpad | Touch |
|---|---|---|
| Rotate | Left drag | One finger |
| Zoom | Wheel / middle drag | Pinch |
| Pan | Right drag, or Shift/Ctrl/Cmd + left drag | Two fingers (three fingers: pan only) |

Panel buttons jump to the reference views (Front, Side, Top, Bottom) and **Reset view** returns to the framed front view.
Views are framed in the area the panels leave free: the projection centre is shifted above the bottom panel
(and below the material panel when it spans the middle of the screen, as on portrait phones), so the mouthparts are never hidden.
**Reference** overlays the matching crop of the reference sheet and switches to a 6° telephoto lens so the comparison is close to orthographic; orbiting hides the overlay until a view button is pressed again.
**Quality** defaults to *Auto*: it starts from a device guess (Medium on touch devices, High on desktops) and, once the scene
has loaded, steps between Low / Medium / High from the measured frame rate (below 28 fps → down, above 55 fps → up).
A tier that fell below 28 fps is not tried again until Auto is re-selected, so a 60 Hz display cannot bounce between two tiers.
Tiers cap the pixel ratio (1 / 1.5 / 2), switch shadows, GTAO, bloom and SMAA, and swap the cuticle maps (1024 on Low,
2048 otherwise). The readout next to the selector shows the fps and the active tier, for testing on a phone.
A full-screen overlay shows download progress, a message while a lost WebGL context is being restored, and an error
when WebGL is unavailable.

The **Material** panel (top right, enabled once the model loads) drives the skin → metal transition: the
*Skin ↔ Metal* slider, five finishes (Chrome, Gold, Copper, Aged bronze, Titanium) and, under *More*, metal
roughness, relief strength, metal tone (hue shift, ±60°) and the eyes' iridescence. Picking a finish resets
the tone and roughness to that finish.

Rendering uses three's own post-processing addons: render → GTAO (High) → subtle bloom (Medium/High) →
AgX tone mapping (`OutputPass`) → SMAA (Medium/High). Low renders without screen-space effects. The floor
shadow is a soft contact shadow baked once when the model loads (`src/post/createContactShadow.js`); the key
light's shadow map only self-shadows the head (Medium/High).

The **Life** panel (below Material, collapsed) manages the head's behavior live. *Alive* turns everything
on or off, and *Reset defaults* restores the settings. The mantis stays still and turns its head in quick
jumps toward the pointer or finger; with no pointer activity it looks around by itself and sometimes sways
sideways (*peering*). *Intensity* and *Speed* affect every effect; **Head** has *Enabled*, *Follow pointer*,
*Range* and *Saccade pause*; **Peering** has *Enabled*, *Frequency* (sways per minute) and *Amplitude*.
**Antennae** (they wander on their own, twitch and lag behind the head) has *Enabled*, *Amplitude* and
*Nervousness*; **Mouthparts** has *Palps*, *Mandibles* and *Frequency* (movements per minute).
The head returns to rest while the reference sheet is showing, and *Alive* starts off when the system asks
for reduced motion.

## 3D assets (Blender 4.5 LTS, headless)

```bash
npm run model:build       # tools/blender/build_head.py -> assets-src/models/mantis-head.raw.glb (ignored)
                          #   then glTF-Transform meshopt -> public/models/mantis-head.glb
                          #   then npm run textures:build
npm run textures:build    # tools/blender/bake_maps.py: bakes the cuticle atlas of the raw GLB (Cycles CPU)
                          #   -> assets-src/textures/*.png (ignored) -> public/textures/*.ktx2
npm run model:check       # measures the raw GLB against assets-src/reference/calibration.json (exit 1 on failure)
npm run model:silhouette  # front/right silhouette overlap (IoU) of the raw GLB vs the reference sheet
                          #   + front-view eye overlap and visible neck pixels
                          #   -> test-results/silhouette/*-diff.png + report.json
npm run reference:build   # crops the reference sheet into public/reference/*.webp
```

`model:silhouette` rasterizes the model on the same pixel grid as each sheet crop and compares head volumes:
both masks drop thin parts (antennae, palp tips), fill holes and are clipped by the view's `silhouetteClip`
lines in `calibration.json`. In the diff images green is shared, red is model only and blue is reference only.
In the front view it also uses a depth buffer to measure the visible eyes against the hand-traced `eyeOutlinePx`
polygons (`front-eyes-diff.png`) and to count the pixels where the neck is the front-most surface (the sheet hides
it). It only reports by default; pass thresholds to fail on them, e.g.
`npm run model:silhouette -- --min-front 0.945 --min-right 0.895 --min-eyes 0.93 --max-neck 0` (the T8b acceptance). Top and bottom
views are perspective shots on the sheet, so they stay a visual comparison (`Reference` toggle in the viewer).

`npm test` also checks the published GLB: required anatomical parts, segment counts (5-segment maxillary
palps, 3-segment labial palps, flagellum ≥ 40 segments with setae, toothed mandibles), carved sutures,
UVs on every primitive, and the budget (< 150k triangles, < 3 MB, meshopt).

### Materials and textures

`textures:build` needs `ktx` from [KTX-Software](https://github.com/KhronosGroup/KTX-Software/releases) ≥ 4.3
on the `PATH` (or `KTX=/path/to/ktx`); the Linux release tarball works without installing system-wide.
It re-imports the raw GLB, so the maps always match the UVs and MikkTSpace tangents of the exported model
(both are regenerated by every `model:build`). The skin, antenna, palp and mandible meshes share one UV atlas;
Cycles bakes it at 4K (position, normals, zone ids, procedural relief, inside-AO thickness, AO, tangent-space
normal) and numpy composes the albedo from the palette (olive in cavities, reddish-brown suture lines and eye
rims) and an ORM map: AO (R), roughness (G), thickness (B). Maps ship as KTX2 (Basis ETC1S, mipmapped) at
2048 (medium/high tiers) and 1024 (low tier); 4K is held back by the 6 MB first-load budget. The viewer loads
them with `KTX2Loader` and three's own Basis transcoder (bundled by Vite next to the loader chunk).

Viewer materials (`src/materials/`): the cuticle is a `MeshPhysicalMaterial` with the baked maps, a thin waxy
clearcoat and a back-light translucency term scaled by the baked thickness (antennae and palps glow when backlit).
The compound eyes compute their ommatidia in object space (3D cellular noise, seam-free) with a per-facet lens
normal, fade the pattern with `fwidth()` before it can alias, and darken a view-dependent pseudopupil where the
surface faces the camera; a clearcoat gives the wet highlight.

Skin → metal (`metalTransition.js`): every viewer material is extended with one shared set of uniforms, so the
slider, finishes and extra controls never recompile a shader. Each point gets an arrival time from its distance
to the mandible tips plus rotated fBm noise (`metalAdvance.js` mirrors the math and is unit-tested); the metal
dissolves forward from the mouth to the vertex and finally the antennae, with a thin, slightly glowing seam on
the front. Under the mask the shader blends albedo → F0 (measured values in `metalPresets.js`), metalness,
roughness, relief strength and clearcoat, removes the backlight translucency and evens out the environment
reflections. Cavities (baked AO, or the facet walls on the eyes, which keep their ommatidia) stay darker, and
Aged bronze fills them with verdigris. Because AgX rolls bright colors toward white, each finish carries a
saturation grade for its tint (copper needs the most, chrome none).

Geometry is authored in the web frame (+Y up, face toward +Z, 1 unit = 1 cm, head height 3.5).
`calibration.json` holds each reference view's crop, scale and origin plus the silhouette targets; the
large side view of the sheet is mirrored because it shows the opposite side to its own orthographic "Derecha" view.
