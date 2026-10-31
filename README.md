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
**Quality** defaults to *Auto*: it starts from a device guess and steps between Low / Medium / High from the measured frame rate.

## Tooling

3D assets are generated with headless Blender 4.5 LTS (`blender -b --python tools/blender/...`), added from phase T1.
