"""Generate the mantis head blockout (phase T1) and export it as GLB.

Usage:
  blender -b --factory-startup --python-exit-code 1 --python tools/blender/build_head.py -- public/models/mantis-head.glb

All shapes are authored in the web frame (glTF / three.js): +Y up, the face looks toward +Z,
1 unit = 1 cm, head height 3.5. `to_blender` converts to Blender's Z-up frame, and the glTF
exporter converts back, so numbers here match the viewer and assets-src/reference/calibration.json.
The head's left side is +X.
"""

import math
import os
import sys

import bmesh
import bpy
import numpy as np

VOXEL_SIZE = 0.025
CAPSULE_TRIANGLES = 40000

COLORS = {
    "clay": (0.62, 0.62, 0.60, 1.0),
    "clay_eye": (0.42, 0.44, 0.42, 1.0),
    "clay_dark": (0.20, 0.19, 0.18, 1.0),
}

# --- capsule volumes: (name, center, radii); unioned by voxel remesh ---------------------------
CAPSULE_PARTS = [
    ("vertex", (0.0, 1.05, -0.15), (1.3, 0.7, 1.05)),
    ("frons", (0.0, 0.45, 0.5), (0.85, 0.85, 0.65)),
    ("occiput", (0.0, 0.35, -0.6), (0.85, 0.85, 0.65)),
    ("gena_l", (0.5, -0.3, 0.55), (0.48, 0.5, 0.55)),
    ("gena_r", (-0.5, -0.3, 0.55), (0.48, 0.5, 0.55)),
    ("clypeus", (0.0, -0.55, 0.8), (0.62, 0.45, 0.48)),
    ("mouth_base", (0.0, -0.95, 0.85), (0.45, 0.4, 0.35)),
]

EYE = {
    "center": (1.28, 0.6, -0.25),
    "radii": (0.7, 1.15, 0.75),
    "tilt_x_deg": -45.0,  # long axis runs from lower-front to upper-back (side view)
    "lower_taper": 0.35,  # egg shape: narrower toward the bottom
    "lower_inset": 0.5,  # the lower half curves in toward the face (front view)
}

LABRUM = {"center": (0.0, -0.95, 1.05), "radii": (0.45, 0.38, 0.32)}

# Polylines in the web frame, listed for the head's left side (+X) and mirrored for the right.
MAXILLARY_PALP = [(0.55, -0.45, 0.85), (0.76, -0.85, 0.95), (0.52, -1.08, 1.05), (0.40, -1.40, 1.10), (0.30, -1.58, 1.12)]
MANDIBLE = [(0.32, -1.2, 1.0), (0.22, -1.5, 1.1), (0.10, -1.75, 1.18)]
ANTENNA_SOCKET = (0.48, 1.18, 0.7)
ANTENNA_DIRECTION = (0.45, 0.7, -0.55)  # up, out and back (front and top views)
ANTENNA_LENGTH = 5.0
OCELLI = [("ocellus_m", (0.0, 1.32, 0.76)), ("ocellus_l", (0.13, 1.18, 0.86)), ("ocellus_r", (-0.13, 1.18, 0.86))]
NECK = [(0.0, 0.0, -0.55), (0.0, -1.6, -1.15), (0.0, -2.7, -1.6)]  # drops under the occiput, leaning back


# --- helpers -------------------------------------------------------------------------------------

def to_blender(points):
    p = np.asarray(points, dtype=float).reshape(-1, 3)
    return np.column_stack([p[:, 0], -p[:, 2], p[:, 1]])


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


def material(name):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = COLORS[name]
        bsdf.inputs["Roughness"].default_value = 0.6
    return mat


def object_from_mesh(name, verts, faces, mat_name):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(to_blender(verts).tolist(), [], faces)
    mesh.validate()
    mesh.materials.append(material(mat_name))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj


def ellipsoid(name, center, radii, matrix=None, lower_taper=0.0, lower_inset=0.0, mirror=False,
              segments=64, rings=40, mat="clay"):
    """Local +X is "outward": the lower half tapers and shifts toward -X. `mirror` flips X."""
    verts = []
    for i in range(1, rings):
        phi = math.pi * i / rings
        for j in range(segments):
            theta = 2 * math.pi * j / segments
            x, y, z = math.sin(phi) * math.cos(theta), math.cos(phi), math.sin(phi) * math.sin(theta)
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
    for j in range(segments):
        faces.append((top, (j + 1) % segments, j))
        last = (rings - 2) * segments
        faces.append((bottom, last + j, last + (j + 1) % segments))
    if mirror:
        faces = [tuple(reversed(f)) for f in faces]  # keep normals outward after the flip
    return object_from_mesh(name, verts, faces, mat)


def tube(name, points, radius_start, radius_end, sides=12, step=0.04, mat="clay"):
    """Closed tube along a polyline, densified so silhouette slices always hit a ring."""
    pts = np.asarray(points, dtype=float)
    dense = [pts[0]]
    for a, b in zip(pts[:-1], pts[1:]):
        n = max(1, int(np.linalg.norm(b - a) / step))
        dense += [a + (b - a) * (k / n) for k in range(1, n + 1)]
    dense = np.array(dense)
    count = len(dense)
    tangents = np.gradient(dense, axis=0)
    tangents /= np.linalg.norm(tangents, axis=1, keepdims=True)
    ref = np.array([0.0, 0.0, 1.0]) if abs(tangents[0][2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    normal = np.cross(tangents[0], ref)
    normal /= np.linalg.norm(normal)
    verts = []
    for k in range(count):
        t = tangents[k]
        normal = normal - t * np.dot(normal, t)  # parallel transport keeps rings untwisted
        normal /= np.linalg.norm(normal)
        binormal = np.cross(t, normal)
        r = radius_start + (radius_end - radius_start) * k / (count - 1)
        for s in range(sides):
            a = 2 * math.pi * s / sides
            verts.append(dense[k] + r * (math.cos(a) * normal + math.sin(a) * binormal))
    verts += [dense[0], dense[-1]]
    start, end = len(verts) - 2, len(verts) - 1
    faces = []
    for k in range(count - 1):
        for s in range(sides):
            a, b = k * sides + s, k * sides + (s + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    for s in range(sides):
        faces.append((start, (s + 1) % sides, s))
        last = (count - 1) * sides
        faces.append((end, last + s, last + (s + 1) % sides))
    return object_from_mesh(name, verts, faces, mat)


def apply_modifier(obj, kind, **settings):
    mod = obj.modifiers.new(kind.lower(), kind)
    for key, value in settings.items():
        setattr(mod, key, value)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def triangle_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# --- build ---------------------------------------------------------------------------------------

def build_capsule():
    parts = [ellipsoid(name, c, r) for name, c, r in CAPSULE_PARTS]
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    capsule = bpy.context.view_layer.objects.active
    capsule.name = capsule.data.name = "head_capsule"
    apply_modifier(capsule, "REMESH", mode="VOXEL", voxel_size=VOXEL_SIZE, adaptivity=0.0)
    apply_modifier(capsule, "SMOOTH", factor=0.6, iterations=25)  # soft fillets between volumes
    ratio = min(1.0, CAPSULE_TRIANGLES / max(1, triangle_count(capsule)))
    apply_modifier(capsule, "DECIMATE", decimate_type="COLLAPSE", ratio=ratio)
    for poly in capsule.data.polygons:
        poly.use_smooth = True
    return capsule


def build_eyes():
    matrix = rotation("x", EYE["tilt_x_deg"])
    for suffix, mirror in (("l", False), ("r", True)):
        ellipsoid(f"eye_{suffix}", EYE["center"], EYE["radii"], matrix, EYE["lower_taper"], EYE["lower_inset"],
                  mirror=mirror, mat="clay_eye")


def build_appendages():
    ellipsoid("labrum", LABRUM["center"], LABRUM["radii"], segments=48, rings=24)
    for suffix, mirror in (("l", False), ("r", True)):
        flip = mirror_x if mirror else (lambda p: p)
        tube(f"maxillary_palp_{suffix}", flip(MAXILLARY_PALP), 0.07, 0.05)
        tube(f"mandible_{suffix}", flip(MANDIBLE), 0.13, 0.025, mat="clay_dark")

        socket = flip([ANTENNA_SOCKET])[0]
        ellipsoid(f"antenna_socket_{suffix}", socket, (0.12, 0.12, 0.08), segments=24, rings=12)
        direction = np.array(flip([ANTENNA_DIRECTION])[0])
        direction /= np.linalg.norm(direction)
        tip = np.array(socket) + direction * ANTENNA_LENGTH
        tube(f"antenna_{suffix}", [socket, tip], 0.05, 0.015, sides=8, step=0.2)
    for name, center in OCELLI:
        ellipsoid(name, center, (0.06, 0.06, 0.04), segments=16, rings=8, mat="clay_dark")
    tube("neck", NECK, 0.65, 0.6, sides=32, step=0.1)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 1:
        raise SystemExit("expected: <output.glb>")
    output = os.path.abspath(argv[0])
    os.makedirs(os.path.dirname(output), exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    capsule = build_capsule()
    build_eyes()
    build_appendages()

    total = sum(triangle_count(o) for o in bpy.context.scene.objects if o.type == "MESH")
    print(f"capsule triangles: {triangle_count(capsule)}, total: {total}")

    bpy.ops.export_scene.gltf(filepath=output, export_format="GLB", export_apply=True, export_yup=True)
    print(f"exported {output} ({os.path.getsize(output) / 1024:.0f} KiB)")


main()
