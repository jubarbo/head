"""Crop the reference sheet into per-view overlay images for the viewer.

Usage:
  blender -b --factory-startup --python-exit-code 1 --python tools/blender/build_reference.py -- \
      assets-src/reference/mantis-reference-sheet.png assets-src/reference/calibration.json public/reference

Crop boxes and mirroring come from calibration.json, so overlays and measurements share one source.
"""

import json
import os
import sys

import bpy
import numpy as np


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 3:
        raise SystemExit("expected: <sheet.png> <calibration.json> <output dir>")
    sheet_path, calibration_path, out_dir = (os.path.abspath(a) for a in argv)
    os.makedirs(out_dir, exist_ok=True)
    with open(calibration_path, encoding="utf-8") as f:
        views = json.load(f)["views"]

    sheet = bpy.data.images.load(sheet_path)
    width, height = sheet.size
    pixels = np.array(sheet.pixels[:], dtype=np.float32).reshape(height, width, 4)[::-1]  # top row first

    scene = bpy.context.scene
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.quality = 85
    scene.render.image_settings.color_mode = "RGB"

    for name, view in views.items():
        x0, y0, x1, y1 = view["crop"]
        crop = pixels[y0:y1, x0:x1]
        if view["mirror"]:
            crop = crop[:, ::-1]
        image = bpy.data.images.new(f"ref_{name}", x1 - x0, y1 - y0)
        image.pixels[:] = np.ascontiguousarray(crop[::-1]).ravel()
        path = os.path.join(out_dir, f"{name}.webp")
        image.save_render(path, scene=scene)
        print(f"{name}: {x1 - x0}x{y1 - y0} -> {path}")


main()
