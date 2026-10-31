"""Measure the exported head GLB against the reference calibration targets.

Usage:
  blender -b --factory-startup --python-exit-code 1 --python tools/blender/check_proportions.py -- \
      public/models/mantis-head.glb assets-src/reference/calibration.json

Coordinates are reported in the web (glTF / three.js) frame: +Y up, the face looks toward +Z.
Exits non-zero when any measurement is outside the tolerance.
"""

import json
import os
import sys

import bpy
import numpy as np

# Antennae leave the frame in the reference and the neck is cropped, so they are not measured.
EXCLUDED_PREFIXES = ("antenna", "neck")
BAND = 0.05  # half-height of the horizontal slice used for silhouette samples


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 2:
        raise SystemExit("expected: <model.glb> <calibration.json>")
    return argv


def load_vertices(glb_path):
    if not os.path.exists(glb_path):
        raise SystemExit(f"model not found: {glb_path}")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    groups = {}
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        mesh = obj.evaluated_get(depsgraph).to_mesh()
        co = np.empty(len(mesh.vertices) * 3)
        mesh.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        world = np.array(obj.matrix_world)
        co = co @ world[:3, :3].T + world[:3, 3]
        # Blender (x, y, z) → glTF (x, z, -y)
        groups[obj.name] = np.column_stack([co[:, 0], co[:, 2], -co[:, 1]])
    return groups


def merged(groups, predicate):
    parts = [v for name, v in groups.items() if predicate(name.lower())]
    if not parts:
        raise SystemExit("no matching mesh objects")
    return np.vstack(parts)


def band(points, y):
    return points[np.abs(points[:, 1] - y) <= BAND]


def main():
    glb_path, calibration_path = parse_args()
    with open(calibration_path, encoding="utf-8") as f:
        targets = json.load(f)["targets"]
    tol = targets["tolerance"]

    groups = load_vertices(glb_path)
    body = merged(groups, lambda n: not n.startswith(EXCLUDED_PREFIXES))
    eyes = merged(groups, lambda n: n.startswith("eye"))

    rows = []

    def check(label, measured, expected):
        ok = measured is not None and abs(measured - expected) <= tol
        rows.append((label, expected, measured, ok))

    check("head width (eye to eye)", float(np.ptp(body[:, 0])), targets["headWidth"])
    check("head height (vertex to mandibles)", float(np.ptp(body[:, 1])), targets["headHeight"])
    check("eye outer x", float(np.abs(eyes[:, 0]).max()), targets["eyeOuterX"])
    check("eye height", float(np.ptp(eyes[:, 1])), targets["eyeHeight"])

    for y, expected in targets["frontHalfWidthByY"]:
        s = band(body, y)
        check(f"front half-width @ y={y:+.2f}", float(np.abs(s[:, 0]).max()) if len(s) else None, expected)
    for y, expected in targets["sideFrontZByY"]:
        s = band(body, y)
        check(f"side front z @ y={y:+.2f}", float(s[:, 2].max()) if len(s) else None, expected)
    for y, expected in targets["sideBackZByY"]:
        s = band(body, y)
        check(f"side back z @ y={y:+.2f}", float(s[:, 2].min()) if len(s) else None, expected)

    failures = 0
    print(f"\n{'measurement':38s} {'target':>8s} {'model':>8s} {'error':>7s}")
    for label, expected, measured, ok in rows:
        failures += not ok
        shown = "missing" if measured is None else f"{measured:8.3f}"
        error = "" if measured is None else f"{measured - expected:+7.3f}"
        print(f"{label:38s} {expected:8.3f} {shown:>8s} {error:>7s} {'ok' if ok else 'FAIL'}")
    print(f"\n{len(rows) - failures}/{len(rows)} within ±{tol}")
    if failures:
        raise SystemExit(1)


main()
