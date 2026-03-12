## Pipeline
```
svg / fold --> actions --> trajectory --> render rgbd / video 
```

### 1. Generate a fold file and actions

From `data/`:

```bash
node index.js
```

This writes:

- `data/generated/simple_single_fold.fold`
- `data/generated/actions.json`
- `data/generated/trajectory_rabbitear.json`

`trajectory_rabbitear.json` is a lightweight sanity check. The simulator export below is the preferred source for Blender rendering.

### 2. Export a simulator trajectory

Serve the repo root, for example:

```bash
python -m http.server 8000
```

Open:

```text
http://localhost:8000/OrigamiSimulator/index.html?bench=1&fold=../data/generated/simple_single_fold.fold&actions=../data/generated/actions.json&output_name=trajectory_simulator.json&download=1
```

The page will auto-run the sequence, hide most UI, and download `trajectory_simulator.json`.

You can also use an existing SVG directly and ask the simulator to build a first-pass action draft:

```text
http://localhost:8000/OrigamiSimulator/index.html?bench=1&svg=assets/Bases/birdBase.svg&actions=auto&output_name=birdBase_auto_trajectory.json&download=1
```

The suggested grouped actions will be stored in `window.origamiBenchSuggestedActions`.

### 2.1 Export trajectory by code (no manual browser console)

You can now run `download.py` to open the benchmark page automatically and save trajectory JSON.

Use SVG source (auto actions):

```bash
python data/download.py \
	--svg assets/Bases/birdBase.svg \
	--actions auto \
	--output data/birdBase_auto_trajectory.json \
	--start-server
```

Use FOLD source (custom actions file):

```bash
python data/download.py \
	--fold data/generated/simple_single_fold.fold \
	--actions data/generated/actions.json \
	--output data/trajectory_simulator.json \
	--start-server
```

Useful options:

- `--save-auto-actions data/birdBase_auto_actions.json` save auto-suggested actions into a JSON file
- `--solver-steps-per-frame 80` control physics solve steps per frame
- `--timeout 300` increase waiting time for complex folds
- `--browser edge|chrome|firefox|auto` choose browser driver
- `--no-headless` show browser window for debugging

### 2.2 More intuitive way to edit actions

Instead of editing in DevTools console, use this file-based loop:

1. Generate first draft actions automatically:

```bash
python data/download.py `
	--svg assets/Bases/boatBase.svg `
	--actions auto `
	--num-frames 2  --hold-frames 2 `
	--output data/generated/auto_trajectory.json `
	--save-auto-actions data/generated/auto_actions.json `
	--start-server
```

2. Open `data/generated/auto_actions.json` directly in VS Code and edit fields like:
	 - `crease_ids` / `edge_indices`
	 - `num_frames`
	 - `hold_frames`
	 - `end_actuation`
	 - `schedule`

3. Re-run with your edited actions file:

```bash
python data/download.py \
	--svg assets/Origami/flat_crane.svg \
	--actions data/generated/auto_actions.json \
	--output data/generated/manual_trajectory.json \
	--start-server
```

This avoids repeated console operations and makes action tuning much easier to review with git diff.

### 3. Render RGB-D in Blender

Put the exported simulator file at `data/trajectory.json`, or pass it explicitly:

```bash
blender -b -P data/render.py -- data/generated/auto_trajectory.json data/render_output

cd data
python reconstruct.py
```

The script accepts both the old `trajectory` layout and the new `frames` layout.
