/**
 * Minimal sequential crease controller for scripted dataset generation.
 */

function initFoldSequence(globals){

    function clamp(val, min, max){
        return Math.max(min, Math.min(max, val));
    }

    function dedupeCreases(creases){
        var deduped = [];
        var seen = {};
        for (var i=0;i<creases.length;i++){
            var crease = creases[i];
            if (!crease) continue;
            var index = crease.getIndex();
            if (seen[index]) continue;
            seen[index] = true;
            deduped.push(crease);
        }
        return deduped;
    }

    function applyProfile(profile, t){
        if (profile == "ease_in") return t*t;
        if (profile == "ease_out") return 1 - Math.pow(1-t, 2);
        if (profile == "ease_in_out") {
            if (t < 0.5) return 2*t*t;
            return 1 - Math.pow(-2*t + 2, 2)/2;
        }
        return t;
    }

    function resolveCrease(action){
        var all = resolveCreases(action);
        return all.length ? all[0] : null;
    }

    // Returns ALL crease segments matching the action spec.
    // A single logical crease_id may map to multiple physical segments
    // after triangulation/edge-splitting, so we collect all of them.
    function resolveCreasesForSingleSpec(action){
        var creases = globals.model.getCreases();
        var results = [];
        if (action.crease_id !== undefined && action.crease_id !== null) {
            for (var i=0;i<creases.length;i++){
                if (creases[i].getCreaseId && creases[i].getCreaseId() == action.crease_id) results.push(creases[i]);
            }
            if (results.length) return results;
        }
        if (action.crease_index !== undefined && action.crease_index !== null) {
            var c = creases[action.crease_index];
            if (c) results.push(c);
            return results;
        }
        if (action.edge_index !== undefined && action.edge_index !== null) {
            for (var j=0;j<creases.length;j++){
                if (creases[j].getSourceEdgeIndex && creases[j].getSourceEdgeIndex() == action.edge_index) results.push(creases[j]);
            }
            return results;
        }
        return results;
    }

    function resolveCreases(action){
        var results = [];
        if (Array.isArray(action.crease_ids)) {
            for (var i=0;i<action.crease_ids.length;i++){
                results = results.concat(resolveCreasesForSingleSpec({crease_id: action.crease_ids[i]}));
            }
        }
        if (Array.isArray(action.crease_indices)) {
            for (var j=0;j<action.crease_indices.length;j++){
                results = results.concat(resolveCreasesForSingleSpec({crease_index: action.crease_indices[j]}));
            }
        }
        if (Array.isArray(action.edge_indices)) {
            for (var k=0;k<action.edge_indices.length;k++){
                results = results.concat(resolveCreasesForSingleSpec({edge_index: action.edge_indices[k]}));
            }
        }
        if (results.length) return dedupeCreases(results);
        return dedupeCreases(resolveCreasesForSingleSpec(action));
    }

    function getEndActuation(crease, action){
        if (action.end_actuation !== undefined && action.end_actuation !== null) {
            return clamp(action.end_actuation, -1, 1);
        }
        if (action.target_angle_deg !== undefined && action.target_angle_deg !== null) {
            var baseAngle = Math.abs(crease.getTargetTheta() * 180 / Math.PI);
            if (baseAngle < 1e-8) return 0;
            return clamp(action.target_angle_deg / baseAngle, -1, 1);
        }
        if (action.target_angle_rad !== undefined && action.target_angle_rad !== null) {
            var baseAngleRad = Math.abs(crease.getTargetTheta());
            if (baseAngleRad < 1e-8) return 0;
            return clamp(action.target_angle_rad / baseAngleRad, -1, 1);
        }
        return 1;
    }

    function captureState(options){
        options = options || {};
        var positions = globals.model.getPositionsArray();
        var creases = globals.model.getCreases();
        var vertices = [];
        var creaseStates = [];
        for (var i=0;i<positions.length;i+=3){
            vertices.push([positions[i], positions[i+1], positions[i+2]]);
        }
        for (var j=0;j<creases.length;j++){
            var crease = creases[j];
            creaseStates.push({
                crease_index: crease.getIndex(),
                crease_id: crease.getCreaseId ? crease.getCreaseId() : null,
                edge_index: crease.getSourceEdgeIndex ? crease.getSourceEdgeIndex() : null,
                actuation: crease.getActuation ? crease.getActuation() : null,
                target_angle_deg: crease.getTargetTheta() * 180 / Math.PI
            });
        }
        var state = {
            vertices_coords: vertices,
            crease_states: creaseStates
        };
        if (options.includeFoldJson && typeof buildCurrentFoldJSON === "function") {
            state.fold = buildCurrentFoldJSON();
        }
        return state;
    }

    function runAction(action, options){
        options = options || {};
        if (!action) throw new Error("runAction requires an action object");
        var matchedCreases = resolveCreases(action);
        if (!matchedCreases.length) {
            throw new Error("Unable to resolve crease for action: " + JSON.stringify(action));
        }
        // Use the first segment as the reference for angle/actuation computation.
        var crease = matchedCreases[0];

        var solver = globals.dynamicSolver;
        var startActuation = action.start_actuation;
        if (startActuation === undefined || startActuation === null) {
            startActuation = solver.getCreaseActuation(crease.getIndex());
        }
        var endActuation = getEndActuation(crease, action);
        var numFrames = Math.max(1, parseInt(action.num_frames || action.duration || 32, 10));
        var holdFrames = Math.max(0, parseInt(action.hold_frames || 0, 10));
        var solverStepsPerFrame = Math.max(1, parseInt(action.solver_steps_per_frame || options.solver_steps_per_frame || globals.numSteps, 10));
        var shouldCapture = !!(options.capture || action.capture);
        var includeFoldJson = !!(options.includeFoldJson || action.include_fold_json);
        var profile = action.schedule || action.profile || "linear";
        var frames = [];
        var wasRunning = globals.simulationRunning;

        globals.simulationRunning = false;
        try {
            for (var i=0;i<numFrames;i++){
                var t = numFrames === 1 ? 1 : i/(numFrames-1);
                var alpha = applyProfile(profile, t);
                var actuation = startActuation*(1-alpha) + endActuation*alpha;
                // Drive ALL segments of this logical crease simultaneously.
                for (var s=0;s<matchedCreases.length;s++){
                    solver.setCreaseActuation(matchedCreases[s].getIndex(), actuation);
                }
                globals.model.step(solverStepsPerFrame);
                if (shouldCapture) frames.push(captureState({includeFoldJson: includeFoldJson}));
            }
            for (var j=0;j<holdFrames;j++){
                globals.model.step(solverStepsPerFrame);
                if (shouldCapture) frames.push(captureState({includeFoldJson: includeFoldJson}));
            }
        } finally {
            globals.simulationRunning = wasRunning;
        }

        return {
            crease_index: crease.getIndex(),
            crease_id: crease.getCreaseId ? crease.getCreaseId() : null,
            edge_index: crease.getSourceEdgeIndex ? crease.getSourceEdgeIndex() : null,
            crease_ids: matchedCreases.map(function(item){
                return item.getCreaseId ? item.getCreaseId() : null;
            }).filter(function(item){ return item !== null && item !== undefined; }),
            edge_indices: matchedCreases.map(function(item){
                return item.getSourceEdgeIndex ? item.getSourceEdgeIndex() : null;
            }).filter(function(item){ return item !== null && item !== undefined; }),
            matched_segments: matchedCreases.length,
            start_actuation: startActuation,
            end_actuation: endActuation,
            num_frames: numFrames,
            hold_frames: holdFrames,
            frames: frames
        };
    }

    function runSequence(actions, options){
        if (!actions || !actions.length) return [];
        options = options || {};
        var results = [];
        for (var i=0;i<actions.length;i++){
            results.push(runAction(actions[i], options));
        }
        return results;
    }

    // Reset all creases to actuation=0 then run solver steps to physically settle the paper flat.
    // Call this before starting a sequence to ensure the first captured frame is truly flat.
    function settleFlat(solverSteps){
        var solver = globals.dynamicSolver;
        var creases = globals.model.getCreases();
        for (var i=0;i<creases.length;i++){
            solver.setCreaseActuation(creases[i].getIndex(), 0);
        }
        globals.creasePercent = 0;
        var wasRunning = globals.simulationRunning;
        globals.simulationRunning = false;
        try {
            globals.model.step(solverSteps || 400);
        } finally {
            globals.simulationRunning = wasRunning;
        }
    }

    return {
        captureState: captureState,
        runAction: runAction,
        runSequence: runSequence,
        settleFlat: settleFlat
    };
}
