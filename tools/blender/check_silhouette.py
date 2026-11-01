"""Compare the head's orthographic silhouette with the reference sheet (front and right views).

Usage:
  blender -b --factory-startup --python-exit-code 1 --python tools/blender/check_silhouette.py -- \
      assets-src/models/mantis-head.raw.glb assets-src/reference/calibration.json \
      assets-src/reference/mantis-reference-sheet.png assets-src/reference/silhouette [--min-front 0.9 --min-right 0.85]

For each view the model is rasterized on the same pixel grid as the sheet crop (origin, scale and mirroring
from calibration.json). Both masks get the same treatment: a morphological opening that drops thin parts
(antennae, palp tips) and hole filling, so the score compares head volumes, not thresholding artifacts.
Antennae and the neck are excluded from the model, as in check_proportions.py, and both masks are clipped
by the view's `silhouetteClip` lines in calibration.json (antennae above the vertex; pronotum and forelegs
behind the gena in the right view).

Writes <out dir>/<view>-diff.png (green: both, red: model only, blue: reference only) and report.json,
prints the IoU per view and exits non-zero only when a --min-<view> threshold is given and not met.
Top and bottom views are perspective shots on the sheet, so they stay a visual comparison.
"""

import json
import os
import sys
from collections import deque

import bpy
import numpy as np

VIEWS = ("front", "right")
EXCLUDED_PREFIXES = ("antenna", "neck")
OPEN_RADIUS = 4  # px; removes antennae (~3-6 px wide on the sheet) and keeps the head volume
CLOSE_RADIUS = 2  # px; closes thin dark gaps (sutures, eye rims) inside the reference silhouette
BACKGROUND_DELTA = 0.06  # luminance above the backdrop median that counts as subject


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    positional, minimums = [], {}
    i = 0
    while i < len(argv):
        if argv[i].startswith("--min-"):
            view = argv[i][len("--min-"):]
            if view not in VIEWS or i + 1 >= len(argv):
                raise SystemExit(f"unknown option or missing value: {argv[i]}")
            minimums[view] = float(argv[i + 1])
            i += 2
        else:
            positional.append(argv[i])
            i += 1
    if len(positional) != 4:
        raise SystemExit("expected: <model.glb> <calibration.json> <sheet.png> <out dir> [--min-front X] [--min-right Y]")
    return positional, minimums


# --- binary morphology (numpy only; Blender ships without scipy) -------------------------------------------

def shifted(mask, dy, dx):
    out = np.zeros_like(mask)
    h, w = mask.shape
    out[max(dy, 0):h + min(dy, 0), max(dx, 0):w + min(dx, 0)] = mask[max(-dy, 0):h + min(-dy, 0), max(-dx, 0):w + min(-dx, 0)]
    return out


def disk_offsets(radius):
    return [(dy, dx) for dy in range(-radius, radius + 1) for dx in range(-radius, radius + 1) if dy * dy + dx * dx <= radius * radius]


def dilate(mask, radius):
    out = np.zeros_like(mask)
    for dy, dx in disk_offsets(radius):
        out |= shifted(mask, dy, dx)
    return out


def erode(mask, radius):
    return ~dilate(~mask, radius)


def flood(mask, seeds):
    """Pixels of `mask` 4-connected to any seed."""
    h, w = mask.shape
    seen = np.zeros_like(mask)
    queue = deque()
    for y, x in seeds:
        if mask[y, x] and not seen[y, x]:
            seen[y, x] = True
            queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                queue.append((ny, nx))
    return seen


def fill_holes(mask):
    h, w = mask.shape
    border = [(0, x) for x in range(w)] + [(h - 1, x) for x in range(w)] + [(y, 0) for y in range(h)] + [(y, w - 1) for y in range(h)]
    return ~flood(~mask, border)


def largest_component(mask):
    remaining = mask.copy()
    best = np.zeros_like(mask)
    while remaining.any():
        y, x = np.argwhere(remaining)[0]
        component = flood(remaining, [(y, x)])
        remaining &= ~component
        if component.sum() > best.sum():
            best = component
    return best


def normalize(mask):
    """Same treatment for reference and model: open away thin parts, keep the main body, fill holes."""
    opened = dilate(erode(mask, OPEN_RADIUS), OPEN_RADIUS)
    return fill_holes(largest_component(opened))


# --- reference masks ---------------------------------------------------------------------------------------

def sheet_pixels(path):
    image = bpy.data.images.load(path)
    w, h = image.size
    return np.array(image.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1]  # top row first


def clip_region(view, shape):
    """Pixels kept by the view's silhouetteClip lines: (u, v) left of every from→to line."""
    h, w = shape
    ys, xs = np.mgrid[0:h, 0:w]
    upp = view["unitsPerPx"]
    ox, oy = view["originPx"]
    u = (xs + 0.5 - ox) * upp + view["originUV"][0]
    v = (oy - ys - 0.5) * upp + view["originUV"][1]
    keep = np.ones(shape, dtype=bool)
    for line in view.get("silhouetteClip", []):
        (au, av), (bu, bv) = line["from"], line["to"]
        keep &= (bu - au) * (v - av) - (bv - av) * (u - au) >= 0
    return keep


def reference_mask(pixels, view):
    x0, y0, x1, y1 = view["crop"]
    crop = pixels[y0:y1, x0:x1, :3]
    if view["mirror"]:
        crop = crop[:, ::-1]
    luminance = crop @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    border = np.concatenate([luminance[0], luminance[-1], luminance[:, 0], luminance[:, -1]])
    mask = luminance > np.median(border) + BACKGROUND_DELTA
    closed = erode(dilate(mask, CLOSE_RADIUS), CLOSE_RADIUS)
    return normalize(closed & clip_region(view, mask.shape))


# --- model masks -------------------------------------------------------------------------------------------

def load_triangles(glb_path):
    """World-space triangles in the web frame (+Y up, face toward +Z), antennae and neck excluded."""
    if not os.path.exists(glb_path):
        raise SystemExit(f"model not found: {glb_path}")
    bpy.ops.import_scene.gltf(filepath=glb_path)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    triangles = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name.lower().startswith(EXCLUDED_PREFIXES):
            continue
        mesh = obj.evaluated_get(depsgraph).to_mesh()
        mesh.calc_loop_triangles()
        co = np.empty(len(mesh.vertices) * 3)
        mesh.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        world = np.array(obj.matrix_world)
        co = co @ world[:3, :3].T + world[:3, 3]
        co = np.column_stack([co[:, 0], co[:, 2], -co[:, 1]])  # Blender (x, y, z) → glTF (x, z, -y)
        indices = np.empty(len(mesh.loop_triangles) * 3, dtype=np.int64)
        mesh.loop_triangles.foreach_get("vertices", indices)
        triangles.append(co[indices.reshape(-1, 3)])
    if not triangles:
        raise SystemExit("no measurable mesh objects in the model")
    return np.concatenate(triangles)


AXIS = {"+x": (0, 1.0), "+y": (1, 1.0), "+z": (2, 1.0), "-z": (2, -1.0)}


def project(triangles, view):
    """Web-frame triangles → pixel coordinates of the (mirrored) sheet crop. Rows grow downward."""
    (ui, us), (vi, vs) = AXIS[view["axes"]["u"]], AXIS[view["axes"]["v"]]
    ox, oy = view["originPx"]
    upp = view["unitsPerPx"]
    px = ox + (triangles[..., ui] * us - view["originUV"][0]) / upp
    py = oy - (triangles[..., vi] * vs - view["originUV"][1]) / upp
    return np.stack([px, py], axis=-1)


def rasterize(triangles_px, shape):
    """Pixel-center coverage of 2D triangles (edge functions, either winding)."""
    h, w = shape
    mask = np.zeros(shape, dtype=bool)
    for (ax, ay), (bx, by), (cx, cy) in triangles_px:
        x0, x1 = max(int(np.floor(min(ax, bx, cx))), 0), min(int(np.ceil(max(ax, bx, cx))), w - 1)
        y0, y1 = max(int(np.floor(min(ay, by, cy))), 0), min(int(np.ceil(max(ay, by, cy))), h - 1)
        if x0 > x1 or y0 > y1:
            continue
        area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
        if area == 0:
            continue
        ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        px, py = xs + 0.5, ys + 0.5
        e0 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * area
        e1 = ((cx - bx) * (py - by) - (cy - by) * (px - bx)) * area
        e2 = ((ax - cx) * (py - cy) - (ay - cy) * (px - cx)) * area
        mask[y0:y1 + 1, x0:x1 + 1] |= (e0 >= 0) & (e1 >= 0) & (e2 >= 0)
    return mask


# --- output ------------------------------------------------------------------------------------------------

def save_diff(model, reference, path):
    h, w = model.shape
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    rgba[..., 3] = 1.0
    rgba[model & reference] = (0.25, 0.75, 0.3, 1.0)
    rgba[model & ~reference] = (0.9, 0.2, 0.2, 1.0)
    rgba[~model & reference] = (0.2, 0.4, 0.95, 1.0)
    image = bpy.data.images.new(os.path.basename(path), w, h)
    image.pixels[:] = np.ascontiguousarray(rgba[::-1]).ravel()
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()


def main():
    (glb_path, calibration_path, sheet_path, out_dir), minimums = parse_args()
    glb_path, calibration_path, sheet_path, out_dir = (os.path.abspath(p) for p in (glb_path, calibration_path, sheet_path, out_dir))
    with open(calibration_path, encoding="utf-8") as f:
        views = json.load(f)["views"]
    os.makedirs(out_dir, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    pixels = sheet_pixels(sheet_path)
    triangles = load_triangles(glb_path)

    report = {}
    for name in VIEWS:
        view = views[name]
        reference = reference_mask(pixels, view)
        model = normalize(rasterize(project(triangles, view), reference.shape) & clip_region(view, reference.shape))
        both = int((model & reference).sum())
        union = int((model | reference).sum())
        report[name] = {
            "iou": round(both / union, 4) if union else 0.0,
            "modelOnlyPx": int((model & ~reference).sum()),
            "referenceOnlyPx": int((~model & reference).sum()),
            "overlapPx": both,
        }
        save_diff(model, reference, os.path.join(out_dir, f"{name}-diff.png"))

    with open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")

    failures = 0
    print(f"\n{'view':8s} {'IoU':>7s} {'min':>6s} {'model only':>11s} {'ref only':>9s}")
    for name, row in report.items():
        minimum = minimums.get(name)
        ok = minimum is None or row["iou"] >= minimum
        failures += not ok
        shown_min = "-" if minimum is None else f"{minimum:.2f}"
        print(f"{name:8s} {row['iou']:7.4f} {shown_min:>6s} {row['modelOnlyPx']:11d} {row['referenceOnlyPx']:9d} {'' if ok else 'FAIL'}")
    print(f"\ndiff images and report.json in {out_dir}")
    if failures:
        raise SystemExit(1)


main()
