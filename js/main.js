/**
 * Created by ghassaei on 2/22/17.
 */

globals = {};

function setCookie(c_name,value,exdays){var exdate=new Date();exdate.setDate(exdate.getDate() + exdays);var c_value=escape(value) + ((exdays==null) ? "" : "; expires="+exdate.toUTCString());document.cookie=c_name + "=" + c_value;}
function getCookie(c_name){var c_value = document.cookie;var c_start = c_value.indexOf(" " + c_name + "=");if (c_start == -1){c_start = c_value.indexOf(c_name + "=");}if (c_start == -1){c_value = null;}else{c_start = c_value.indexOf("=", c_start) + 1;var c_end = c_value.indexOf(";", c_start);if (c_end == -1){c_end = c_value.length;}c_value = unescape(c_value.substring(c_start,c_end));}return c_value;}
function delCookie(name){document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:01 GMT;';}

$(function() {

    if (!getCookie('firsttime')){
        //Runs the code because the cookie doesn't exist and it's the user's first time
        // var maxHeight = 54;
        // var minHeight = 64;
        //
        // function bounce($helper, num, dur){
        //         $helper.css({top:minHeight+'px'});
        //         window.setTimeout(function() {
        //             $helper.css({"transition-timing-function": "easeOutBounce", top: maxHeight + 'px'});
        //             window.setTimeout(function(){
        //                 if (--num == 0) return;
        //                 bounce($helper, num, dur);
        //             }, dur);
        //         }, dur);
        // }

        if ($("body").innerWidth() > 770) {

            window.setTimeout(function(){

                setCookie('firsttime',true);

                var $helper = $("#helper");
                $helper.show();
                window.setTimeout(function() {
                    $helper.css({opacity: 1});
                    window.setTimeout(function () {
                        $helper.css({opacity: 0});
                        window.setTimeout(function () {
                            $helper.hide();
                        }, 2000);
                    }, 10000);
                    // bounce($helper, 3, 500);
                }, 500);
            }, 7000);
        }

    }

    globals = initGlobals();
    globals.threeView = initThreeView(globals);
    globals.controls = initControls(globals);
    globals.UI3D = init3DUI(globals);
    globals.importer = initImporter(globals);
    globals.model = initModel(globals);
    // globals.staticSolver = initStaticSolver(globals);//still in development
    globals.dynamicSolver = initDynamicSolver(globals);
    // globals.rigidSolver = initRigidSolver(globals);//still in development
    globals.pattern = initPattern(globals);
    globals.vive = initViveInterface(globals);
    globals.videoAnimator = initVideoAnimator(globals);
    globals.foldSequence = initFoldSequence(globals);

    globals.curvedFolding = initCurvedFolding(globals);//for curved folding

    function syncPendingModelUpdates(){
        if (globals.needsSync) globals.model.sync();
        if (globals.simNeedsSync) globals.model.syncSolver();
    }

    function normalizeFoldInput(fold){
        if (typeof fold === "string") return JSON.parse(fold);
        return JSON.parse(JSON.stringify(fold));
    }

    function getPlanarBounds(){
        var nodes = globals.model.getNodes();
        var minX = Infinity;
        var maxX = -Infinity;
        var minZ = Infinity;
        var maxZ = -Infinity;
        for (var i=0;i<nodes.length;i++){
            var position = nodes[i].getOriginalPosition();
            if (position.x < minX) minX = position.x;
            if (position.x > maxX) maxX = position.x;
            if (position.z < minZ) minZ = position.z;
            if (position.z > maxZ) maxZ = position.z;
        }
        if (!nodes.length) {
            return {
                minX: 0,
                maxX: 1,
                minZ: 0,
                maxZ: 1,
                spanX: 1,
                spanZ: 1,
                centerX: 0.5,
                centerZ: 0.5
            };
        }
        return {
            minX: minX,
            maxX: maxX,
            minZ: minZ,
            maxZ: maxZ,
            spanX: Math.max(maxX - minX, 1e-9),
            spanZ: Math.max(maxZ - minZ, 1e-9),
            centerX: (minX + maxX)/2,
            centerZ: (minZ + maxZ)/2
        };
    }

    function normalizePoint2D(point, bounds){
        return [
            (point[0] - bounds.minX) / bounds.spanX,
            (point[1] - bounds.minZ) / bounds.spanZ
        ];
    }

    function roundTo(value, digits){
        var scale = Math.pow(10, digits);
        return Math.round(value * scale) / scale;
    }

    function classifyOrientation(dx, dz){
        var angle = Math.atan2(dz, dx) * 180 / Math.PI;
        if (angle < 0) angle += 180;
        if (Math.abs(angle - 0) < 12 || Math.abs(angle - 180) < 12) return "horizontal";
        if (Math.abs(angle - 90) < 12) return "vertical";
        if (Math.abs(angle - 45) < 12) return "diag_pos";
        if (Math.abs(angle - 135) < 12) return "diag_neg";
        return "angle_" + Math.round(angle / 15) * 15;
    }

    function downloadJSON(filename, data){
        var blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(function(){ URL.revokeObjectURL(url); }, 0);
    }

    function getCreaseSummaries(){
        var creases = globals.model.getCreases();
        var summaries = [];
        var bounds = getPlanarBounds();
        for (var i=0;i<creases.length;i++){
            var crease = creases[i];
            var targetAngleDeg = crease.getTargetTheta() * 180 / Math.PI;
            if (Math.abs(targetAngleDeg) < 1e-8) continue;
            var nodeA = crease.edge.nodes[0].getOriginalPosition();
            var nodeB = crease.edge.nodes[1].getOriginalPosition();
            var start = [nodeA.x, nodeA.z];
            var end = [nodeB.x, nodeB.z];
            var midpoint = [(start[0] + end[0])/2, (start[1] + end[1])/2];
            var dx = end[0] - start[0];
            var dz = end[1] - start[1];
            summaries.push({
                crease_index: crease.getIndex(),
                crease_id: crease.getCreaseId ? crease.getCreaseId() : null,
                edge_index: crease.getSourceEdgeIndex ? crease.getSourceEdgeIndex() : null,
                target_angle_deg: targetAngleDeg,
                actuation: crease.getActuation ? crease.getActuation() : null,
                length: crease.getLength ? crease.getLength() : null,
                orientation: classifyOrientation(dx, dz),
                segment_2d: [start, end],
                segment_normalized: [
                    normalizePoint2D(start, bounds),
                    normalizePoint2D(end, bounds)
                ],
                midpoint_2d: midpoint,
                midpoint_normalized: normalizePoint2D(midpoint, bounds)
            });
        }
        return summaries;
    }

    function buildSuggestedActions(options){
        options = options || {};
        var creases = getCreaseSummaries();
        var groups = {};
        for (var i=0;i<creases.length;i++){
            var crease = creases[i];
            var midpoint = crease.midpoint_normalized;
            var centerDistance = Math.sqrt(
                Math.pow(midpoint[0] - 0.5, 2) +
                Math.pow(midpoint[1] - 0.5, 2)
            );
            var key = [
                crease.target_angle_deg > 0 ? "V" : (crease.target_angle_deg < 0 ? "M" : "F"),
                crease.orientation,
                "len:" + roundTo(crease.length || 0, 2),
                "dist:" + roundTo(centerDistance, 2)
            ].join("|");
            if (!groups[key]) {
                groups[key] = {
                    key: key,
                    crease_ids: [],
                    edge_indices: [],
                    crease_indices: [],
                    target_angle_deg: null,
                    lengths: [],
                    sample_midpoint: crease.midpoint_normalized
                };
            }
            groups[key].crease_indices.push(crease.crease_index);
            groups[key].edge_indices.push(crease.edge_index);
            if (crease.crease_id !== null && crease.crease_id !== undefined) groups[key].crease_ids.push(crease.crease_id);
            groups[key].target_angle_deg = crease.target_angle_deg;
            groups[key].lengths.push(crease.length || 0);
        }

        var actions = Object.keys(groups).map(function(key){
            var group = groups[key];
            return {
                step_id: "auto_" + key.replace(/[^a-zA-Z0-9]+/g, "_"),
                type: "group_fold",
                crease_ids: group.crease_ids.length ? group.crease_ids : undefined,
                edge_indices: group.crease_ids.length ? undefined : group.edge_indices,
                end_actuation: 1,
                num_frames: options.num_frames !== null && options.num_frames !== undefined ? options.num_frames : 8,
                hold_frames: options.hold_frames !== null && options.hold_frames !== undefined ? options.hold_frames : 16,
                schedule: options.schedule || "ease_in_out",
                meta: {
                    group_key: group.key,
                    sample_midpoint: group.sample_midpoint,
                    average_length: group.lengths.reduce(function(sum, value){ return sum + value; }, 0) / Math.max(group.lengths.length, 1)
                }
            };
        });

        actions.sort(function(a, b){
            return (b.meta.average_length || 0) - (a.meta.average_length || 0);
        });

        return actions;
    }

    function resolveCreaseIndex(spec){
        var creases = globals.model.getCreases();
        if (typeof spec === "number") return spec;
        if (spec && spec.crease_index !== undefined && spec.crease_index !== null) return spec.crease_index;
        if (spec && spec.crease_id !== undefined && spec.crease_id !== null) {
            for (var i=0;i<creases.length;i++){
                if (creases[i].getCreaseId && creases[i].getCreaseId() == spec.crease_id) return creases[i].getIndex();
            }
        }
        if (spec && spec.edge_index !== undefined && spec.edge_index !== null) {
            for (var j=0;j<creases.length;j++){
                if (creases[j].getSourceEdgeIndex && creases[j].getSourceEdgeIndex() == spec.edge_index) return creases[j].getIndex();
            }
        }
        return null;
    }

    window.origamiBench = {
        loadFold: function(fold){
            var data = normalizeFoldInput(fold);
            globals.filename = data.frame_title || data.file_title || "origamiBench";
            globals.extension = "fold";
            globals.url = null;
            globals.pattern.setFoldData(data);
            syncPendingModelUpdates();
            var creases = getCreaseSummaries();
            return {
                filename: globals.filename,
                num_creases: creases.length,
                creases: creases
            };
        },
        loadSVG: function(svgText, filename){
            return new Promise(function(resolve, reject){
                var blob = new Blob([svgText], {type: 'image/svg+xml'});
                var url = URL.createObjectURL(blob);
                globals.filename = filename || "origamiBench";
                globals.extension = "svg";
                globals.url = null;
                globals.pattern.loadSVG(url, false, function(){
                    syncPendingModelUpdates();
                    URL.revokeObjectURL(url);
                    var creases = getCreaseSummaries();
                    resolve({
                        filename: globals.filename,
                        num_creases: creases.length,
                        creases: creases
                    });
                }, function(error){
                    URL.revokeObjectURL(url);
                    reject(error);
                });
            });
        },
        sync: syncPendingModelUpdates,
        getCreases: getCreaseSummaries,
        suggestActionGroups: buildSuggestedActions,
        downloadJSON: downloadJSON,
        setGlobalActuation: function(actuation){
            globals.creasePercent = actuation;
            globals.dynamicSolver.setAllCreaseActuation(actuation);
            globals.controls.updateCreasePercent();
            return globals.dynamicSolver.getCreaseActuations();
        },
        settleFlat: function(solverSteps){
            return globals.foldSequence.settleFlat(solverSteps);
        },
        setCreaseActuation: function(spec, actuation){
            var creaseIndex = resolveCreaseIndex(spec);
            if (creaseIndex === null || creaseIndex === undefined) {
                throw new Error("Unable to resolve crease for setCreaseActuation");
            }
            globals.dynamicSolver.setCreaseActuation(creaseIndex, actuation);
            return getCreaseSummaries();
        },
        getCreaseActuations: function(){
            return globals.dynamicSolver.getCreaseActuations();
        },
        runAction: function(action, options){
            syncPendingModelUpdates();
            return globals.foldSequence.runAction(action, options);
        },
        runSequence: function(actions, options){
            syncPendingModelUpdates();
            return globals.foldSequence.runSequence(actions, options);
        },
        captureState: function(options){
            return globals.foldSequence.captureState(options);
        },
        captureFoldJson: function(){
            return buildCurrentFoldJSON();
        }
    };

    // Load demo model unless benchmark mode is driving the page with an explicit fold file.
    var benchmarkFoldMatch = /[\\?&]fold=([^&#]*)/.exec(location.search);
    if (!benchmarkFoldMatch) {
        var model = 'Tessellations/huffmanWaterbomb.svg';
        var match = /[\\?&]model=([^&#]*)/.exec(location.search);
        if (match) {
            model = match[1];
        }
        model = model.replace(/'/g, ''); // avoid messing up query
        $(".demo[data-url='"+model+"']").click();
    }
});
