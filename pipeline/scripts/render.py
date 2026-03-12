import bpy
import json
import os
import shutil
import subprocess
import sys


def parse_args():
    argv = sys.argv
    if "--" not in argv:
        return {
            "trajectory_path": os.path.abspath("trajectory.json"),
            "output_dir": os.path.abspath("./render_output"),
            "no_video": False,
        }
    user_args = argv[argv.index("--") + 1 :]
    trajectory_path = os.path.abspath(user_args[0]) if len(user_args) >= 1 else os.path.abspath("trajectory.json")
    output_dir = os.path.abspath(user_args[1]) if len(user_args) >= 2 else os.path.abspath("./render_output")
    no_video = "--no-video" in user_args

    shutil.rmtree(output_dir) if os.path.exists(output_dir) else None

    return {
        "trajectory_path": trajectory_path,
        "output_dir": output_dir,
        "no_video": no_video,
    }


def load_trajectory(path):
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)

    faces = data["faces_vertices"]
    frames = data.get("frames") or data.get("trajectory")
    if not frames:
        raise ValueError("Trajectory file does not contain frames or trajectory data")

    normalized_frames = []
    for index, frame in enumerate(frames):
        vertices = frame.get("vertices") or frame.get("vertices_coords")
        if not vertices:
            raise ValueError(f"Frame {index} does not contain vertices")
        normalized_frames.append(
            {
                "frame_index": frame.get("frame_index", frame.get("frame", index)),
                "vertices": [to_xyz(vertex) for vertex in vertices],
            }
        )

    return faces, normalized_frames


def to_xyz(vertex):
    return (vertex[0], vertex[1], vertex[2] if len(vertex) > 2 else 0.0)


def compute_bounds(frames):
    mins = [float("inf"), float("inf"), float("inf")]
    maxs = [float("-inf"), float("-inf"), float("-inf")]

    for frame in frames:
        for vertex in frame["vertices"]:
            for axis in range(3):
                mins[axis] = min(mins[axis], vertex[axis])
                maxs[axis] = max(maxs[axis], vertex[axis])

    center = tuple((mins[axis] + maxs[axis]) * 0.5 for axis in range(3))
    span = tuple(maxs[axis] - mins[axis] for axis in range(3))
    radius = max(max(span), 1e-3)
    return center, span, radius


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def create_paper_mesh(initial_vertices, faces):
    mesh = bpy.data.meshes.new("PaperMesh")
    mesh.from_pydata(initial_vertices, [], faces)
    mesh.update()

    paper_obj = bpy.data.objects.new("OrigamiPaper", mesh)
    bpy.context.collection.objects.link(paper_obj)
    return paper_obj, mesh


def create_material(obj):
    material = bpy.data.materials.new(name="PaperMaterial")
    material.use_nodes = True
    bsdf = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.82, 0.76, 0.63, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.88
    obj.data.materials.append(material)


def create_tracking_target(center):
    target = bpy.data.objects.new("CameraTarget", None)
    target.location = center
    bpy.context.collection.objects.link(target)
    return target


def setup_camera_and_light(center, radius, target):
    scene = bpy.context.scene

    cam_data = bpy.data.cameras.new("MainCamera")
    cam_obj = bpy.data.objects.new("MainCamera", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    scene.camera = cam_obj
    cam_obj.location = (
        center[0],
        center[1] - 2 * radius,
        center[2] + 1.9 * radius,
    )

    track = cam_obj.constraints.new(type="TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"

    light_data = bpy.data.lights.new(name="MainLight", type="AREA")
    light_data.energy = 120
    light_data.size = 2.5 * radius
    light_obj = bpy.data.objects.new("MainLight", light_data)
    bpy.context.collection.objects.link(light_obj)
    light_obj.location = (
        center[0] + 0.4 * radius,
        center[1] - 0.2 * radius,
        center[2] + 2.5 * radius,
    )

    light_track = light_obj.constraints.new(type="TRACK_TO")
    light_track.target = target
    light_track.track_axis = "TRACK_NEGATIVE_Z"
    light_track.up_axis = "UP_Y"


def setup_render(output_dir):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 8
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512

    rgb_dir = os.path.join(output_dir, "rgb")
    depth_dir = os.path.join(output_dir, "depth")
    os.makedirs(rgb_dir, exist_ok=True)
    os.makedirs(depth_dir, exist_ok=True)

    scene.use_nodes = True
    tree = scene.node_tree
    for node in list(tree.nodes):
        tree.nodes.remove(node)

    bpy.context.view_layer.use_pass_z = True

    render_layers = tree.nodes.new("CompositorNodeRLayers")
    depth_out = tree.nodes.new("CompositorNodeOutputFile")
    depth_out.base_path = depth_dir
    depth_out.format.file_format = "OPEN_EXR"
    depth_out.file_slots[0].path = "frame_"

    depth_socket = next((out for out in render_layers.outputs if out.name in ["Depth", "Z"]), None)
    if depth_socket is None and len(render_layers.outputs) >= 3:
        depth_socket = render_layers.outputs[2]
    if depth_socket is None:
        raise RuntimeError("Unable to locate the depth output socket in the compositor")

    tree.links.new(depth_socket, depth_out.inputs[0])
    return rgb_dir


def update_mesh(mesh, vertices):
    for index, vertex in enumerate(vertices):
        mesh.vertices[index].co = vertex
    mesh.update(calc_edges=True)
    bpy.context.view_layer.update()


def main():
    args = parse_args()
    faces, frames = load_trajectory(args["trajectory_path"])
    center, _, radius = compute_bounds(frames)

    clear_scene()

    paper_obj, mesh = create_paper_mesh(frames[0]["vertices"], faces)
    create_material(paper_obj)

    target = create_tracking_target(center)
    setup_camera_and_light(center, radius, target)
    rgb_dir = setup_render(args["output_dir"])

    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = len(frames)

    print(f"Loaded {len(frames)} frames from {args['trajectory_path']}")

    for frame_number, frame in enumerate(frames, start=1):
        scene.frame_set(frame_number)
        update_mesh(mesh, frame["vertices"])
        scene.render.filepath = os.path.join(rgb_dir, f"frame_{frame_number:04d}.png")
        print(f"Rendering frame {frame_number}/{len(frames)}")
        bpy.ops.render.render(write_still=True)

    print(f"Finished rendering to {args['output_dir']}")

    if not args["no_video"]:
        _build_video(args["output_dir"])


def _build_video(output_dir):
    """Spawn a subprocess using the system Python to run reconstruct.py.
    Blender's bundled Python lacks cv2/imageio, so we must use an external interpreter."""
    python = shutil.which("python") or shutil.which("python3")
    if python is None:
        print("[render] Warning: could not find Python on PATH, skipping video generation.")
        print("[render] Run manually: python pipeline/scripts/reconstruct.py", output_dir)
        return
    script = os.path.join(os.path.dirname(__file__), "reconstruct.py")
    print(f"[render] Generating RGB-D video with {python} ...")
    result = subprocess.run([python, script, output_dir], check=False)
    if result.returncode != 0:
        print(f"[render] Warning: reconstruct.py exited with code {result.returncode}. "
              "Run manually: python pipeline/scripts/reconstruct.py", output_dir)


main()
