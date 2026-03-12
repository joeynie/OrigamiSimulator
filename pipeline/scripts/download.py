import argparse
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

from selenium import webdriver
from selenium.common.exceptions import WebDriverException


def repo_root():
	# scripts/ ─ pipeline/ ─ OrigamiSimulator/ (git root + HTTP server root)
	return os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))


def to_workspace_url_path(value, root):
	if value is None:
		return None
	value = value.strip()
	if not value:
		return value
	if value.startswith("http://") or value.startswith("https://"):
		return value

	normalized = value.replace("\\", "/")
	if not os.path.isabs(value):
		return normalized

	rel = os.path.relpath(value, root)
	if rel.startswith(".."):
		raise ValueError(f"Path is outside workspace root: {value}")
	return rel.replace("\\", "/")


def wait_http_ready(url, timeout_sec):
	end = time.time() + timeout_sec
	last_error = None
	while time.time() < end:
		try:
			with urllib.request.urlopen(url, timeout=2):
				return
		except Exception as exc:
			last_error = exc
			time.sleep(0.25)
	raise RuntimeError(f"HTTP server not ready: {url} ({last_error})")


def start_http_server(root, host, port):
	command = [sys.executable, "-m", "http.server", str(port), "--bind", host]
	return subprocess.Popen(command, cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def build_driver(browser_name, headless):
	candidates = [browser_name] if browser_name != "auto" else ["edge", "chrome", "firefox"]
	last_error = None

	for name in candidates:
		try:
			if name == "edge":
				options = webdriver.EdgeOptions()
				if headless:
					options.add_argument("--headless=new")
				options.add_argument("--disable-gpu")
				options.add_argument("--window-size=1600,1200")
				return webdriver.Edge(options=options), name
			if name == "chrome":
				options = webdriver.ChromeOptions()
				if headless:
					options.add_argument("--headless=new")
				options.add_argument("--disable-gpu")
				options.add_argument("--window-size=1600,1200")
				return webdriver.Chrome(options=options), name
			if name == "firefox":
				options = webdriver.FirefoxOptions()
				if headless:
					options.add_argument("-headless")
				return webdriver.Firefox(options=options), name
		except WebDriverException as exc:
			last_error = exc

	raise RuntimeError(f"Unable to start browser driver ({candidates}). Last error: {last_error}")


def poll_export(driver, timeout_sec):
	end = time.time() + timeout_sec
	status = ""
	while time.time() < end:
		payload_raw = driver.execute_script(
			"return window.origamiBenchLastTrajectory ? JSON.stringify(window.origamiBenchLastTrajectory) : null;"
		)
		if payload_raw:
			payload = json.loads(payload_raw)
			actions_raw = driver.execute_script(
				"return window.origamiBenchSuggestedActions ? JSON.stringify(window.origamiBenchSuggestedActions) : null;"
			)
			actions = json.loads(actions_raw) if actions_raw else None
			return payload, actions

		status_text = driver.execute_script(
			"var e=document.getElementById('benchmarkStatus'); return e ? e.textContent : '';"
		)
		if status_text:
			status = status_text
		time.sleep(0.5)

	raise TimeoutError(f"Timeout waiting benchmark output. Last status: {status}")


def save_json(path, obj):
	os.makedirs(os.path.dirname(path), exist_ok=True)
	with open(path, "w", encoding="utf-8") as handle:
		json.dump(obj, handle, ensure_ascii=False, indent=2)


def parse_args():
	parser = argparse.ArgumentParser(
		description="Auto-run OrigamiSimulator benchmark page and export trajectory JSON."
	)
	source = parser.add_mutually_exclusive_group(required=True)
	source.add_argument("--svg", help="SVG path (workspace-relative URL path or absolute path in workspace)")
	source.add_argument("--fold", help="FOLD path (workspace-relative URL path or absolute path in workspace)")

	parser.add_argument("--actions", default="auto", help="Actions path or 'auto' (default: auto)")
	parser.add_argument("--output", default=None,
		help="Output trajectory JSON path (default: data/generated/trajectory_simulator.json under workspace root)")
	parser.add_argument("--save-auto-actions", default=None, help="Optional path to save auto-suggested actions JSON")
	parser.add_argument("--host", default="127.0.0.1", help="HTTP server host")
	parser.add_argument("--port", type=int, default=8000, help="HTTP server port")
	parser.add_argument("--start-server", action="store_true", help="Start python -m http.server automatically")
	parser.add_argument("--timeout", type=int, default=240, help="Timeout seconds for benchmark run")
	parser.add_argument("--browser", choices=["auto", "edge", "chrome", "firefox"], default="auto")
	parser.add_argument("--no-headless", action="store_true", help="Show browser window")
	parser.add_argument("--num-frames", type=int, default=None, dest="num_frames",
		help="Frames per action step when actions=auto (sets auto_num_frames URL param)")
	parser.add_argument("--hold-frames", type=int, default=None, dest="hold_frames",
		help="Hold frames per action step when actions=auto")
	parser.add_argument("--flatten-steps", type=int, default=400, dest="flatten_steps",
		help="Solver steps to run before sequence to physically settle the paper flat (default: 400, set 0 to skip)")
	parser.add_argument("--solver-steps-per-frame", type=int, default=None)
	parser.add_argument("--settle-steps", type=int, default=0)
	parser.add_argument("--hide-ui", type=int, choices=[0, 1], default=1)
	return parser.parse_args()


def main():
	args = parse_args()
	root = repo_root()
	if args.output is None:
		output_path = os.path.join(root, "pipeline", "generated", "trajectory_simulator.json")
	else:
		output_path = os.path.abspath(args.output)

	if args.save_auto_actions:
		auto_actions_path = os.path.abspath(args.save_auto_actions)
	else:
		stem = os.path.splitext(os.path.basename(output_path))[0]
		auto_actions_path = os.path.join(os.path.dirname(output_path), f"{stem}_auto_actions.json")

	svg_path = to_workspace_url_path(args.svg, root)
	fold_path = to_workspace_url_path(args.fold, root)
	actions_path = "auto" if args.actions == "auto" else to_workspace_url_path(args.actions, root)

	params = {
		"bench": "1",
		"actions": actions_path,
		"output_name": os.path.basename(output_path),
		"download": "0",
		"capture": "1",
		"hide_ui": str(args.hide_ui),
	}
	if svg_path:
		params["svg"] = svg_path
	if fold_path:
		params["fold"] = fold_path
	if args.num_frames is not None:
		params["auto_num_frames"] = str(args.num_frames)
	if args.hold_frames is not None:
		params["auto_hold_frames"] = str(args.hold_frames)
	params["flatten_steps"] = str(args.flatten_steps)
	if args.solver_steps_per_frame is not None:
		params["solver_steps_per_frame"] = str(args.solver_steps_per_frame)
	if args.settle_steps:
		params["settle_steps"] = str(args.settle_steps)

	base = f"http://{args.host}:{args.port}"
	url = f"{base}/index.html?{urllib.parse.urlencode(params)}"

	server_proc = None
	driver = None
	try:
		if args.start_server:
			server_proc = start_http_server(root, args.host, args.port)

		wait_http_ready(base, timeout_sec=8)
		driver, used_browser = build_driver(args.browser, headless=(not args.no_headless))
		print(f"Using browser: {used_browser}")
		print(f"Opening: {url}")
		driver.get(url)

		payload, suggested_actions = poll_export(driver, timeout_sec=args.timeout)
		save_json(output_path, payload)

		metadata = payload.get("metadata", {})
		print(f"Saved trajectory: {output_path}")
		print(f"Actions: {metadata.get('action_count')} | Frames: {metadata.get('frame_count')}")

		if args.actions == "auto" and suggested_actions is not None:
			save_json(auto_actions_path, {"actions": suggested_actions, "options": {"capture": True}})
			print(f"Saved suggested actions: {auto_actions_path}")

	finally:
		if driver is not None:
			driver.quit()
		if server_proc is not None:
			server_proc.terminate()
			try:
				server_proc.wait(timeout=2)
			except Exception:
				server_proc.kill()


if __name__ == "__main__":
	main()
