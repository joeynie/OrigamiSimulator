(function(){

    function parseBoolean(value, fallback){
        if (value === null || value === undefined || value === "") return fallback;
        if (typeof value === "boolean") return value;
        value = ("" + value).toLowerCase();
        return !(value === "0" || value === "false" || value === "no");
    }

    function parseInteger(value, fallback){
        if (value === null || value === undefined || value === "") return fallback;
        var parsed = parseInt(value, 10);
        return isNaN(parsed) ? fallback : parsed;
    }

    function parseFloatSafe(value, fallback){
        if (value === null || value === undefined || value === "") return fallback;
        var parsed = parseFloat(value);
        return isNaN(parsed) ? fallback : parsed;
    }

    function getParams(){
        return new URLSearchParams(window.location.search);
    }

    function isBenchmarkMode(params){
        return parseBoolean(params.get("bench"), false) || !!params.get("fold") || !!params.get("svg");
    }

    function waitForOrigamiBench(timeoutMs){
        timeoutMs = timeoutMs || 15000;
        return new Promise(function(resolve, reject){
            var start = Date.now();
            function poll(){
                if (window.origamiBench) {
                    resolve(window.origamiBench);
                    return;
                }
                if (Date.now() - start > timeoutMs) {
                    reject(new Error("Timed out waiting for window.origamiBench"));
                    return;
                }
                window.setTimeout(poll, 100);
            }
            poll();
        });
    }

    function fetchJSON(url){
        return fetch(url, {cache: "no-store"}).then(function(response){
            if (!response.ok) throw new Error("Failed to fetch " + url + " (" + response.status + ")");
            return response.json();
        });
    }

    function deepClone(value){
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeActionsPayload(payload){
        if (Array.isArray(payload)) {
            return {actions: payload, options: {}};
        }
        if (payload && Array.isArray(payload.actions)) {
            return {
                actions: payload.actions,
                options: payload.options || {}
            };
        }
        throw new Error("Actions file must be an array or an object with an actions array");
    }

    function computeBBox(frames){
        var mins = [Infinity, Infinity, Infinity];
        var maxs = [-Infinity, -Infinity, -Infinity];
        for (var i=0;i<frames.length;i++){
            var vertices = frames[i].vertices || [];
            for (var j=0;j<vertices.length;j++){
                var vertex = vertices[j];
                var x = vertex[0];
                var y = vertex[1];
                var z = vertex.length > 2 ? vertex[2] : 0;
                if (x < mins[0]) mins[0] = x;
                if (y < mins[1]) mins[1] = y;
                if (z < mins[2]) mins[2] = z;
                if (x > maxs[0]) maxs[0] = x;
                if (y > maxs[1]) maxs[1] = y;
                if (z > maxs[2]) maxs[2] = z;
            }
        }
        if (!frames.length) {
            return {
                min: [0,0,0],
                max: [0,0,0],
                center: [0,0,0],
                span: [0,0,0]
            };
        }
        return {
            min: mins,
            max: maxs,
            center: [
                (mins[0] + maxs[0]) / 2,
                (mins[1] + maxs[1]) / 2,
                (mins[2] + maxs[2]) / 2
            ],
            span: [
                maxs[0] - mins[0],
                maxs[1] - mins[1],
                maxs[2] - mins[2]
            ]
        };
    }

    function makeDownload(filename, payload){
        var blob = new Blob([JSON.stringify(payload, null, 2)], {type: "application/json"});
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(function(){ URL.revokeObjectURL(url); }, 0);
    }

    function buildTrajectoryPayload(exportedFold, runResults, actions, meta){
        var frames = [];
        var frameIndex = 0;
        for (var actionIndex=0; actionIndex<runResults.length; actionIndex++){
            var result = runResults[actionIndex];
            var action = actions[actionIndex] || {};
            var resultFrames = result.frames || [];
            for (var localFrameIndex=0; localFrameIndex<resultFrames.length; localFrameIndex++){
                var frame = resultFrames[localFrameIndex];
                var vertices = frame.vertices_coords || frame.vertices || [];
                var currentAngle = null;
                var currentActuation = frame.actuation !== undefined ? frame.actuation : null;
                if (frame.crease_states && action.crease_id !== undefined && action.crease_id !== null) {
                    for (var k=0;k<frame.crease_states.length;k++){
                        var creaseState = frame.crease_states[k];
                        if (creaseState.crease_id == action.crease_id) {
                            currentActuation = creaseState.actuation;
                            currentAngle = (creaseState.target_angle_deg || 0) * (creaseState.actuation || 0);
                            break;
                        }
                    }
                }
                frames.push({
                    frame_index: frameIndex,
                    action_index: actionIndex,
                    local_frame_index: localFrameIndex,
                    crease_id: action.crease_id !== undefined ? action.crease_id : null,
                    target_angle_deg: action.target_angle_deg !== undefined ? action.target_angle_deg : null,
                    angle_deg: currentAngle,
                    actuation: currentActuation,
                    vertices: vertices
                });
                frameIndex += 1;
            }
        }
        return {
            format_version: 2,
            generator: "OrigamiSimulator",
            frame_title: exportedFold.frame_title || exportedFold.file_title || "origami_simulator_export",
            faces_vertices: exportedFold.faces_vertices,
            edges_vertices: exportedFold.edges_vertices,
            edges_assignment: exportedFold.edges_assignment,
            edges_crease_id: exportedFold.edges_crease_id || null,
            frames: frames,
            trajectory: frames.map(function(frame){
                return {
                    frame: frame.frame_index,
                    angle: frame.angle_deg !== null ? frame.angle_deg : frame.target_angle_deg,
                    vertices: frame.vertices
                };
            }),
            metadata: {
                action_count: actions.length,
                frame_count: frames.length,
                vertex_count: exportedFold.vertices_coords ? exportedFold.vertices_coords.length : 0,
                face_count: exportedFold.faces_vertices ? exportedFold.faces_vertices.length : 0,
                bbox: computeBBox(frames),
                source_fold_url: meta.foldUrl,
                source_actions_url: meta.actionsUrl,
                solver_steps_per_frame: meta.solverStepsPerFrame,
                settle_steps: meta.settleSteps
            }
        };
    }

    function setStatus(message, isError){
        var element = document.getElementById("benchmarkStatus");
        if (!element) {
            element = document.createElement("pre");
            element.id = "benchmarkStatus";
            element.style.position = "fixed";
            element.style.top = "8px";
            element.style.right = "8px";
            element.style.zIndex = "9999";
            element.style.maxWidth = "420px";
            element.style.maxHeight = "45vh";
            element.style.overflow = "auto";
            element.style.padding = "8px 10px";
            element.style.background = isError ? "rgba(120,20,20,0.9)" : "rgba(20,20,20,0.78)";
            element.style.color = "#fff";
            element.style.fontSize = "12px";
            element.style.lineHeight = "1.4";
            element.style.whiteSpace = "pre-wrap";
            document.body.appendChild(element);
        }
        element.style.background = isError ? "rgba(120,20,20,0.9)" : "rgba(20,20,20,0.78)";
        element.textContent = message;
    }

    function maybeHideUI(params){
        if (!parseBoolean(params.get("hide_ui"), true)) return;
        var ids = ["navVis", "helper", "aboutCorner"];
        for (var i=0;i<ids.length;i++){
            var node = document.getElementById(ids[i]);
            if (node) node.style.display = "none";
        }
    }

    function main(){
        var params = getParams();
        if (!isBenchmarkMode(params)) return;

        var foldUrl = params.get("fold");
        var svgUrl = params.get("svg");
        var actionsUrl = params.get("actions");
        var outputName = params.get("output_name") || "trajectory_simulator.json";
        var autoActions = actionsUrl === "auto" || parseBoolean(params.get("auto_actions"), false);
        var settleSteps = parseInteger(params.get("settle_steps"), 0);
        var flattenSteps = parseInteger(params.get("flatten_steps"), 400);
        var solverStepsPerFrame = parseInteger(params.get("solver_steps_per_frame"), null);
        var autoNumFrames = parseInteger(params.get("auto_num_frames"), null);
        var autoHoldFrames = parseInteger(params.get("auto_hold_frames"), null);
        var download = parseBoolean(params.get("download"), true);
        var exportFoldJson = parseBoolean(params.get("include_fold_json"), false);
        var capture = parseBoolean(params.get("capture"), true);
        var actuationOverride = parseFloatSafe(params.get("actuation"), null);

        if ((!foldUrl && !svgUrl) || (!actionsUrl && !autoActions)) {
            setStatus("Benchmark mode requires ?fold=... or ?svg=..., plus ?actions=... or ?actions=auto", true);
            return;
        }

        maybeHideUI(params);
        setStatus("Loading fold and actions...", false);

        waitForOrigamiBench()
            .then(function(origamiBench){
                var sourceRequest;
                if (svgUrl) {
                    sourceRequest = fetch(svgUrl, {cache: "no-store"}).then(function(response){
                        if (!response.ok) throw new Error("Failed to fetch " + svgUrl + " (" + response.status + ")");
                        return response.text();
                    }).then(function(svgText){
                        return {kind: "svg", payload: svgText};
                    });
                } else {
                    sourceRequest = fetchJSON(foldUrl).then(function(fold){
                        return {kind: "fold", payload: fold};
                    });
                }
                var actionsRequest = autoActions
                    ? Promise.resolve(null)
                    : fetchJSON(actionsUrl);
                return Promise.all([sourceRequest, actionsRequest]).then(function(results){
                    return {origamiBench: origamiBench, source: results[0], actionsPayload: results[1]};
                });
            })
            .then(function(context){
                var loader = context.source.kind === "svg"
                    ? context.origamiBench.loadSVG(context.source.payload, svgUrl.split("/").pop())
                    : Promise.resolve(context.origamiBench.loadFold(context.source.payload));
                return loader.then(function(){
                    var autoOpts = {};
                    if (autoNumFrames !== null) autoOpts.num_frames = autoNumFrames;
                    if (autoHoldFrames !== null) autoOpts.hold_frames = autoHoldFrames;
                    var normalized = autoActions
                        ? {actions: context.origamiBench.suggestActionGroups(autoOpts), options: {}}
                        : normalizeActionsPayload(context.actionsPayload);
                    var options = deepClone(normalized.options || {});
                    if (capture !== null) options.capture = capture;
                    if (exportFoldJson !== null) options.includeFoldJson = exportFoldJson;
                    if (solverStepsPerFrame !== null) options.solver_steps_per_frame = solverStepsPerFrame;
                    if (autoActions) {
                        window.origamiBenchSuggestedActions = normalized.actions;
                    }
                    // Always flatten to a physically settled flat state before the sequence starts.
                    // flattenSteps defaults to 400; pass ?flatten_steps=0 to skip.
                    context.origamiBench.settleFlat(flattenSteps);
                    if (actuationOverride !== null) {
                        context.origamiBench.setGlobalActuation(actuationOverride);
                    }
                    setStatus("Running sequence...", false);
                    var runResults = context.origamiBench.runSequence(normalized.actions, options);
                    var exportedFold = context.origamiBench.captureFoldJson();
                    var payload = buildTrajectoryPayload(exportedFold, runResults, normalized.actions, {
                        foldUrl: foldUrl || svgUrl,
                        actionsUrl: autoActions ? "auto" : actionsUrl,
                        solverStepsPerFrame: solverStepsPerFrame,
                        settleSteps: settleSteps
                    });
                    window.origamiBenchLastTrajectory = payload;
                    setStatus("Generated " + payload.metadata.frame_count + " frames.\n" + outputName + (autoActions ? "\n(actions=auto draft was stored in window.origamiBenchSuggestedActions)" : ""), false);
                    if (download) makeDownload(outputName, payload);
                    return payload;
                });
            })
            .catch(function(error){
                console.error(error);
                setStatus(error.message || String(error), true);
            });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", main);
    } else {
        main();
    }
})();
