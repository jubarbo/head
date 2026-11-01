"""Compare the head with the reference sheet: silhouettes (front, right), eyes and neck (front).

Usage:
  blender -b --factory-startup --python-exit-code 1 --python tools/blender/check_silhouette.py -- \
      assets-src/models/mantis-head.raw.glb assets-src/reference/calibration.json \
      assets-src/reference/mantis-reference-sheet.png test-results/silhouette \
      [--min-front 0.96] [--min-right 0.92] [--min-eyes 0.9] [--max-neck 0]

For each view the model is rasterized on the same pixel grid as the sheet crop (origin, scale and mirroring
from calibration.json). Both silhouette masks get the same treatment: a morphological opening that drops thin
parts (antennae, palp tips) and hole filling, so the score compares head volumes, not thresholding artifacts.
Antennae and the neck are excluded from the silhouette, as in check_proportions.py, and both masks are clipped
by the view's `silhouetteClip` lines in calibration.json (antennae above the vertex; pronotum and forelegs
behind the gena in the right view).

Front view only, with a depth buffer (the camera looks down -Z):
- eyes: IoU between the visible eye pixels of the model and the hand-traced `eyeOutlinePx` polygons
  (crop pixels of the front view, traced along the eye rim of the sheet);
- neck: number of pixels where the neck is the front-most surface. The sheet hides the neck in this view.

Writes <out dir>/{front,right}-diff.png and front-eyes-diff.png (green: both, red: model only, blue:
reference only), report.json, prints the scores and exits non-zero only when a given threshold is not met.
Top and bottom views are perspective shots on the sheet, so they stay a visual comparison.
"""

import json
import os
import sys
from collections import deque

import bpy
import numpy as np

VIEWS = ("front", "right")
SILHOUETTE_EXCLUDED = ("antenna", "neck")
EYE_PREFIX = "eye"
NECK_PREFIX = "neck"
OPEN_RADIUS = 4  # px; removes antennae (~3-6 px wide on the sheet) and keeps the head volume
CLOSE_RADIUS = 2  # px; closes thin dark gaps (sutures, eye rims) inside the reference silhouette
BACKGROUND_DELTA = 0.06  # luminance above the backdrop median that counts as subject

# option -> (report key, comparison)
GATES = {
    "--min-front": (("front", "iou"), "min"),
    "--min-right": (("right", "iou"), "min"),
    "--min-eyes": (("frontEyes", "iou"), "min"),
    "--max-neck": (("frontNeck", "visiblePx"), "max"),
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    positional, gates = [], {}
    i = 0
    while i < len(argv):
        if argv[i].startswith("--"):
            if argv[i] not in GATES or i + 1 >= len(argv):
                raise SystemExit(f"unknown option or missing value: {argv[i]}")
            gates[argv[i]] = float(argv[i + 1])
            i += 2
        else:
            positional.append(argv[i])
            i += 1
    if len(positional) != 4:
        raise SystemExit("expected: <model.glb> <calibration.json> <sheet.png> <out dir> [" + "] [".join(f"{g} N" for g in GATES) + "]")
    return positional, gates


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


def polygon_mask(polygons, shape):
    """Even-odd fill of pixel centers inside any polygon (crop pixel coordinates)."""
    h, w = shape
    ys, xs = np.mgrid[0:h, 0:w]
    px, py = xs + 0.5, ys + 0.5
    mask = np.zeros(shape, dtype=bool)
    for polygon in polygons:
        inside = np.zeros(shape, dtype=bool)
        points = np.asarray(polygon, dtype=np.float64)
        for (ax, ay), (bx, by) in zip(points, np.roll(points, -1, axis=0)):
            if ay == by:
                continue
            crosses = (ay > py) != (by > py)
            x_at = ax + (py - ay) * (bx - ax) / (by - ay)
            inside ^= crosses & (px < x_at)
        mask |= inside
    return mask


# --- model rasterization -----------------------------------------------------------------------------------

def load_parts(glb_path):
    """{object name: world-space triangles (n, 3, 3)} in the web frame (+Y up, face toward +Z)."""
    if not os.path.exists(glb_path):
        raise SystemExit(f"model not found: {glb_path}")
    bpy.ops.import_scene.gltf(filepath=glb_path)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    parts = {}
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
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
        parts[obj.name.lower()] = co[indices.reshape(-1, 3)]
    return parts


def select(parts, predicate):
    chosen = [t for name, t in parts.items() if predicate(name)]
    if not chosen:
        raise SystemExit("no matching mesh objects in the model")
    return np.concatenate(chosen)


AXIS = {"+x": (0, 1.0), "+y": (1, 1.0), "+z": (2, 1.0), "-z": (2, -1.0)}


def project(triangles, view):
    """Web-frame triangles → pixel coordinates of the (mirrored) sheet crop. Rows grow downward."""
    (ui, us), (vi, vs) = AXIS[view["axes"]["u"]], AXIS[view["axes"]["v"]]
    ox, oy = view["originPx"]
    upp = view["unitsPerPx"]
    px = ox + (triangles[..., ui] * us - view["originUV"][0]) / upp
    py = oy - (triangles[..., vi] * vs - view["originUV"][1]) / upp
    return np.stack([px, py], axis=-1)


def covered(triangle, shape):
    """Bounding-box slices and barycentric weights of the pixel centers inside one 2D triangle."""
    (ax, ay), (bx, by), (cx, cy) = triangle
    h, w = shape
    x0, x1 = max(int(np.floor(min(ax, bx, cx))), 0), min(int(np.ceil(max(ax, bx, cx))), w - 1)
    y0, y1 = max(int(np.floor(min(ay, by, cy))), 0), min(int(np.ceil(max(ay, by, cy))), h - 1)
    area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if x0 > x1 or y0 > y1 or area == 0:
        return None
    ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
    px, py = xs + 0.5, ys + 0.5
    wa = ((cx - bx) * (py - by) - (cy - by) * (px - bx)) / area
    wb = ((ax - cx) * (py - cy) - (ay - cy) * (px - cx)) / area
    wc = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / area
    inside = (wa >= 0) & (wb >= 0) & (wc >= 0)
    return (slice(y0, y1 + 1), slice(x0, x1 + 1)), (wa, wb, wc), inside


def rasterize(triangles_px, shape):
    """Pixel-center coverage of 2D triangles (either winding)."""
    mask = np.zeros(shape, dtype=bool)
    for triangle in triangles_px:
        hit = covered(triangle, shape)
        if hit:
            window, _, inside = hit
            mask[window] |= inside
    return mask


def front_most(labelled, view, shape):
    """Label of the nearest surface per pixel in the front view (larger z is nearer); -1 for none."""
    depth = np.full(shape, -np.inf)
    labels = np.full(shape, -1, dtype=np.int32)
    for label, triangles in enumerate(labelled):
        projected = project(triangles, view)
        for triangle, z in zip(projected, triangles[..., 2]):
            hit = covered(triangle, shape)
            if not hit:
                continue
            window, (wa, wb, wc), inside = hit
            nearer = inside & (wa * z[0] + wb * z[1] + wc * z[2] > depth[window])
            depth[window] = np.where(nearer, wa * z[0] + wb * z[1] + wc * z[2], depth[window])
            labels[window] = np.where(nearer, label, labels[window])
    return labels


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


def overlap(model, reference):
    both = int((model & reference).sum())
    union = int((model | reference).sum())
    return {
        "iou": round(both / union, 4) if union else 0.0,
        "modelOnlyPx": int((model & ~reference).sum()),
        "referenceOnlyPx": int((~model & reference).sum()),
        "overlapPx": both,
    }


def main():
    (glb_path, calibration_path, sheet_path, out_dir), gates = parse_args()
    glb_path, calibration_path, sheet_path, out_dir = (os.path.abspath(p) for p in (glb_path, calibration_path, sheet_path, out_dir))
    with open(calibration_path, encoding="utf-8") as f:
        views = json.load(f)["views"]
    os.makedirs(out_dir, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    pixels = sheet_pixels(sheet_path)
    parts = load_parts(glb_path)
    head = select(parts, lambda n: not n.startswith(SILHOUETTE_EXCLUDED))

    report = {}
    for name in VIEWS:
        view = views[name]
        reference = reference_mask(pixels, view)
        model = normalize(rasterize(project(head, view), reference.shape) & clip_region(view, reference.shape))
        report[name] = overlap(model, reference)
        save_diff(model, reference, os.path.join(out_dir, f"{name}-diff.png"))

    front = views["front"]
    shape = (front["crop"][3] - front["crop"][1], front["crop"][2] - front["crop"][0])
    labelled = [
        select(parts, lambda n: n.startswith(EYE_PREFIX)),
        select(parts, lambda n: n.startswith(NECK_PREFIX)),
        select(parts, lambda n: not n.startswith((EYE_PREFIX, NECK_PREFIX, "antenna"))),
    ]
    labels = front_most(labelled, front, shape)
    eyes_model = labels == 0
    eyes_reference = polygon_mask(front["eyeOutlinePx"], shape)
    report["frontEyes"] = overlap(eyes_model, eyes_reference)
    report["frontNeck"] = {"visiblePx": int((labels == 1).sum())}
    save_diff(eyes_model, eyes_reference, os.path.join(out_dir, "front-eyes-diff.png"))

    with open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")

    failures = []
    for option, ((key, field), kind) in GATES.items():
        if option in gates:
            value, limit = report[key][field], gates[option]
            if (kind == "min" and value < limit) or (kind == "max" and value > limit):
                failures.append(f"{key} {field} {value} {'<' if kind == 'min' else '>'} {limit}")

    print(f"\n{'measure':12s} {'IoU':>7s} {'model only':>11s} {'ref only':>9s}")
    for key in ("front", "right", "frontEyes"):
        row = report[key]
        print(f"{key:12s} {row['iou']:7.4f} {row['modelOnlyPx']:11d} {row['referenceOnlyPx']:9d}")
    print(f"{'frontNeck':12s} visible neck px: {report['frontNeck']['visiblePx']}")
    for failure in failures:
        print(f"FAIL {failure}")
    print(f"\ndiff images and report.json in {out_dir}")
    if failures:
        raise SystemExit(1)


main()
