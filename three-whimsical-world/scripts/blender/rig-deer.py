"""Rig and animate the deer: run in Blender (Scripting tab, or MCP `exec(open(path).read())`).

Imports `public/models/deer.glb` (the metaball doe and stag, unrigged), builds one armature both bodies share,
skins them with automatic weights, keys five looping clips procedurally and exports `public/models/deer.glb`
back with the skeleton and animations. Set ROOT (below, or before exec()) to the project folder.

Blender axes: the deer faces +Y, up is +Z, +X is its right side (three: faces -Z, up +Y).
Clips (no root motion; the game moves the deer and scales playback by speed):
  Idle    4 s   breathing, head drifting, tail flicks (keyed; the game doesn't use it yet)
  Graze   4 s   muzzle in the grass, nibbling, head drifting sideways
  Alert   3 s   head high, turning to look
  Walk    1.1 s lateral four-beat walk (LH, LF, RH, RF) at ~1.1 m/s
  Gallop  0.5 s bounding gallop, spine flexing, at ~9 m/s
"""

import math
import bpy
from mathutils import Quaternion, Vector

# The project folder: set ROOT before exec() (MCP), or edit the placeholder.
ROOT = globals().get('ROOT', '/path/to/3d-tests')
SRC = f'{ROOT}/public/models/deer.glb'
OUT = f'{ROOT}/public/models/deer.glb'
FPS = 30

# --- Scene -----------------------------------------------------------------------------------------------------------
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.actions):
    for block in list(coll):
        coll.remove(block)
scene = bpy.context.scene
scene.render.fps = FPS
bpy.ops.import_scene.gltf(filepath=SRC)
# A previous run's export brings its armature back: keep only the two bodies, unparented and unskinned.
for o in list(bpy.data.objects):
    if o.type == 'ARMATURE':
        bpy.data.objects.remove(o, do_unlink=True)
bodies = [bpy.data.objects['Doe'], bpy.data.objects['Stag']]
for b in bodies:
    mw = b.matrix_world.copy()
    b.parent = None
    b.matrix_world = mw
    for m in list(b.modifiers):
        b.modifiers.remove(m)
    b.vertex_groups.clear()
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

# --- Armature --------------------------------------------------------------------------------------------------------
# (name, head, tail, parent). Coordinates measured from slices of the mesh.
BONES = [
    ('root', (0, 0, 0), (0, 0.3, 0), None),
    ('hips', (0, -0.42, 1.0), (0, -0.02, 1.02), 'root'),
    ('spine', (0, -0.02, 1.02), (0, 0.42, 1.06), 'hips'),
    ('neck1', (0, 0.42, 1.1), (0, 0.6, 1.34), 'spine'),
    ('neck2', (0, 0.6, 1.34), (0, 0.76, 1.56), 'neck1'),
    ('head', (0, 0.76, 1.56), (0, 1.12, 1.5), 'neck2'),
    ('tail', (0, -0.78, 1.14), (0, -0.9, 0.98), 'hips'),
]
for s, side in (('L', -1), ('R', 1)):
    x = 0.12 * side
    BONES += [
        (f'upperF.{s}', (x * 0.85, 0.42, 0.95), (x, 0.44, 0.62), 'spine'),
        (f'foreF.{s}', (x, 0.44, 0.62), (x, 0.44, 0.36), f'upperF.{s}'),
        (f'cannonF.{s}', (x, 0.44, 0.36), (x, 0.46, 0.1), f'foreF.{s}'),
        (f'hoofF.{s}', (x, 0.46, 0.1), (x, 0.48, 0.0), f'cannonF.{s}'),
        (f'thigh.{s}', (x * 0.85, -0.45, 0.96), (x, -0.52, 0.64), 'hips'),
        (f'shin.{s}', (x, -0.52, 0.64), (x, -0.66, 0.39), f'thigh.{s}'),
        (f'cannonH.{s}', (x, -0.66, 0.39), (x, -0.59, 0.1), f'shin.{s}'),
        (f'hoofH.{s}', (x, -0.59, 0.1), (x, -0.57, 0.0), f'cannonH.{s}'),
    ]

arm_data = bpy.data.armatures.new('DeerRig')
rig = bpy.data.objects.new('DeerRig', arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name, head, tail, parent in BONES:
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail = Vector(head), Vector(tail)
    eb.roll = 0
    if parent:
        eb.parent = arm_data.edit_bones[parent]
        eb.use_connect = (Vector(head) - arm_data.edit_bones[parent].tail).length < 1e-4
arm_data.edit_bones['root'].use_deform = False
bpy.ops.object.mode_set(mode='OBJECT')

# --- Skin ------------------------------------------------------------------------------------------------------------
for b in bodies:
    bpy.ops.object.select_all(action='DESELECT')
    b.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')


def segment_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t - p).length


def clean_weights(body):
    """Bone heat can't reach separate islands (antlers, ears) and leaks across legs; fix both by region."""
    groups = {g.name: g for g in body.vertex_groups}
    names = {g.index: g.name for g in body.vertex_groups}
    segs = {b.name: (b.head_local, b.tail_local) for b in arm_data.bones if b.use_deform}
    head = groups['head']
    fixed = 0
    for v in body.data.vertices:
        p = v.co
        # Head, ears, antlers and muzzle ride on the head bone alone.
        if p.z > 1.68 or (p.y > 0.86 and p.z > 1.3):
            for g in list(v.groups):
                if names[g.group] != 'head':
                    groups[names[g.group]].remove([v.index])
            head.add([v.index], 1.0, 'REPLACE')
            fixed += 1
            continue
        keep = []
        for g in v.groups:
            n = names[g.group]
            ok = True
            if '.' in n:
                side = n.split('.')[1]
                front = 'F.' in n
                if (side == 'R' and p.x < -0.02) or (side == 'L' and p.x > 0.02):
                    ok = False
                if (front and p.y < -0.15) or (not front and p.y > 0.15):
                    ok = False
            if n == 'tail' and p.y > -0.62:
                ok = False
            if ok and g.weight > 1e-4:
                keep.append((n, g.weight))
            else:
                groups[n].remove([v.index])
        if not keep:
            nearest = min(segs, key=lambda n: segment_distance(p, *segs[n]))
            groups[nearest].add([v.index], 1.0, 'REPLACE')
            fixed += 1
            continue
        total = sum(w for _, w in keep)
        for n, w in keep:
            groups[n].add([v.index], w / total, 'REPLACE')
    print(body.name, 'reassigned', fixed, 'vertices')


for b in bodies:
    clean_weights(b)

# --- Animation helpers -----------------------------------------------------------------------------------------------
pose = rig.pose
for pb in pose.bones:
    pb.rotation_mode = 'QUATERNION'
# Each bone's armature-space rest orientation, to turn world-axis rotations into its local frame.
REST = {b.name: b.matrix_local.to_3x3() for b in arm_data.bones}
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def rot(name, axis, deg):
    """A rotation about an armature axis (X pitches: + swings a leg forward / lifts a bone's tip; Z yaws)."""
    local_axis = (REST[name].inverted() @ axis).normalized()
    return Quaternion(local_axis, math.radians(deg))


def key_clip(name, seconds, pose_at):
    """Keys `pose_at(t)` (t in 0..1, looping) on every frame of a new action. pose_at returns
    {bone: Quaternion | (Quaternion, Vector)}."""
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action
    frames = max(2, round(seconds * FPS))
    for f in range(frames + 1):
        t = (f % frames) / frames
        poses = pose_at(t)
        for pb in pose.bones:
            q, loc = Quaternion(), Vector()
            v = poses.get(pb.name)
            if isinstance(v, tuple):
                q, loc = v
            elif v is not None:
                q = v
            pb.rotation_quaternion = q
            pb.location = loc
            pb.keyframe_insert('rotation_quaternion', frame=f + 1)
            pb.keyframe_insert('location', frame=f + 1)
    # Linear keys: the cycle is sampled densely, and linear avoids overshoot at the loop seam.
    for fc in _fcurves(action):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 1, action)
    rig.animation_data.action = None
    return action


def _fcurves(action):
    # Blender 4.4+ keeps f-curves in layered channelbags; older versions on the action itself.
    if hasattr(action, 'layers') and action.layers:
        out = []
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    out.extend(bag.fcurves)
        return out
    return list(action.fcurves)


TAU = 2 * math.pi
s = math.sin
c = math.cos


def leg_front(side, ph, swing, lift):
    """Front leg at gait phase ph (0..1, 0 = hoof planted forward). swing: degrees each way; lift: knee fold."""
    a = TAU * ph
    sw = swing * c(a)  # forward at 0, back at 0.5
    up = max(0.0, s(a + math.pi)) if lift else 0  # folding during the swing (second half)
    return {
        f'upperF.{side}': rot(f'upperF.{side}', X, sw * 0.7 + up * lift * 0.3),
        f'foreF.{side}': rot(f'foreF.{side}', X, sw * 0.3 - up * lift * 0.2),
        f'cannonF.{side}': rot(f'cannonF.{side}', X, -up * lift),
        f'hoofF.{side}': rot(f'hoofF.{side}', X, -up * lift * 0.4),
    }


def leg_hind(side, ph, swing, lift):
    a = TAU * ph
    sw = swing * c(a)
    up = max(0.0, s(a + math.pi)) if lift else 0
    return {
        f'thigh.{side}': rot(f'thigh.{side}', X, sw * 0.8 + up * lift * 0.35),
        f'shin.{side}': rot(f'shin.{side}', X, -up * lift * 0.5),
        f'cannonH.{side}': rot(f'cannonH.{side}', X, up * lift * 0.45 + sw * 0.2),
        f'hoofH.{side}': rot(f'hoofH.{side}', X, -up * lift * 0.3),
    }


def merge(*ds):
    out = {}
    for d in ds:
        out.update(d)
    return out


def head_pose(neck1, neck2, head, yaw=0.0):
    return {
        'neck1': rot('neck1', X, neck1) @ rot('neck1', Z, yaw * 0.4),
        'neck2': rot('neck2', X, neck2) @ rot('neck2', Z, yaw * 0.3),
        'head': rot('head', X, head) @ rot('head', Z, yaw * 0.3),
    }


# --- Clips -----------------------------------------------------------------------------------------------------------
def idle(t):
    a = TAU * t
    breathe = s(a * 2) * 0.006
    flick = max(0.0, s(a * 3)) ** 8
    return merge(
        {'hips': (Quaternion(), Vector((0, 0, breathe)))},
        {'spine': rot('spine', X, s(a * 2) * 0.8)},
        head_pose(-4 + s(a) * 3, -2, 4 + s(a + 1) * 3, yaw=s(a) * 10),
        {'tail': rot('tail', X, 15 * flick) @ rot('tail', Z, 8 * s(a * 9) * flick)},
    )


def graze(t):
    a = TAU * t
    nibble = s(a * 6) * 2.5
    # Head drifts sideways as it crops, once a cycle.
    # The neck reaches down and forward and the head hangs nose-down, muzzle in the grass ~25 cm ahead of the
    # hooves. The shoulders dip; the front legs turn back against it and splay (one forward, one back), which
    # shortens them by as much, so the hooves stay planted.
    return merge(
        {'spine': rot('spine', X, -8)},
        head_pose(-90, -30, 42 + nibble, yaw=s(a) * 12),
        {'upperF.L': rot('upperF.L', X, 8 + 18), 'upperF.R': rot('upperF.R', X, 8 - 22)},
        {'tail': rot('tail', X, 6 + 10 * max(0.0, s(a * 2)) ** 6)},
    )


def alert(t):
    a = TAU * t
    turn = 28 * s(a) * (0.6 + 0.4 * s(a * 0.5 + 1))
    return merge(
        head_pose(12, 6, -6 + 3 * max(0.0, s(a * 2)) ** 4, yaw=turn),
        {'tail': rot('tail', X, 25)},
        {'spine': rot('spine', X, 1.5)},
    )


def walk(t):
    # Lateral sequence: left hind, left fore, right hind, right fore, a quarter cycle apart.
    bob = abs(s(TAU * t * 2)) * 0.015
    return merge(
        {'hips': (rot('hips', X, s(TAU * t * 2) * 1.2), Vector((0, 0, bob)))},
        leg_hind('L', t, 20, 32),
        leg_front('L', t - 0.25, 22, 55),
        leg_hind('R', t - 0.5, 20, 32),
        leg_front('R', t - 0.75, 22, 55),
        head_pose(-10 + s(TAU * t * 2) * 3, -4, 4, yaw=0),
        {'tail': rot('tail', X, 8)},
    )


def gallop(t):
    # Bounding gallop: hinds strike nearly together, fores half a cycle later; the spine coils and stretches.
    a = TAU * t
    flex = s(a)  # + extended, - gathered
    rise = max(0.0, s(a - 0.6)) * 0.12
    return merge(
        {'hips': (rot('hips', X, 8 * flex), Vector((0, 0, rise)))},
        {'spine': rot('spine', X, -10 * flex)},
        leg_hind('L', t, 42, 60),
        leg_hind('R', t - 0.06, 42, 60),
        leg_front('L', t - 0.5, 48, 85),
        leg_front('R', t - 0.56, 48, 85),
        head_pose(-14 + 8 * flex, -4, 6 - 6 * flex),
        {'tail': rot('tail', X, 45)},
    )


for name, seconds, fn in (
    ('Idle', 4.0, idle),
    ('Graze', 4.0, graze),
    ('Alert', 3.0, alert),
    ('Walk', 1.1, walk),
    ('Gallop', 0.5, gallop),
):
    key_clip(name, seconds, fn)

for pb in pose.bones:
    pb.rotation_quaternion = Quaternion()
    pb.location = Vector()
scene.frame_set(1)
print('rigged:', len(arm_data.bones), 'bones; clips:', [a.name for a in bpy.data.actions])

# --- Export ----------------------------------------------------------------------------------------------------------
# Optional: set SAVE_BLEND before exec() to keep a .blend of the rig (Blender has crashed mid-export before).
if globals().get('SAVE_BLEND'):
    bpy.ops.wm.save_as_mainfile(filepath=SAVE_BLEND, copy=True)
for t in rig.animation_data.nla_tracks:
    t.mute = False
for o in bpy.data.objects:
    o.hide_set(False)
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=False,
    export_skins=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_vertex_color='ACTIVE',
    export_force_sampling=True,
    export_optimize_animation_size=True,
    export_reset_pose_bones=True,
)
print('exported', OUT)
