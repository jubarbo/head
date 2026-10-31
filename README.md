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
```

## Controls

| Action | Mouse / trackpad | Touch |
|---|---|---|
| Rotate | Left drag | One finger |
| Zoom | Wheel / middle drag | Pinch |
| Pan | Right drag, or Shift/Ctrl/Cmd + left drag | Two fingers (three fingers: pan only) |

Panel buttons jump to the reference views (Front, Side, Top, Bottom) and **Reset view** returns to the framed front view.
**Reference** overlays the matching crop of the reference sheet and switches to a 6° telephoto lens so the comparison is close to orthographic; orbiting hides the overlay until a view button is pressed again.
**Quality** defaults to *Auto*: it starts from a device guess and steps between Low / Medium / High from the measured frame rate.

## 3D assets (Blender 4.5 LTS, headless)

```bash
npm run model:build       # tools/blender/build_head.py -> assets-src/models/mantis-head.raw.glb (ignored)
                          #   then glTF-Transform meshopt -> public/models/mantis-head.glb
npm run model:check       # measures the raw GLB against assets-src/reference/calibration.json (exit 1 on failure)
npm run reference:build   # crops the reference sheet into public/reference/*.webp
```

`npm test` also checks the published GLB: required anatomical parts, segment counts (5-segment maxillary
palps, 3-segment labial palps, flagellum ≥ 40 segments with setae, toothed mandibles), carved sutures,
UVs on every primitive, and the budget (< 150k triangles, < 3 MB, meshopt).

Geometry is authored in the web frame (+Y up, face toward +Z, 1 unit = 1 cm, head height 3.5).
`calibration.json` holds each reference view's crop, scale and origin plus the silhouette targets; the
large side view of the sheet is mirrored because it shows the opposite side to its own orthographic "Derecha" view.
