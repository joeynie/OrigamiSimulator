import { deepClone, easeInOut, toXYZ } from "../lib/utils.js";
import { makeVerticesCoords3DFolded } from "rabbit-ear/graph/vertices/folded.js";

function buildCreaseEdgeLookup(fold) {
  const lookup = {};
  for (let i = 0; i < fold.edges_crease_id.length; i += 1) {
    const creaseId = fold.edges_crease_id[i];
    if (!creaseId) continue;
    if (!lookup[creaseId]) lookup[creaseId] = [];
    lookup[creaseId].push(i);
  }
  return lookup;
}

export function buildSanityTrajectory(finalFold, actions) {
  const creaseLookup = buildCreaseEdgeLookup(finalFold);
  const actuation = {};
  const frames = [];
  let frameIndex = 0;

  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const action = actions[actionIndex];
    const creaseIds = action.crease_ids ?? [];
    const numFrames = action.num_frames ?? 1;

    for (let localFrame = 0; localFrame < numFrames; localFrame += 1) {
      const progress = numFrames === 1 ? 1 : localFrame / (numFrames - 1);
      const alpha = action.schedule === "ease_in_out" ? easeInOut(progress) : progress;
      for (const creaseId of creaseIds) {
        actuation[creaseId] = alpha * (action.end_actuation ?? 1);
      }

      const frameFold = deepClone(finalFold);
      frameFold.edges_foldAngle = frameFold.edges_foldAngle.map((angle, edgeIndex) => {
        const creaseId = frameFold.edges_crease_id?.[edgeIndex];
        const factor = creaseId ? (actuation[creaseId] ?? 0) : 0;
        return (angle ?? 0) * factor;
      });
      let vertices;
      try {
        vertices = makeVerticesCoords3DFolded(frameFold).map(toXYZ);
      } catch (error) {
        vertices = frameFold.vertices_coords.map(toXYZ);
      }

      frames.push({
        frame_index: frameIndex,
        action_index: actionIndex,
        vertices,
      });
      frameIndex += 1;
    }

    for (const creaseId of creaseIds) {
      actuation[creaseId] = action.end_actuation ?? 1;
    }
  }

  return {
    format_version: 2,
    generator: "Rabbit Ear",
    frame_title: finalFold.frame_title,
    faces_vertices: finalFold.faces_vertices,
    edges_vertices: finalFold.edges_vertices,
    edges_assignment: finalFold.edges_assignment,
    edges_crease_id: finalFold.edges_crease_id,
    frames,
    trajectory: frames.map((frame) => ({
      frame: frame.frame_index,
      vertices: frame.vertices,
    })),
  };
}
