"""Bake the cuticle texture atlas of the mantis head and encode it as KTX2 (phase T3).

Usage:
  blender -b --factory-startup --python-exit-code 1 --python tools/blender/bake_maps.py -- \
      assets-src/models/mantis-head.raw.glb assets-src/textures public/textures

It re-imports the raw GLB exported by build_head.py, so the maps always match the exported UVs and
MikkTSpace tangents (both are regenerated on every model build). The skin, antenna, palp and mandible
meshes share one UV atlas (build_head.unwrap_all); eyes and ocelli are shaded procedurally in the
viewer, but stay in the scene so they occlude the capsule in the AO bake.

Cycles (CPU, fixed seed) bakes geometric passes at BAKE_SIZE: object-space position and normal,
zone ids, procedural relief signals, thickness (inside AO), AO and the tangent-space normal map with
the micro-relief bump. numpy then composes, per texel, the albedo (palette-based) and an ORM map:
AO (R), roughness (G), thickness for the viewer's translucency (B). Each map is written as PNG at
every tier size (assets-src/textures, ignored) and encoded with `ktx create` (KTX-Software 4.4,
set $KTX to override the binary) into public/textures/cuticle-<map>-<size>.ktx2.
"""

import math
import os
import shutil
import subprocess
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_head as head  # noqa: E402  (shape constants, frame helpers and suture lines)

BAKE_SIZE = int(os.environ.get("MANTIS_BAKE_SIZE", 4096))  # override only for quick previews
# Shipped sizes (src/materials/textureSet.js): 4K maps would break the 6 MB first-load budget, so
# the 4K bake only supersamples them (box filter), which anti-aliases the granules and sutures.
TIER_SIZES = tuple(s for s in (2048, 1024) if s <= BAKE_SIZE)  # src/quality/tiers.js textureSize per tier
BAKE_MARGIN = 24  # px at BAKE_SIZE; keeps mip levels from sampling the background
SEED = 7

ZONES = ("skin", "antenna", "palp", "mandible")  # build_head.ATLAS_MATERIALS, index = zone id
CAPSULE_INDEX = 1  # object pass index that marks the head capsule (sutures, eye rims)

# Relief per zone: (granule, vein, undulation) bump heights in cm. The cuticle has fine granules and
# raised veins (reference detail sheet); mandibles are smoother and harder, antennae finely grained.
RELIEF = {
    "skin": (0.0016, 0.0022, 0.004),
    "antenna": (0.0008, 0.0, 0.0015),
    "palp": (0.0010, 0.0008, 0.002),
    "mandible": (0.0004, 0.0, 0.0015),
}
GRANULE_SCALE = 55.0  # Voronoi cells per cm: ~0.018 cm granules
VEIN_SCALE = 3.2
MOTTLE_SCALE = 5.0

SUTURE_LINE = {"width": 0.010, "strength": 0.45}  # reddish-brown line along the carved grooves
EYE_RIM = {"inner": 0.015, "outer": 0.075, "strength": 0.8}  # band of capsule around each eye


def srgb_to_linear(hex_color):
    c = np.array([int(hex_color[i:i + 2], 16) / 255.0 for i in (1, 3, 5)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


# Palette (S1); suture/rim browns and the palp tan are sampled from the reference close-ups.
GREEN = srgb_to_linear("#8AA84B")
OLIVE = srgb_to_linear("#7A8238")
ANTENNA = srgb_to_linear("#A8764A")
MANDIBLE = srgb_to_linear("#5C3F2E")
CREAM = srgb_to_linear("#E6D2C0")
SUTURE_BROWN = srgb_to_linear("#7E4A2E")
MANDIBLE_TIP = srgb_to_linear("#2A1812")
PALP_TAN = srgb_to_linear("#B7A35E")


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    t = np.asarray(t)[..., None] if np.ndim(t) else t
    return a + (b - a) * t


# --- scene ---------------------------------------------------------------------------------------

def setup_scene(raw_glb):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=raw_glb)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.seed = SEED
    scene.cycles.use_animated_seed = False
    scene.world = bpy.data.worlds.new("bake")
    scene.world.light_settings.distance = 0.35  # AO reach in cm: grooves, sockets, eye rims

    atlas = []
    for obj in scene.objects:
        if obj.type != "MESH":
            continue
        if any(abs(v) > 1e-6 for row in (obj.matrix_world - Matrix.Identity(4)) for v in row):
            raise RuntimeError(f"{obj.name}: expected an identity transform (object space = web frame)")
        name = obj.data.materials[0].name if obj.data.materials else ""
        if name in ZONES:
            obj.pass_index = CAPSULE_INDEX if obj.name == "head_capsule" else 0
            atlas.append(obj)
    if not any(o.name == "head_capsule" for o in atlas):
        raise RuntimeError("head_capsule not found in the atlas meshes")
    return scene, atlas


def build_bake_material(mat, zone):
    """Replaces the clay material with a bake network. Returns the sockets each pass links to the
    emission, the image node every pass bakes into, and the links to toggle."""
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    coords = nodes.new("ShaderNodeTexCoord")
    geometry = nodes.new("ShaderNodeNewGeometry")
    info = nodes.new("ShaderNodeObjectInfo")

    def node(kind, **inputs):
        n = nodes.new(kind)
        for key, value in inputs.items():
            if isinstance(key, str) and key.startswith("_"):
                setattr(n, key[1:], value)
            elif hasattr(value, "is_output"):
                links.new(value, n.inputs[key])
            else:
                n.inputs[key].default_value = value
        return n

    def math_node(op, a, b=None):
        n = nodes.new("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if hasattr(v, "is_output"):
                links.new(v, n.inputs[i])
            else:
                n.inputs[i].default_value = v
        return n.outputs[0]

    obj_co = coords.outputs["Object"]
    granule_cells = node("ShaderNodeTexVoronoi", Vector=obj_co, Scale=GRANULE_SCALE, Randomness=0.85)
    granule = math_node("POWER", math_node("SUBTRACT", 1.0, granule_cells.outputs["Distance"]), 2.0)
    vein_noise = node("ShaderNodeTexNoise", Vector=obj_co, Scale=VEIN_SCALE, Detail=3.0, Roughness=0.55)
    ridge = math_node("SUBTRACT", 1.0, math_node("ABSOLUTE", math_node("SUBTRACT", math_node("MULTIPLY", vein_noise.outputs["Fac"], 2.0), 1.0)))
    veins = math_node("POWER", ridge, 14.0)  # thin bright crests of ridged noise read as veins
    mottle = node("ShaderNodeTexNoise", Vector=obj_co, Scale=MOTTLE_SCALE, Detail=4.0, Roughness=0.6).outputs["Fac"]

    g, v, u = RELIEF[zone]
    height = math_node("ADD", math_node("ADD", math_node("MULTIPLY", granule, g), math_node("MULTIPLY", veins, v)), math_node("MULTIPLY", mottle, u))
    bump = node("ShaderNodeBump", Height=height, Strength=1.0, Distance=1.0)
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    signals = node("ShaderNodeCombineXYZ", X=mottle, Y=veins, Z=granule)
    zone_id = node("ShaderNodeCombineXYZ", X=ZONES.index(zone) / 8.0, Y=info.outputs["Object Index"])
    inside = node("ShaderNodeAmbientOcclusion", Distance=0.25, _inside=True, _only_local=True, _samples=16)

    image_node = nodes.new("ShaderNodeTexImage")
    nodes.active = image_node
    sockets = {
        "position": obj_co,
        "normal_geo": geometry.outputs["Normal"],
        "zone": zone_id.outputs[0],
        "signals": signals.outputs[0],
        "thickness": inside.outputs["AO"],
    }
    return {"out": out, "emission": emission, "bsdf": bsdf, "image": image_node, "sockets": sockets, "links": links}


def bake(scene, atlas, networks, kind, image, socket=None, samples=1):
    for net in networks:
        net["image"].image = image
        links = net["links"]
        for link in list(net["out"].inputs["Surface"].links):
            links.remove(link)
        if kind == "EMIT":
            links.new(net["sockets"][socket], net["emission"].inputs["Color"])
            links.new(net["emission"].outputs[0], net["out"].inputs["Surface"])
        else:
            links.new(net["bsdf"].outputs[0], net["out"].inputs["Surface"])
    scene.cycles.samples = samples
    bpy.ops.object.select_all(action="DESELECT")
    for obj in atlas:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = atlas[0]
    extra = {"normal_space": "TANGENT"} if kind == "NORMAL" else {}
    # No Cycles margin: with several objects in one image, each object's margin overwrites the other
    # objects' islands. The shared margin is dilated once over the composed maps instead.
    bpy.ops.object.bake(type=kind, margin=0, use_clear=True, **extra)
    pixels = np.empty(BAKE_SIZE * BAKE_SIZE * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    print(f"baked {socket or kind.lower()}")
    return pixels.reshape(BAKE_SIZE, BAKE_SIZE, 4)


def bake_all(scene, atlas):
    image = bpy.data.images.new("bake", BAKE_SIZE, BAKE_SIZE, alpha=True, float_buffer=True)
    image.colorspace_settings.name = "Non-Color"
    networks = [build_bake_material(mat, mat.name) for mat in {o.data.materials[0] for o in atlas}]
    passes = {}
    for socket in ("position", "normal_geo", "zone", "signals"):
        passes[socket] = bake(scene, atlas, networks, "EMIT", image, socket)
    passes["covered"] = passes["position"][..., 3] > 0.5  # baked texels get alpha 1, the clear color 0
    passes["thickness"] = bake(scene, atlas, networks, "EMIT", image, "thickness", samples=4)[..., 0]
    passes["ao"] = bake(scene, atlas, networks, "AO", image, samples=48)[..., 0]
    passes["normal"] = bake(scene, atlas, networks, "NORMAL", image, samples=4)
    for key, value in passes.items():
        if value.ndim == 3:
            passes[key] = value[..., :3]
    print(f"atlas coverage: {passes['covered'].mean():.1%}")
    return passes


# --- composition ---------------------------------------------------------------------------------

def eye_distances(position, mask):
    """Distance from the masked texels (web frame) to the nearest compound eye surface."""
    eyes = [o for o in bpy.context.scene.objects if o.name.startswith("eye_")]
    distances = np.full(mask.sum(), np.inf, dtype=np.float32)
    points = position[mask]
    for eye in eyes:
        bvh = BVHTree.FromObject(eye, bpy.context.evaluated_depsgraph_get())
        lo, hi = head.to_web(np.array(eye.bound_box)).min(0) - 0.12, head.to_web(np.array(eye.bound_box)).max(0) + 0.12
        near = np.all((points >= lo) & (points <= hi), axis=1)
        blender_points = head.to_blender(points[near])
        found = np.array([bvh.find_nearest(Vector(p))[3] for p in blender_points], dtype=np.float32)
        idx = np.flatnonzero(near)
        distances[idx] = np.minimum(distances[idx], found)
    return distances


def compose(passes):
    position = head.to_web(passes["position"].reshape(-1, 3)).astype(np.float32)
    normal_geo = head.to_web(passes["normal_geo"].reshape(-1, 3)).astype(np.float32)
    zone = np.rint(passes["zone"][..., 0].ravel() * 8).astype(np.int8)
    capsule = passes["zone"][..., 1].ravel() > 0.5
    mottle, veins, granule = (passes["signals"][..., i].ravel() for i in range(3))
    ao = np.clip(passes["ao"].ravel(), 0.0, 1.0)
    thickness = np.clip(passes["thickness"].ravel(), 0.0, 1.0)
    cavity = smoothstep(0.95, 0.45, ao)
    n = len(ao)

    albedo = np.zeros((n, 3), dtype=np.float32)
    rough = np.zeros(n, dtype=np.float32)

    skin = zone == ZONES.index("skin")
    base = mix(GREEN, OLIVE, np.clip(0.25 + 0.75 * cavity, 0, 1)[skin])
    base = base * (0.86 + 0.28 * mottle[skin])[:, None] * (0.95 + 0.1 * granule[skin])[:, None]
    base = mix(base, mix(base, CREAM, 0.18) * 1.08, (veins[skin] * 0.5))
    # AgX tone mapping desaturates mid greens; pre-saturate so the render lands near #8AA84B
    luma = base @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    albedo[skin] = np.clip(luma[:, None] + (base - luma[:, None]) * 1.3, 0, 1)
    rough[skin] = 0.40 + 0.2 * cavity[skin] - 0.08 * granule[skin] + 0.08 * (mottle[skin] - 0.5)

    # capsule only: reddish-brown suture lines and eye rims, as on the reference front view
    cap = np.flatnonzero(skin & capsule)
    sutures = head.suture_distances(position[cap].astype(np.float64), normal_geo[cap].astype(np.float64))
    nearest = np.min(np.vstack(list(sutures.values())), axis=0)
    line = SUTURE_LINE["strength"] * np.exp(-((nearest / SUTURE_LINE["width"]) ** 2))
    rim = EYE_RIM["strength"] * smoothstep(EYE_RIM["outer"], EYE_RIM["inner"], eye_distances(position, skin & capsule))
    tint = np.clip(np.maximum(line, rim), 0, 1)
    albedo[cap] = mix(albedo[cap], SUTURE_BROWN, tint)
    rough[cap] += 0.05 * tint

    antenna = zone == ZONES.index("antenna")
    albedo[antenna] = ANTENNA * ((0.8 + 0.3 * mottle[antenna]) * (0.65 + 0.35 * ao[antenna]))[:, None]
    rough[antenna] = 0.5 + 0.1 * cavity[antenna]

    palp = zone == ZONES.index("palp")
    albedo[palp] = mix(PALP_TAN, ANTENNA, np.clip(cavity[palp] * 1.2, 0, 1)) * (0.85 + 0.25 * mottle[palp])[:, None]
    rough[palp] = 0.42 + 0.12 * cavity[palp]

    mandible = zone == ZONES.index("mandible")
    tip = smoothstep(-1.3, -1.7, position[mandible, 1])  # blades run down to y = -1.74
    albedo[mandible] = mix(MANDIBLE, MANDIBLE_TIP, tip) * (0.85 + 0.25 * mottle[mandible])[:, None]
    rough[mandible] = 0.32 - 0.1 * tip

    # AO floor: the sockets and the eye/capsule seams are fully enclosed, which reads as black holes
    orm = np.column_stack([0.3 + 0.7 * ao, np.clip(rough, 0.05, 1.0), thickness]).astype(np.float32)
    maps = {
        "albedo": albedo.reshape(BAKE_SIZE, BAKE_SIZE, 3),
        "orm": orm.reshape(BAKE_SIZE, BAKE_SIZE, 3),
        "normal": passes["normal"].astype(np.float32),
    }
    return dilate(maps, passes["covered"], BAKE_MARGIN)


def dilate(maps, covered, steps):
    """Extends every island outward by `steps` texels with the value of a nearby covered texel, so
    bilinear filtering and the smaller mip levels never pull in background texels. Propagates source
    indices (one int32 image) instead of the maps themselves to keep the 4K pass cheap."""
    source = np.where(covered, np.arange(covered.size, dtype=np.int32).reshape(covered.shape), -1)
    for _ in range(steps):
        empty = source < 0
        if not empty.any():
            break
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            shifted = np.roll(source, (dy, dx), axis=(0, 1))
            take = empty & (shifted >= 0)
            source[take] = shifted[take]
            empty &= ~take
    fill = ~covered & (source >= 0)
    for value in maps.values():
        flat = value.reshape(-1, value.shape[-1])
        flat[fill.ravel()] = flat[source[fill]]
    return maps


# --- output --------------------------------------------------------------------------------------

def downsample(image):
    h, w, c = image.shape
    return image.reshape(h // 2, 2, w // 2, 2, c).mean(axis=(1, 3))


def save_png(pixels, path):
    """`pixels` are already display/storage encoded values in 0..1 (bottom row first, as in Blender)."""
    h, w, _ = pixels.shape
    image = bpy.data.images.new(os.path.basename(path), w, h, alpha=False, float_buffer=False)
    image.colorspace_settings.name = "Non-Color"  # store the values as they are
    rgba = np.concatenate([np.clip(pixels, 0, 1), np.ones((h, w, 1), dtype=np.float32)], axis=2)
    image.pixels.foreach_set(rgba.astype(np.float32).ravel())
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


ENCODING = {
    # map: (format, transfer function, encoder arguments)
    "albedo": ("R8G8B8_SRGB", "srgb", ["--encode", "basis-lz", "--clevel", "4", "--qlevel", "180"]),
    "orm": ("R8G8B8_UNORM", "linear", ["--encode", "basis-lz", "--clevel", "4", "--qlevel", "200"]),
    # UASTC would be ~4x larger: the granule relief is high-frequency noise that RDO cannot shrink
    "normal": ("R8G8B8_UNORM", "linear", ["--encode", "basis-lz", "--clevel", "4", "--qlevel", "255"]),
}


def encode_ktx2(png, ktx2, kind):
    ktx = os.environ.get("KTX") or shutil.which("ktx")
    if ktx is None:
        raise SystemExit("ktx (KTX-Software >= 4.3) not found: install it or set $KTX")
    fmt, transfer, encoder = ENCODING[kind]
    subprocess.run([ktx, "create", "--format", fmt, "--assign-tf", transfer, "--generate-mipmap", *encoder, png, ktx2], check=True)


def write_maps(maps, png_dir, ktx_dir):
    os.makedirs(png_dir, exist_ok=True)
    os.makedirs(ktx_dir, exist_ok=True)
    for size in TIER_SIZES:
        while maps["albedo"].shape[0] > size:
            maps = {k: downsample(v) for k, v in maps.items()}
        normal = maps["normal"] * 2 - 1
        normal /= np.maximum(np.linalg.norm(normal, axis=2, keepdims=True), 1e-6)  # box filter shortens normals
        encoded = {"albedo": linear_to_srgb(maps["albedo"]), "orm": maps["orm"], "normal": normal * 0.5 + 0.5}
        for kind, pixels in encoded.items():
            png = os.path.join(png_dir, f"cuticle-{kind}-{size}.png")
            ktx2 = os.path.join(ktx_dir, f"cuticle-{kind}-{size}.ktx2")
            save_png(pixels.astype(np.float32), png)
            encode_ktx2(png, ktx2, kind)
            print(f"wrote {ktx2} ({os.path.getsize(ktx2) / 1024:.0f} KiB)")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 3:
        raise SystemExit("expected: <raw.glb> <png_dir> <ktx2_dir>")
    raw_glb, png_dir, ktx_dir = (os.path.abspath(a) for a in argv)
    scene, atlas = setup_scene(raw_glb)
    passes = bake_all(scene, atlas)
    maps = compose(passes)
    del passes
    write_maps(maps, png_dir, ktx_dir)


main()
