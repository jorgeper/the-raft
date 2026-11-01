"""Assembles the playable Viking in Blender from Quaternius' CC0 packs and exports viking_raw.glb.

Run inside a fresh Blender file (File > New > General; the glTF importer reuses images already in the file, so a
second run would tint them twice) from the Scripting tab or Blender MCP's execute_blender_code, after unzipping
the free tiers of
  - Universal Base Characters   https://quaternius.itch.io/universal-base-characters
  - Modular Character Outfits - Fantasy   https://quaternius.itch.io/modular-character-outfits-fantasy
into one folder, then set Q and OUT below. Then build the web files with
  node scripts/build-character.mjs <OUT> <UAL1_Standard.glb>
See docs/CHARACTER.md.
"""
import math
import bmesh
import bpy
import numpy as np

Q = "/path/to/quaternius"  # folder holding the unzipped packs
OUT = "/path/to/viking_raw.glb"

BASE = Q + "/universal-base-characters/Universal Base Characters[Standard]"
OUTFITS = Q + "/modular-character-outfits-fantasy/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)"
HAIR = BASE + "/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)"
FILES = {
    "ranger": OUTFITS + "/Outfits/Male_Ranger.gltf",
    "hero": BASE + "/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf",
    "beard": HAIR + "/Hair_Beard.gltf",
    "hair": HAIR + "/Hair_Long.gltf",
}

# A clean scene of its own, so nothing else in the file gets exported.
scene = bpy.data.scenes.new("VikingBuild")
bpy.context.window.scene = scene
for key, path in FILES.items():
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    for o in set(scene.objects) - before:
        o["src"] = key
# Bone-shape widgets come in as loose icospheres.
for o in [o for o in scene.objects if o.type == "MESH" and o.parent is None]:
    bpy.data.objects.remove(o, do_unlink=True)

arms = {o["src"]: o for o in scene.objects if o.type == "ARMATURE"}
arm = arms["ranger"]
# By base name: Blender appends ".001" when the file already holds objects with these names.
base_name = lambda n: n.rsplit(".", 1)[0] if n.rsplit(".", 1)[-1].isdigit() else n
meshes = {base_name(o.name): o for o in scene.objects if o.type == "MESH"}

# Hood off, so the hair and beard show.
bpy.data.objects.remove(meshes.pop("Male_Ranger_Head_Hood"), do_unlink=True)

# Hair_Long was rigged on a smaller body: move it onto this head.
head = lambda a: a.matrix_world @ a.data.bones["Head"].head_local
delta = head(arm) - head(arms["hair"])
for v in meshes["Hair_Long"].data.vertices:
    v.co += delta

# Keep only the head of the superhero body (the outfit covers the rest).
hero = meshes["SuperHero_Male"]
bm = bmesh.new()
bm.from_mesh(hero.data)
groups = {g.index: g.name for g in hero.vertex_groups}
deform = bm.verts.layers.deform.active
kill = [v for v in bm.verts if sum(w for i, w in v[deform].items() if groups.get(i) == "Head") < 0.5]
bmesh.ops.delete(bm, geom=kill, context="VERTS")
bm.to_mesh(hero.data)
bm.free()

# Everything onto the ranger's armature (all four share the same 65-bone skeleton).
for name in ["SuperHero_Male", "Eyes", "Eyebrows", "Hair_Beard", "Hair_Long"]:
    o = meshes[name]
    mw = o.matrix_world.copy()
    o.parent = arm
    o.matrix_world = mw
    for m in o.modifiers:
        if m.type == "ARMATURE":
            m.object = arm
for key in ["hero", "beard", "hair"]:
    bpy.data.objects.remove(arms[key], do_unlink=True)

# Materials: drop the vertex-color multiply (the colors are all white) so glTF exports plain textures.
for o in arm.children:
    while len(o.data.color_attributes):
        o.data.color_attributes.remove(o.data.color_attributes[0])
for m in bpy.data.materials:
    if not m.node_tree:
        continue
    nt = m.node_tree
    for mix in [n for n in nt.nodes if n.type == "MIX"]:
        src = next((l.from_socket for l in nt.links if l.to_node == mix and l.from_node.type == "TEX_IMAGE"), None)
        for dst in [l.to_socket for l in nt.links if l.from_node == mix]:
            if src:
                nt.links.new(src, dst)
        nt.nodes.remove(mix)
    for n in [n for n in nt.nodes if n.type == "VERTEX_COLOR"]:
        nt.nodes.remove(n)


def pixels(im):
    a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(-1, 4)


def store(im, a):
    im.pixels.foreach_set(a.ravel())
    im.update()


# Dark auburn hair and beard (the textures are grey, meant to be tinted).
for im in {im for im in bpy.data.images if im.name.startswith(("T_Hair_1_BaseColor", "T_Hair_2_BaseColor"))}:
    p = pixels(im)
    g = p[:, :3].mean(1, keepdims=True)
    p[:, :3] = np.clip(g**1.15 * np.array([1.18, 0.62, 0.34], np.float32), 0, 1) * np.array([0.6, 0.5, 0.48], np.float32)
    store(im, p)

# Outfit: the green cloth becomes Valheim-blue wool; leather and metal stay.
im = next(im for im in bpy.data.images if im.name.startswith("T_Ranger_BaseColor"))
p = pixels(im)
r, g, b = p[:, 0], p[:, 1], p[:, 2]
mx = np.maximum(np.maximum(r, g), b)
d = mx - np.minimum(np.minimum(r, g), b) + 1e-6
h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
s = d / (mx + 1e-6)
green = (h > 70) & (h < 170) & (s > 0.15)
H, S, V = 215.0 / 60, s * 0.85, mx
C = V * S
X = C * (1 - abs(H % 2 - 1))
m = V - C
# Hue 215 falls in sector 3 (180-240): (r, g, b) = (0, X, C).
p[green, 0] = m[green]
p[green, 1] = (X + m)[green]
p[green, 2] = (C + m)[green]
store(im, p)

# Cloak: a flared, wrapped sheet hanging from the shoulders, weighted spine_03 -> spine_01 -> pelvis.
COLS, ROWS, TOP, BOTTOM = 10, 16, 1.47, 0.5
verts, faces, weights = [], [], []
for j in range(ROWS + 1):
    t = j / ROWS
    z = TOP + (BOTTOM - TOP) * t
    half = 0.17 + 0.17 * t**0.8
    back = 0.15 + 0.15 * t**1.3
    wrap = 1.1 - 0.35 * t
    for i in range(COLS + 1):
        u = i / COLS * 2 - 1
        ang = u * wrap
        x = math.sin(ang) / math.sin(wrap) * half
        y = back - (1 - math.cos(ang)) * (0.16 - 0.08 * t) + 0.012 * math.sin(i * math.pi * 0.9) * t
        verts.append((x, y, z))
        if t < 0.22:
            weights.append({"spine_03": 1.0})
        elif t < 0.6:
            k = (t - 0.22) / 0.38
            weights.append({"spine_03": 1 - k, "spine_01": k})
        else:
            k = (t - 0.6) / 0.4
            weights.append({"spine_01": 1 - 0.6 * k, "pelvis": 0.6 * k})
for j in range(ROWS):
    for i in range(COLS):
        a = j * (COLS + 1) + i
        faces.append((a, a + 1, a + COLS + 2, a + COLS + 1))
me = bpy.data.meshes.new("Cloak")
me.from_pydata(verts, [], faces)
uv = me.uv_layers.new(name="UVMap")
for poly in me.polygons:
    poly.use_smooth = True
    for li in poly.loop_indices:
        vi = me.loops[li].vertex_index
        uv.data[li].uv = ((vi % (COLS + 1)) / COLS, 1 - (vi // (COLS + 1)) / ROWS)
cloak = bpy.data.objects.new("Cloak", me)
scene.collection.objects.link(cloak)
cloak.parent = arm
for vi, w in enumerate(weights):
    for bone, wt in w.items():
        (cloak.vertex_groups.get(bone) or cloak.vertex_groups.new(name=bone)).add([vi], wt, "REPLACE")
cloak.modifiers.new("Armature", "ARMATURE").object = arm

# Crimson wool with a gold-brown hem, painted procedurally.
N = 512
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) / N
noise = np.random.default_rng(7).random((N, N)).astype(np.float32)
for _ in range(3):
    noise = (noise + np.roll(noise, 1, 0) + np.roll(noise, 1, 1) + np.roll(noise, -1, 0) + np.roll(noise, -1, 1)) / 5
weave = 0.5 + 0.5 * np.sin(xx * N * 0.9) * np.sin(yy * N * 0.9)
folds = 0.5 + 0.5 * np.cos(xx * np.pi * 9.0)
shade = (0.78 + 0.12 * folds + 0.48 * (noise - 0.5) + 0.05 * weave)[..., None]
hem = ((yy < 0.06) | ((yy > 0.085) & (yy < 0.1)))[..., None]
col = np.where(hem, np.array([0.55, 0.38, 0.12], np.float32), np.array([0.36, 0.06, 0.05], np.float32)) * shade
cloth = bpy.data.images.new("T_Cloak", N, N)
store(cloth, np.concatenate([col, np.ones((N, N, 1), np.float32)], -1))
mat = bpy.data.materials.new("MI_Cloak")
mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Roughness"].default_value = 0.9
tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = cloth
mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
mat.use_backface_culling = False
me.materials.append(mat)

# Web-sized textures, packed so the edited pixels are what gets exported.
for im in bpy.data.images:
    if im.size[0] == 0 or im.name == "Viewer Node":
        continue
    target = 512 if "Hair" in im.name or "Eye" in im.name else 1024
    if im.size[0] > target:
        im.scale(target, target)
    im.pack()

bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
for c in arm.children:
    c.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_animations=False, export_skins=True, export_morph=False, use_active_scene=True)
print("exported", OUT)
