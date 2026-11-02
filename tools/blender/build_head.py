"""Generate the mantis head (phase T2: anatomical detail) and export it as GLB.

Usage:
  blender -b --factory-startup --python-exit-code 1 --python tools/blender/build_head.py -- assets-src/models/mantis-head.raw.glb

The raw GLB is uncompressed (Blender can re-import it for `model:check`); `npm run model:build`
then meshopt-compresses it into public/models/mantis-head.glb.

All shapes are authored in the web frame (glTF / three.js): +Y up, the face looks toward +Z,
1 unit = 1 cm, head height 3.5. `to_blender` converts to Blender's Z-up frame, and the glTF
exporter converts back, so numbers here match the viewer and assets-src/reference/calibration.json.
The head's left side is +X. Coordinates come from the front/side reference crops (see calibration.json).
"""

import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

VOXEL_SIZE = 0.015  # fine enough to carve sutures before decimation
CAPSULE_TRIANGLES = 60000

# Neutral clay per material zone. The viewer replaces them by material name (src/materials/) with
# the baked maps from tools/blender/bake_maps.py; these only show up in other glTF viewers.
COLORS = {
    "skin": (0.62, 0.62, 0.60, 1.0),
    "eye": (0.42, 0.44, 0.42, 1.0),
    "ocellus": (0.30, 0.30, 0.30, 1.0),
    "antenna": (0.55, 0.52, 0.48, 1.0),
    "palp": (0.58, 0.57, 0.52, 1.0),
    "mandible": (0.20, 0.19, 0.18, 1.0),
}

# --- capsule volumes: (name, center, radii[, ellipsoid_mesh options]); unioned by voxel remesh ---
# Fitted to the sheet with `npm run model:silhouette` (T8b, see odd/tasks/mantis-head-3d.md L32-L33).
CAPSULE_PARTS = [
    ("vertex", (0.0, 1.1, -0.25), (1.125, 0.67, 0.92), {"squareness": 0.7}),  # broad, flat-topped vertex
    ("frons", (0.0, 0.45, 0.7), (0.875, 0.85, 0.45)),  # flat shield, as in the front view
    ("occiput", (0.0, 0.35, -0.45), (0.85, 0.85, 0.85)),
    ("gena_l", (0.56, -0.24, 0.45), (0.53, 0.5, 0.55)),
    ("gena_r", (-0.56, -0.24, 0.45), (0.53, 0.5, 0.55)),
    ("clypeus", (0.0, -0.55, 0.84), (0.62, 0.45, 0.48)),
    ("mouth_base", (0.0, -0.95, 0.85), (0.45, 0.4, 0.35)),
]

# Sutures as grooves in the front (x, y) projection, measured on the front crop.
FRONS = {"half_width": 0.66, "top": 1.04, "bottom": 0.13}
EPICRANIAL_START = 1.42  # above the median ocellus (y = 1.3), as in the insect
CLYPEUS = {"half_width": 0.53, "bottom": -0.42}
SUBGENAL = ((0.68, 0.13), (0.48, -0.89))
GROOVE = {"depth": 0.07, "width": 0.035}
# Frons and clypeus read as flat shields: each is pressed onto a plane set just under the crest of the
# fitted volumes (z at its bottom and top edges, measured on the capsule), which raises its borders into
# a ledge at the sutures. Offsets are along z only, so the front outline holds.
PLATES = [
    {"half_width": FRONS["half_width"], "bottom": FRONS["bottom"], "top": FRONS["top"], "z_bottom": 1.11, "z_top": 1.03, "crown": 0.04},
    {"half_width": CLYPEUS["half_width"], "bottom": CLYPEUS["bottom"], "top": FRONS["bottom"], "z_bottom": 1.24, "z_top": 1.10, "crown": 0.12},
]
PLATE_EDGE = 0.08
PLATE_FLATTEN = 0.85
PLATE_REACH = {"near": 0.2, "far": 0.32}  # surface deeper than this behind a plane is the side wall, not the plate
STRIATION = {"period": 0.06, "depth": 0.005, "margin": 0.08, "wave": 0.012}  # fine transverse ridges on the frons

EYE = {
    "center": (1.28, 0.6, 0.45),  # forward enough that the frons does not cover the inner rim (front view)
    "radii": (0.7, 1.09, 0.75),
    "tilt_x_deg": -42.0,  # long axis runs from lower-front to upper-back (side view)
    "lower_taper": 0.35,  # egg shape: narrower toward the bottom
    "lower_inset": 0.3,  # the lower half curves in toward the face (front view)
}

LABRUM = {"center": (0.0, -0.91, 1.08), "radii": (0.48, 0.43, 0.28)}
LABIUM = {"center": (0.0, -1.3, 0.75), "radii": (0.32, 0.12, 0.28)}
MAXILLA = {"center": (0.42, -1.15, 0.9), "radii": (0.13, 0.3, 0.12)}

# Polylines for the head's left side (+X), mirrored for the right. One polyline edge per segment.
MAXILLARY_PALP = [(0.5, -0.5, 0.82), (0.72, -0.85, 0.98), (0.5, -1.1, 1.1), (0.38, -1.35, 1.2), (0.27, -1.55, 1.28), (0.1, -1.72, 1.33)]  # long in depth: the front view caps its drop
MAXILLARY_PALP_RADII = [0.085, 0.08, 0.075, 0.065, 0.05]
LABIAL_PALP = [(0.16, -1.35, 0.82), (0.2, -1.5, 1.0), (0.14, -1.63, 1.15), (0.08, -1.72, 1.25)]
LABIAL_PALP_RADII = [0.055, 0.05, 0.04]
MANDIBLE = [(0.34, -1.05, 0.98), (0.3, -1.45, 1.12), (-0.04, -1.74, 1.17)]
MANDIBLE_TEETH = (0.45, 0.6, 0.75)  # positions along the blade, on its inner edge

ANTENNA_SOCKET_XY = (0.48, 1.15)
ANTENNA_DIRECTION = (0.45, 0.7, -0.55)  # up, out and back (front and top views)
ANTENNA = {"scape": (0.25, 0.075), "pedicel": (0.15, 0.055), "flagellum_length": 5.0, "flagellum_segments": 50,
           "radius_base": 0.045, "radius_tip": 0.012, "droop": 0.35}
OCELLI_XY = [("ocellus_m", (0.0, 1.3)), ("ocellus_l", (0.13, 1.18)), ("ocellus_r", (-0.13, 1.18))]
NECK = [(0.0, 0.1, -0.5), (0.0, -0.5, -1.3), (0.0, -1.0, -2.3)]  # drops back from the occiput; the steepest path the head still hides in the front view


# --- frame and geometry helpers ------------------------------------------------------------------

def to_blender(points):
    p = np.asarray(points, dtype=float).reshape(-1, 3)
    return np.column_stack([p[:, 0], -p[:, 2], p[:, 1]])


def to_web(points):
    p = np.asarray(points, dtype=float).reshape(-1, 3)
    return np.column_stack([p[:, 0], p[:, 2], -p[:, 1]])


def rotation(axis, degrees):
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    if axis == "x":
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == "z":
        return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    raise ValueError(axis)


def mirror_x(points):
    return [(-x, y, z) for x, y, z in points]


def unit(v):
    v = np.asarray(v, dtype=float)
    return v / np.linalg.norm(v)


def frame_from_normal(normal):
    """3x3 matrix whose columns are (tangent, normal, bitangent): local +Y maps onto `normal`."""
    n = unit(normal)
    t = unit(np.cross(n, [0.0, 0.0, 1.0] if abs(n[2]) < 0.9 else [1.0, 0.0, 0.0]))
    return np.column_stack([t, n, np.cross(t, n)])


def material(name):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = COLORS[name]
        bsdf.inputs["Roughness"].default_value = 0.6
    return mat


def object_from_mesh(name, verts, faces, mat_name, **extras):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(to_blender(verts).tolist(), [], faces)
    mesh.validate()
    mesh.materials.append(material(mat_name))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = True
    for key, value in extras.items():
        obj[key] = value  # exported as glTF node extras
    return obj


def squared(value, exponent):
    """Superellipsoid profile: exponent 1 keeps the ellipse, < 1 flattens the sides into a rounded box."""
    return math.copysign(abs(value) ** exponent, value)


def ellipsoid_mesh(center, radii, matrix=None, lower_taper=0.0, lower_inset=0.0, mirror=False, segments=64, rings=40,
                   squareness=1.0):
    """Local +X is "outward": the lower half tapers and shifts toward -X. `mirror` flips X."""
    verts = []
    for i in range(1, rings):
        phi = math.pi * i / rings
        for j in range(segments):
            theta = 2 * math.pi * j / segments
            sp, cp = squared(math.sin(phi), squareness), squared(math.cos(phi), squareness)
            x, y, z = sp * squared(math.cos(theta), squareness), cp, sp * squared(math.sin(theta), squareness)
            low = max(0.0, -y)
            taper = 1.0 - lower_taper * low
            inset = lower_inset * low * low
            verts.append(((x * taper - inset) * radii[0], y * radii[1], z * radii[2] * taper))
    # poles get the same shaping as the rings, otherwise the inset leaves a spike at the bottom
    verts = np.array(verts + [(0, radii[1], 0), (-lower_inset * radii[0], -radii[1], 0)])
    if matrix is not None:
        verts = verts @ np.asarray(matrix).T
    verts += np.asarray(center)
    if mirror:
        verts[:, 0] *= -1
    faces = []
    for i in range(rings - 2):
        for j in range(segments):
            a, b = i * segments + j, i * segments + (j + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    top, bottom = len(verts) - 2, len(verts) - 1
    last = (rings - 2) * segments
    for j in range(segments):
        faces.append((top, (j + 1) % segments, j))
        faces.append((bottom, last + j, last + (j + 1) % segments))
    if mirror:
        faces = [tuple(reversed(f)) for f in faces]  # keep normals outward after the flip
    return verts, faces


def tube_mesh(points, radius_fn, sides=12, step=0.04, flatten=1.0, twist_ref=None):
    """Closed tube along a polyline. `radius_fn(segment_index, t)` gives the radius at fraction t of
    a polyline edge, so each edge can be one articulated segment. `flatten` squashes the cross-section."""
    pts = np.asarray(points, dtype=float)
    dense, labels = [pts[0]], [(0, 0.0)]
    for index, (a, b) in enumerate(zip(pts[:-1], pts[1:])):
        n = max(2, int(np.linalg.norm(b - a) / step))
        for k in range(1, n + 1):
            dense.append(a + (b - a) * (k / n))
            labels.append((index, k / n))
    dense = np.array(dense)
    count = len(dense)
    tangents = np.gradient(dense, axis=0)
    tangents /= np.linalg.norm(tangents, axis=1, keepdims=True)
    ref = np.asarray(twist_ref if twist_ref is not None else ([0.0, 0.0, 1.0] if abs(tangents[0][2]) < 0.9 else [1.0, 0.0, 0.0]))
    normal = unit(np.cross(tangents[0], ref))
    verts = []
    for k in range(count):
        t = tangents[k]
        normal = unit(normal - t * np.dot(normal, t))  # parallel transport keeps rings untwisted
        binormal = np.cross(t, normal)
        r = radius_fn(*labels[k])
        for s in range(sides):
            a = 2 * math.pi * s / sides
            verts.append(dense[k] + r * (math.cos(a) * normal + flatten * math.sin(a) * binormal))
    verts += [dense[0], dense[-1]]
    start, end = len(verts) - 2, len(verts) - 1
    faces = []
    for k in range(count - 1):
        for s in range(sides):
            a, b = k * sides + s, k * sides + (s + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    last = (count - 1) * sides
    for s in range(sides):
        faces.append((start, (s + 1) % sides, s))
        faces.append((end, last + s, last + (s + 1) % sides))
    return np.array(verts), faces, dense, tangents


def cone_mesh(base, direction, length, radius, sides=5):
    d = unit(direction)
    frame = frame_from_normal(d)
    t, b = frame[:, 0], frame[:, 2]
    base = np.asarray(base, dtype=float)
    verts = [base + radius * (math.cos(2 * math.pi * s / sides) * t + math.sin(2 * math.pi * s / sides) * b) for s in range(sides)]
    verts.append(base + d * length)
    tip = sides
    # fan-triangulated base: MikkTSpace tangents (glTF export) fail on n-gons
    faces = [(s, (s + 1) % sides, tip) for s in range(sides)] + [(0, s + 1, s) for s in range(1, sides - 1)]
    return np.array(verts), faces


def torus_mesh(center, normal, major, minor, sides=20, rings=8):
    frame = frame_from_normal(normal)
    t, n, b = frame[:, 0], frame[:, 1], frame[:, 2]
    verts = []
    for i in range(sides):
        u = 2 * math.pi * i / sides
        radial = math.cos(u) * t + math.sin(u) * b
        for j in range(rings):
            v = 2 * math.pi * j / rings
            verts.append(np.asarray(center) + (major + minor * math.cos(v)) * radial + minor * math.sin(v) * n)
    faces = [(i * rings + j, ((i + 1) % sides) * rings + j, ((i + 1) % sides) * rings + (j + 1) % rings, i * rings + (j + 1) % rings)
             for i in range(sides) for j in range(rings)]
    return np.array(verts), faces


def merge(parts):
    verts, faces, offset = [], [], 0
    for v, f in parts:
        verts.append(np.asarray(v))
        faces += [tuple(i + offset for i in face) for face in f]
        offset += len(v)
    return np.vstack(verts), faces


def segmented_radius(radii, joint=0.2):
    """Each segment bulges in the middle and narrows at the joints."""
    def radius(index, t):
        return radii[index] * (1.0 - joint + joint * math.sin(math.pi * t) ** 0.5)
    return radius


def apply_modifier(obj, kind, **settings):
    mod = obj.modifiers.new(kind.lower(), kind)
    for key, value in settings.items():
        setattr(mod, key, value)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def triangle_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# --- capsule -------------------------------------------------------------------------------------

def segment_distance(p, a, b):
    """Distance from 2D points p (N, 2) to the segment a-b."""
    a, b = np.asarray(a), np.asarray(b)
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0.0, 1.0)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


def suture_distances(co, normals):
    """Distance from every vertex to each suture line; inf where the suture does not apply."""
    x, y = co[:, 0], co[:, 1]
    front = normals[:, 2] > 0.3
    inf = np.full(len(co), np.inf)
    within = lambda lo, hi, v: (v >= lo) & (v <= hi)
    fw, cw = FRONS["half_width"], CLYPEUS["half_width"]
    xy = co[:, :2]
    subgenal = np.minimum(segment_distance(xy, *SUBGENAL), segment_distance(xy * [-1, 1], *SUBGENAL))
    return {
        # midline groove over the vertex, from the top of the frons backward
        "epicranial": np.where((y > EPICRANIAL_START) & (normals[:, 1] > -0.2), np.abs(x), inf),
        "frons_upper": np.where(front & within(-fw, fw, x), np.abs(y - FRONS["top"]), inf),
        "frons_lateral": np.where(front & within(FRONS["bottom"], FRONS["top"], y), np.abs(np.abs(x) - fw), inf),
        "frontoclypeal": np.where(front & within(-fw, fw, x), np.abs(y - FRONS["bottom"]), inf),
        "clypeolabral": np.where(front & within(-cw, cw, x), np.abs(y - CLYPEUS["bottom"]), inf),
        "subgenal": np.where(front, subgenal, inf),
    }


def soft_box(v, lo, hi, edge):
    """1 inside [lo, hi], fading to 0 over `edge` just inside each bound."""
    t = np.clip(np.minimum(v - lo, hi - v) / edge, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def plate_offsets(co, normals):
    """Z offset per vertex that flattens the frons and clypeus and striates the frons."""
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    front = np.clip((normals[:, 2] - 0.1) / 0.3, 0.0, 1.0)
    offsets = np.zeros(len(co))
    for plate in PLATES:
        half, bottom, top = plate["half_width"], plate["bottom"], plate["top"]
        along = (y - bottom) / (top - bottom)
        plane = plate["z_bottom"] + along * (plate["z_top"] - plate["z_bottom"]) - plate["crown"] * (x / half) ** 2
        reach = np.clip((PLATE_REACH["far"] - np.abs(plane - z)) / (PLATE_REACH["far"] - PLATE_REACH["near"]), 0.0, 1.0)
        mask = soft_box(x, -half, half, PLATE_EDGE) * soft_box(y, bottom, top, PLATE_EDGE) * front * reach * reach * (3.0 - 2.0 * reach)
        offsets += mask * PLATE_FLATTEN * (plane - z)
    margin, half = STRIATION["margin"], FRONS["half_width"]
    inner = soft_box(x, -half + margin, half - margin, PLATE_EDGE) * soft_box(y, FRONS["bottom"] + margin, FRONS["top"] - margin, PLATE_EDGE)
    wavy_y = y + STRIATION["wave"] * (np.sin(x * 11.0) + np.sin(x * 23.0 + 1.0))
    return offsets - inner * front * STRIATION["depth"] * (0.5 + 0.5 * np.cos(2.0 * np.pi * wavy_y / STRIATION["period"]))


def shape_plates(obj):
    mesh = obj.data
    count = len(mesh.vertices)
    co = np.empty(count * 3)
    normals = np.empty(count * 3)
    mesh.vertices.foreach_get("co", co)
    mesh.vertices.foreach_get("normal", normals)
    co_web, n_web = to_web(co), to_web(normals)
    co_web[:, 2] += plate_offsets(co_web, n_web)
    mesh.vertices.foreach_set("co", to_blender(co_web).ravel())
    mesh.update()


def carve_sutures(obj):
    mesh = obj.data
    count = len(mesh.vertices)
    co = np.empty(count * 3)
    normals = np.empty(count * 3)
    mesh.vertices.foreach_get("co", co)
    mesh.vertices.foreach_get("normal", normals)
    co_web, n_web = to_web(co), to_web(normals)
    distances = suture_distances(co_web, n_web)
    nearest = np.min(np.vstack(list(distances.values())), axis=0)
    depth = GROOVE["depth"] * np.exp(-((nearest / GROOVE["width"]) ** 2))
    mesh.vertices.foreach_set("co", to_blender(co_web - n_web * depth[:, None]).ravel())
    mesh.update()
    return list(distances.keys())


def build_capsule():
    parts = []
    for name, center, radii, *shape in CAPSULE_PARTS:
        verts, faces = ellipsoid_mesh(center, radii, **(shape[0] if shape else {}))
        parts.append(object_from_mesh(name, verts, faces, "skin"))
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    capsule = bpy.context.view_layer.objects.active
    capsule.name = capsule.data.name = "head_capsule"
    apply_modifier(capsule, "REMESH", mode="VOXEL", voxel_size=VOXEL_SIZE, adaptivity=0.0)
    apply_modifier(capsule, "SMOOTH", factor=0.6, iterations=40)  # soft fillets between volumes
    shape_plates(capsule)
    capsule["sutures"] = carve_sutures(capsule)
    ratio = min(1.0, CAPSULE_TRIANGLES / max(1, triangle_count(capsule)))
    apply_modifier(capsule, "DECIMATE", decimate_type="COLLAPSE", ratio=ratio)
    for poly in capsule.data.polygons:
        poly.use_smooth = True
    return capsule


def surface_from_front(bvh, x, y):
    """First capsule hit of a ray shot from the front (+Z) toward the head: (point, normal) in web frame."""
    origin = Vector(to_blender([(x, y, 5.0)])[0])
    direction = Vector(to_blender([(0.0, 0.0, -1.0)])[0])
    hit, normal, _, _ = bvh.ray_cast(origin, direction)
    if hit is None:
        raise RuntimeError(f"no capsule surface at x={x}, y={y}")
    return to_web([hit])[0], unit(to_web([normal])[0])


# --- parts ---------------------------------------------------------------------------------------

def build_eyes():
    # roll (front view) after tilt (side view); positive roll leans the top of the left eye outward
    matrix = rotation("z", -EYE.get("roll_z_deg", 0.0)) @ rotation("x", EYE["tilt_x_deg"])
    for suffix, mirror in (("l", False), ("r", True)):
        verts, faces = ellipsoid_mesh(EYE["center"], EYE["radii"], matrix, EYE["lower_taper"], EYE["lower_inset"], mirror=mirror)
        object_from_mesh(f"eye_{suffix}", verts, faces, "eye")


def build_ocelli(bvh):
    for name, (x, y) in OCELLI_XY:
        point, normal = surface_from_front(bvh, x, y)
        verts, faces = ellipsoid_mesh(point, (0.07, 0.035, 0.07), frame_from_normal(normal), segments=20, rings=10)
        object_from_mesh(name, verts, faces, "ocellus")


def build_antenna(bvh, side, suffix):
    x, y = ANTENNA_SOCKET_XY
    point, normal = surface_from_front(bvh, side * x, y)
    socket = torus_mesh(point, normal, 0.11, 0.035)
    object_from_mesh(f"antenna_socket_{suffix}", *socket, "skin")

    direction = unit(np.array(ANTENNA_DIRECTION) * [side, 1, 1])
    scape_len, scape_r = ANTENNA["scape"]
    pedicel_len, pedicel_r = ANTENNA["pedicel"]
    base = point - normal * 0.03
    scape_end = base + unit(normal + direction) * scape_len
    pedicel_end = scape_end + direction * pedicel_len

    n = ANTENNA["flagellum_segments"]
    length = ANTENNA["flagellum_length"]
    droop = np.array([side * 0.15, -1.0, -0.3]) * ANTENNA["droop"]
    flagellum = [pedicel_end + direction * length * (k / n) + droop * (k / n) ** 2 for k in range(n + 1)]
    radii = [ANTENNA["radius_base"] + (ANTENNA["radius_tip"] - ANTENNA["radius_base"]) * k / (n - 1) for k in range(n)]

    pieces = [
        tube_mesh([base, scape_end], segmented_radius([scape_r], 0.25), sides=12, step=0.05)[:2],
        tube_mesh([scape_end, pedicel_end], segmented_radius([pedicel_r], 0.25), sides=10, step=0.04)[:2],
    ]
    verts, faces, dense, tangents = tube_mesh(flagellum, segmented_radius(radii, 0.18), sides=8, step=length / n / 4)
    pieces.append((verts, faces))

    # two short setae at the distal end of every flagellomere, pointing forward and outward
    setae = 0
    for k in range(1, n + 1):
        joint = flagellum[k] if k < n else flagellum[-1]
        t = unit(flagellum[k] - flagellum[k - 1])
        side_axis = unit(np.cross(t, [0.0, 0.0, 1.0] if abs(t[2]) < 0.9 else [1.0, 0.0, 0.0]))
        for sign in (1, -1):
            out = unit(t * 0.85 + side_axis * sign * 0.5)
            pieces.append(cone_mesh(joint + side_axis * sign * radii[k - 1] * 0.8, out, 0.06, 0.006, sides=4))
            setae += 1
    object_from_mesh(f"antenna_{suffix}", *merge(pieces), "antenna",
                     segments=n + 2, flagellum_segments=n, setae=setae)


def build_mouthparts():
    verts, faces = ellipsoid_mesh(LABRUM["center"], LABRUM["radii"], segments=48, rings=24)
    object_from_mesh("labrum", verts, faces, "skin")
    verts, faces = ellipsoid_mesh(LABIUM["center"], LABIUM["radii"], segments=32, rings=16)
    object_from_mesh("labium", verts, faces, "skin")

    for suffix, side in (("l", 1), ("r", -1)):
        flip = (lambda p: p) if side == 1 else mirror_x

        center = np.array(MAXILLA["center"]) * [side, 1, 1]
        verts, faces = ellipsoid_mesh(center, MAXILLA["radii"], segments=24, rings=12)
        object_from_mesh(f"maxilla_{suffix}", verts, faces, "palp")

        verts, faces, _, _ = tube_mesh(flip(MAXILLARY_PALP), segmented_radius(MAXILLARY_PALP_RADII), sides=10, step=0.03)
        object_from_mesh(f"maxillary_palp_{suffix}", verts, faces, "palp", segments=len(MAXILLARY_PALP_RADII))
        verts, faces, _, _ = tube_mesh(flip(LABIAL_PALP), segmented_radius(LABIAL_PALP_RADII), sides=8, step=0.025)
        object_from_mesh(f"labial_palp_{suffix}", verts, faces, "palp", segments=len(LABIAL_PALP_RADII))

        # curved, flattened blade with teeth along its inner (medial) edge
        path = flip(MANDIBLE)
        blade_radius = lambda index, t: (0.19 - 0.17 * ((index + t) / (len(path) - 1)))
        verts, faces, dense, tangents = tube_mesh(path, blade_radius, sides=12, step=0.03, flatten=0.55, twist_ref=[0.0, 0.0, 1.0])
        pieces = [(verts, faces)]
        for fraction in MANDIBLE_TEETH:
            k = int(fraction * (len(dense) - 1))
            r = blade_radius(0, fraction * (len(path) - 1))
            medial = unit(np.array([-side, 0.0, 0.0]) - tangents[k] * np.dot([-side, 0.0, 0.0], tangents[k]))
            pieces.append(cone_mesh(dense[k] + medial * r * 0.7, medial + tangents[k] * 0.4, 0.1, 0.04))
        object_from_mesh(f"mandible_{suffix}", *merge(pieces), "mandible", teeth=len(MANDIBLE_TEETH))


def build_neck():
    verts, faces, _, _ = tube_mesh(NECK, lambda index, t: 0.5 - 0.04 * (index + t) / 2, sides=32, step=0.1)
    object_from_mesh("neck", verts, faces, "skin")


def is_atlas_material(name):
    """Materials whose meshes share the baked texture atlas (see bake_maps.py)."""
    return name in ATLAS_MATERIALS


ATLAS_MATERIALS = ("skin", "antenna", "palp", "mandible")
UV_ISLAND_MARGIN = 0.008  # ~32 px at 4K: room for the bake margin and the smaller mip levels


def smart_unwrap(objects):
    """One smart UV projection over several objects: multi-object editing packs all their islands
    into a single 0..1 space, so they can share one set of baked maps without overlapping."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=UV_ISLAND_MARGIN)
    bpy.ops.object.mode_set(mode="OBJECT")


def unwrap_all():
    """The cuticle parts share the bake atlas; eyes and ocelli are shaded procedurally in object
    space, so they get their own UVs (kept for glTF validity) and leave the atlas to the cuticle."""
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    atlas = [o for o in meshes if is_atlas_material(o.data.materials[0].name)]
    smart_unwrap(atlas)
    smart_unwrap([o for o in meshes if o not in atlas])


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 1:
        raise SystemExit("expected: <output.glb>")
    output = os.path.abspath(argv[0])
    os.makedirs(os.path.dirname(output), exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    capsule = build_capsule()
    bvh = BVHTree.FromObject(capsule, bpy.context.evaluated_depsgraph_get())
    build_eyes()
    build_ocelli(bvh)
    for suffix, side in (("l", 1), ("r", -1)):
        build_antenna(bvh, side, suffix)
    build_mouthparts()
    build_neck()
    unwrap_all()

    total = sum(triangle_count(o) for o in bpy.context.scene.objects if o.type == "MESH")
    print(f"capsule triangles: {triangle_count(capsule)}, total: {total}")

    bpy.ops.export_scene.gltf(filepath=output, export_format="GLB", export_apply=True, export_yup=True, export_extras=True,
                              export_tangents=True)  # the baked tangent-space normal map needs Blender's MikkTSpace
    print(f"exported {output} ({os.path.getsize(output) / 1024:.0f} KiB)")


if __name__ == "__main__":  # bake_maps.py imports the shape constants and suture helpers
    main()
