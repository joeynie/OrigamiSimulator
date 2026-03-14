import argparse
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


def repo_root():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))


def pipeline_root():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def projects_root():
    return os.path.join(pipeline_root(), "projects")


def generated_root():
    return os.path.join(pipeline_root(), "generated")


def default_project():
    return {
        "name": "blank_square",
        "settings": {
            "framesPerStep": 32,
        },
        "fold": {
            "file_spec": 1.2,
            "file_creator": "OrigamiSimulator/pipeline cp editor",
            "frame_classes": ["creasePattern"],
            "vertices_coords": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "edges_vertices": [[0, 1], [1, 2], [2, 3], [3, 0]],
            "edges_assignment": ["B", "B", "B", "B"],
            "edges_foldAngle": [0, 0, 0, 0],
            "edges_crease_id": [None, None, None, None],
            "faces_vertices": [[0, 1, 2, 3]],
        },
        "steps": [],
    }


def ensure_projects_root():
    os.makedirs(projects_root(), exist_ok=True)
    blank_path = project_path("blank_square")
    if not os.path.exists(blank_path):
        write_json(blank_path, default_project())


def ensure_generated_root():
    os.makedirs(generated_root(), exist_ok=True)


def sanitize_name(name):
    value = (name or "").strip()
    if not value:
        raise ValueError("Project name is required")
    allowed = []
    for char in value:
        if char.isalnum() or char in ("_", "-", "."):
            allowed.append(char)
    sanitized = "".join(allowed).strip(".")
    if not sanitized:
        raise ValueError("Project name contains no valid characters")
    return sanitized


def project_path(name):
    return os.path.join(projects_root(), f"{sanitize_name(name)}.json")


def generated_trajectory_path(name):
    return os.path.join(generated_root(), f"{sanitize_name(name)}.trajectory_forward.json")


def read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def list_projects():
    ensure_projects_root()
    items = []
    for entry in sorted(os.listdir(projects_root())):
        if not entry.endswith(".json"):
            continue
        path = os.path.join(projects_root(), entry)
        payload = read_json(path)
        items.append(
            {
                "name": payload.get("name") or entry[:-5],
                "type": payload.get("type"),
                "path": os.path.relpath(path, repo_root()).replace("\\", "/"),
            }
        )
    return items


def list_projects_by_type(project_type=None):
    items = list_projects()
    if not project_type:
        return [item for item in items if item.get("type") != "svg-sequence"]
    return [item for item in items if item.get("type") == project_type]


def list_svg_assets():
    ensure_projects_root()
    items = []
    for entry in sorted(os.listdir(projects_root())):
        if not entry.lower().endswith(".svg"):
            continue
        path = os.path.join(projects_root(), entry)
        items.append(
            {
                "name": entry,
                "path": os.path.relpath(path, repo_root()).replace("\\", "/"),
            }
        )
    return items


def load_project(name):
    path = project_path(name)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Project not found: {name}")
    payload = read_json(path)
    payload["name"] = payload.get("name") or sanitize_name(name)
    payload.setdefault("settings", default_project()["settings"])
    payload.setdefault("fold", default_project()["fold"])
    payload.setdefault("steps", [])
    return payload


def save_project(name, project):
    normalized_name = sanitize_name(name)
    payload = project or {}
    payload["name"] = normalized_name
    payload.setdefault("settings", default_project()["settings"])
    payload.setdefault("fold", default_project()["fold"])
    payload.setdefault("steps", [])
    path = project_path(normalized_name)
    write_json(path, payload)
    return path


def delete_project(name):
    path = project_path(name)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Project not found: {name}")
    os.remove(path)


def save_trajectory_export(name, trajectory):
    path = generated_trajectory_path(name or "origami_project")
    write_json(path, trajectory or {})
    return path


class EditorHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=repo_root(), **kwargs)

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.send_response(302)
            self.send_header("Location", "/pipeline/editor/point/")
            self.end_headers()
            return
        if parsed.path == "/pipeline/editor/" or parsed.path == "/pipeline/editor":
            self.send_response(302)
            self.send_header("Location", "/pipeline/editor/point/")
            self.end_headers()
            return
        if parsed.path == "/api/projects":
            query = parse_qs(parsed.query)
            project_type = (query.get("type") or [""])[0] or None
            self._send_json(200, {"projects": list_projects_by_type(project_type)})
            return
        if parsed.path == "/api/svg-assets":
            self._send_json(200, {"assets": list_svg_assets()})
            return
        if parsed.path == "/api/project":
            query = parse_qs(parsed.query)
            name = (query.get("name") or [""])[0]
            try:
                self._send_json(200, {"project": load_project(name)})
            except Exception as exc:
                self._send_json(400, {"error": str(exc)})
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            payload = self._read_json()
            if parsed.path == "/api/project/save":
                name = payload.get("name") or payload.get("project", {}).get("name")
                path = save_project(name, payload.get("project"))
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "name": sanitize_name(name),
                        "path": os.path.relpath(path, repo_root()).replace("\\", "/"),
                    },
                )
                return
            if parsed.path == "/api/project/delete":
                delete_project(payload.get("name"))
                self._send_json(200, {"ok": True})
                return
            if parsed.path == "/api/export/trajectory":
                path = save_trajectory_export(
                    payload.get("name") or payload.get("trajectory", {}).get("project_name") or "origami_project",
                    payload.get("trajectory"),
                )
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "path": os.path.relpath(path, repo_root()).replace("\\", "/"),
                    },
                )
                return
            self._send_json(404, {"error": f"Unknown endpoint: {parsed.path}"})
        except Exception as exc:
            self._send_json(400, {"error": str(exc)})


def main():
    parser = argparse.ArgumentParser(description="Lightweight Origami CP editor server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8010)
    args = parser.parse_args()

    ensure_projects_root()
    ensure_generated_root()
    server = ThreadingHTTPServer((args.host, args.port), EditorHandler)
    print(f"Serving editor at http://{args.host}:{args.port}/pipeline/editor/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
