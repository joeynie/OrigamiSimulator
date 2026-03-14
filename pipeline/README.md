# Pipeline

> All commands are run from `OrigamiSimulator/` (the git root).

```
svg / fold
  └─ Step 1: node src/index.js          generate FOLD + actions
  └─ Step 2: python scripts/download.py  run simulator → trajectory JSON
  └─ Step 3: blender scripts/render.py   render RGB-D frames
  └─ Step 4: python scripts/reconstruct.py  produce side-by-side video
```

---

## Step 1 — Generate procedural FOLD patterns, recipes, and actions

```powershell
cd pipeline
python scripts/generate_dataset.py generate --num-samples 8
```

Writes to `pipeline/generated/`:

| File | Description |
|------|-------------|
| `base_templates.manifest.json` | semantic base curriculum and asset mapping |
| `procedural_sample_XXX.fold` | generated FOLD geometry |
| `procedural_sample_XXX.recipe.json` | high-level primitive sequence |
| `procedural_sample_XXX.actions.json` | compiled low-level simulator actions |
| `procedural_sample_XXX.trajectory_rabbitear.json` | lightweight sanity-check trajectory |

### Generate from a compound base template

```powershell
cd pipeline
python scripts/generate_dataset.py generate --template bird_base --num-samples 1
python scripts/generate_dataset.py generate --template preliminary_fold --num-samples 1
python scripts/generate_dataset.py generate --template all
```

This mode reads the asset-backed SVG/FOLD template, expands semantic steps such as
`preliminary_fold`, `kite_fold`, and `petal_fold`, then writes:

- `<template_id>_XXX.fold`
- `<template_id>_XXX.recipe.json`
- `<template_id>_XXX.actions.json`
- `<template_id>_XXX.trajectory_rabbitear.json`

### Generator structure

The procedural generator is now split into:

- `src/primitives/`  
  forward actions such as `book_fold`, `diagonal_fold`, `corner_fold`
- `src/sampler/`  
  random-walk / coverage-aware sampling policy
- `src/validators/`  
  legality and quality filters
- `src/recipes/`  
  compile high-level primitive steps into simulator-ready actions
- `src/exporters/`  
  write `fold + recipe + actions + trajectory`
- `templates/base_library.json`  
  editable base curriculum and step ordering

### Visual template editor

If you want a faster loop for editing `base_library.json`, previewing compiled crease groups,
and validating a template without hand-editing JSON + rerunning CLI commands:

```powershell
cd pipeline
python scripts/template_editor.py --port 8010
```

Then open:

```text
http://127.0.0.1:8010/
```

The editor can:

- load and save `templates/base_library.json`
- edit the semantic `recipe` step list
- preview the compiled `fold / recipe / actions`
- edit compiled `actions` directly, including `crease_ids / num_frames / hold_frames / schedule`
- save edited actions into `pipeline/generated/editor_preview/*_editor_actions.json`
- highlight crease IDs used by each compiled step
- run simulator export and, if available, trigger Blender RGB-D rendering
- open the compiled sample in `OrigamiSimulator`

### Editing base step order

If you want to adjust the semantic step order for `bird_base`, `frog_base`, `waterbomb_base`, and the other base templates, edit:

- `pipeline/templates/base_library.json`

You do not need to edit JS for this. The Python helper can inspect these templates:

```powershell
python scripts/generate_dataset.py list-templates
python scripts/generate_dataset.py show-template bird_base
```

Current status:

- Working primitives: `book_fold`, `diagonal_fold`, `corner_fold`
- Working sampler: constrained random walk on a normalized square
- Working compound template compiler: `preliminary_fold`, `waterbomb_base`, `bird_base`
- Intended extension point: add more asset-backed templates and replace the sampler with coverage-driven planning

---

## Step 2 — Export simulator trajectory

`scripts/download.py` starts a local HTTP server, opens the benchmark page headlessly, and saves the physics-simulated trajectory JSON automatically.

### 2a — Auto actions from an SVG

```powershell
python pipeline/scripts/download.py `
  --svg assets/Bases/birdBase.svg `
  --actions auto `
  --num-frames 4 --hold-frames 2 `
  --flatten-steps 400 `
  --output pipeline/generated/auto_trajectory.json `
  --save-auto-actions pipeline/generated/auto_actions.json `
  --start-server
```

### 2b — Custom actions from a FOLD file

```powershell
python pipeline/scripts/download.py `
  --fold pipeline/generated/simple_single_fold.fold `
  --actions pipeline/generated/actions.json `
  --output pipeline/generated/trajectory_simulator.json `
  --start-server
```

### CLI reference

| Option | Default | Description |
|--------|---------|-------------|
| `--svg <path>` | — | SVG source (mutually exclusive with `--fold`) |
| `--fold <path>` | — | FOLD source |
| `--actions <path\|auto>` | `auto` | Actions JSON, or `auto` to generate from crease geometry |
| `--output <path>` | `pipeline/generated/trajectory_simulator.json` | Output trajectory JSON |
| `--save-auto-actions <path>` | auto-derived | Where to save auto-suggested actions for manual editing |
| `--num-frames <n>` | 32 | Frames per action step (when `--actions auto`) |
| `--hold-frames <n>` | 0 | Hold frames appended after each action step |
| `--flatten-steps <n>` | 400 | Solver steps before sequence starts to settle paper flat |
| `--solver-steps-per-frame <n>` | — | Physics steps per rendered frame |
| `--timeout <s>` | 240 | Max seconds to wait for benchmark completion |
| `--browser auto\|edge\|chrome\|firefox` | `auto` | Browser driver to use |
| `--no-headless` | — | Show browser window (useful for debugging) |
| `--start-server` | — | Automatically start `python -m http.server` |

### Editing actions manually

Instead of using the browser DevTools console, use the file-based loop:

1. Run Step 2a with `--save-auto-actions` to get a draft `auto_actions.json`
2. Open `pipeline/generated/auto_actions.json` in VS Code and edit:
   - `crease_ids` / `edge_indices` — which creases to fold together
   - `num_frames` — animation length for this step
   - `hold_frames` — pause after folding
   - `end_actuation` — how far to fold (0–1)
   - `schedule` — `linear` / `ease_in` / `ease_out` / `ease_in_out`
3. Re-run with your edited file:

```powershell
python pipeline/scripts/download.py `
  --svg assets/Bases/birdBase.svg `
  --actions pipeline/generated/auto_actions.json `
  --output pipeline/generated/manual_trajectory.json `
  --start-server
```

---

## Step 3 — Render RGB-D frames in Blender

```powershell
blender -b -P pipeline/scripts/render.py -- `
  pipeline/generated/auto_trajectory.json `
  pipeline/render_output
```

Outputs per-frame `rgb/frame_NNNN.png` and `depth/frame_NNNN.exr` into `pipeline/render_output/`.

Reads from `pipeline/render_output/` and writes `pipeline/render_output/output_rgbd_side.mp4`.
