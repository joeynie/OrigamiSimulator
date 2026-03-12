import ear from "rabbit-ear";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { makeVerticesCoords3DFolded } from "rabbit-ear/graph/vertices/folded.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outputDir = join(__dirname, "..", "generated");

const CREASE_ASSIGNMENTS = new Set(["M", "m", "V", "v", "F", "f", "U", "u"]);

function easeInOut(progress) {
  return 0.5 - 0.5 * Math.cos(Math.PI * progress);
}

function toXYZ(vertex) {
  return [vertex[0], vertex[1], vertex[2] ?? 0];
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assignCreaseIds(fold) {
  let creaseCounter = 0;
  fold.edges_crease_id = fold.edges_assignment.map((assignment) => (
    CREASE_ASSIGNMENTS.has(assignment) ? `c${creaseCounter++}` : null
  ));
}

function createSingleFoldPattern() {
  const cp = ear.graph.square();
  const foldLine = { vector: [0, 1], origin: [0.5, 0.5] };
  const changes = ear.graph.foldLine(cp, foldLine, "V");
  const creaseEdgeIndex = changes.edges.new[0];

  cp.file_title = "simple_single_fold";
  cp.frame_title = "simple_single_fold";
  cp.file_creator = "origami/data/index.js";
  cp.file_author = "Codex";
  cp.file_classes = ["singleModel"];

  cp.edges_foldAngle = cp.edges_assignment.map(() => 0);
  cp.edges_foldAngle[creaseEdgeIndex] = 180;
  assignCreaseIds(cp);

  return { cp, creaseEdgeIndex };
}

function buildActions(fold, creaseEdgeIndex) {
  return [
    {
      action_type: "fold",
      crease_id: fold.edges_crease_id[creaseEdgeIndex],
      target_angle_deg: 180,
      num_frames: 32,
      schedule: "ease_in_out",
      hold_frames: 4,
      solver_steps_per_frame: 80,
      capture: true,
      include_fold_json: false,
    },
  ];
}

function buildRabbitEarTrajectory(fold, creaseEdgeIndex, action) {
  const frames = [];
  for (let frame = 0; frame < action.num_frames; frame += 1) {
    const progress = action.num_frames === 1 ? 1 : frame / (action.num_frames - 1);
    const eased = action.schedule === "ease_in_out" ? easeInOut(progress) : progress;
    const currentAngle = action.target_angle_deg * eased;

    const frameFold = deepClone(fold);
    frameFold.edges_foldAngle = frameFold.edges_foldAngle.map(() => 0);
    frameFold.edges_foldAngle[creaseEdgeIndex] = currentAngle;

    const vertices = makeVerticesCoords3DFolded(frameFold).map(toXYZ);
    frames.push({
      frame_index: frame,
      angle_deg: Number(currentAngle.toFixed(4)),
      vertices,
    });
  }

  return {
    format_version: 2,
    generator: "Rabbit Ear",
    frame_title: fold.frame_title,
    faces_vertices: fold.faces_vertices,
    edges_vertices: fold.edges_vertices,
    edges_assignment: fold.edges_assignment,
    edges_crease_id: fold.edges_crease_id,
    frames,
    trajectory: frames.map((frame) => ({
      frame: frame.frame_index,
      angle: frame.angle_deg.toFixed(2),
      vertices: frame.vertices,
    })),
  };
}

function main() {
  mkdirSync(outputDir, { recursive: true });

  const { cp, creaseEdgeIndex } = createSingleFoldPattern();
  const actions = buildActions(cp, creaseEdgeIndex);
  const rabbitEarTrajectory = buildRabbitEarTrajectory(cp, creaseEdgeIndex, actions[0]);

  writeFileSync(join(outputDir, "simple_single_fold.fold"), JSON.stringify(cp, null, 2));
  writeFileSync(join(outputDir, "actions.json"), JSON.stringify(actions, null, 2));
  writeFileSync(join(outputDir, "trajectory_rabbitear.json"), JSON.stringify(rabbitEarTrajectory, null, 2));
  writeFileSync(join(__dirname, "trajectory.json"), JSON.stringify(rabbitEarTrajectory, null, 2));
  writeFileSync(
    join(outputDir, "simulator_job.json"),
    JSON.stringify(
      {
        fold: "../data/generated/simple_single_fold.fold",
        actions: "../data/generated/actions.json",
        output_name: "trajectory_simulator.json",
      },
      null,
      2,
    ),
  );

  console.log("Generated:");
  console.log("  data/generated/simple_single_fold.fold");
  console.log("  data/generated/actions.json");
  console.log("  data/generated/trajectory_rabbitear.json");
  console.log("  data/trajectory.json");
  console.log("  data/generated/simulator_job.json");
}

main();
