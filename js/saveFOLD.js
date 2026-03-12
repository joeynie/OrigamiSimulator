/**
 * Created by amandaghassaei on 5/6/17.
 */

function buildCurrentFoldJSON(){
    var geo = new THREE.Geometry().fromBufferGeometry( globals.model.getGeometry() );

    if (geo.vertices.length == 0 || geo.faces.length == 0) {
        return null;
    }

    if (globals.exportScale != 1){
        for (var i=0;i<geo.vertices.length;i++){
            geo.vertices[i].multiplyScalar(globals.exportScale);
        }
    }

    var filename = $("#foldFilename").val();
    if (filename == "") filename = globals.filename;

    var json = {
        file_spec: 1.1,
        file_creator: "Origami Simulator: http://git.amandaghassaei.com/OrigamiSimulator/",
        file_author: $("#foldAuthor").val(),
        file_classes: ["singleModel"],
        frame_title: filename,
        frame_classes: ["foldedForm"],
        frame_attributes: ["3D"],
        frame_unit: globals.foldUnits,
        vertices_coords: [],
        edges_vertices: [],
        edges_assignment: [],
        faces_vertices: []
    };

    for (var i=0;i<geo.vertices.length;i++){
        var vertex = geo.vertices[i];
        json.vertices_coords.push([vertex.x, vertex.y, vertex.z]);
    }

    var useTriangulated = globals.triangulateFOLDexport;
    if (!globals.includeCurves) {
        var fold = globals.pattern.getFoldData(!useTriangulated);
    } else {
        var fold = globals.curvedFolding.getFoldData(!useTriangulated);
    }
    json.edges_vertices = fold.edges_vertices;
    var assignment = [];
    for (var i=0;i<fold.edges_assignment.length;i++){
        if (fold.edges_assignment[i] == "C") assignment.push("B");
        else assignment.push(fold.edges_assignment[i]);
    }
    json.edges_assignment = assignment;
    json.faces_vertices = fold.faces_vertices;

    if (globals.exportFoldAngle){
        var currentAngles = fold.edges_foldAngle ? fold.edges_foldAngle.slice() : [];
        var creases = globals.model.getCreases();
        for (var i=0;i<creases.length;i++){
            var crease = creases[i];
            var edgeIndex = crease.getSourceEdgeIndex ? crease.getSourceEdgeIndex() : null;
            if (edgeIndex === null || edgeIndex === undefined || edgeIndex < 0) continue;
            currentAngles[edgeIndex] = crease.getTargetTheta() * crease.getActuation() * 180 / Math.PI;
        }
        json.edges_foldAngle = currentAngles;
    }

    return json;
}

function saveFOLD(){

    var json = buildCurrentFoldJSON();
    if (!json) {
        globals.warn("No geometry to save.");
        return;
    }

    var blob = new Blob([JSON.stringify(json, null, 4)], {type: 'application/octet-binary'});
    saveAs(blob, json.frame_title + ".fold");
}
