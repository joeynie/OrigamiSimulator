# Pipeline

当前 `pipeline/` 只保留这条编辑器导出链：

1. `python scripts/template_editor.py`
   打开折纸步骤编辑器，保存项目，导出顺序 Rabbit Ear 轨迹
2. `blender -b -P pipeline/scripts/render.py -- <trajectory.json> <output_dir>`
   渲染 RGB-D 帧
3. `python pipeline/scripts/reconstruct.py <output_dir>`
   合成视频

## Editor

启动：

```powershell
cd OrigamiSimulator/pipeline
python scripts/template_editor.py --port 8010
```

访问：

```text
http://127.0.0.1:8010/pipeline/editor/
```

编辑器会把项目保存到：

- `pipeline/projects/*.json`

导出的顺序轨迹保存到：

- `pipeline/generated/*.trajectory_forward.json`

## Render

```powershell
blender -b -P pipeline/scripts/render.py -- `
  pipeline/generated/example.trajectory_forward.json `
  pipeline/render_output
```

渲染输出：

- `pipeline/render_output/rgb/frame_*.png`
- `pipeline/render_output/depth/frame_*.exr`

### Blender 交互预览（不出图）

可以直接在 Blender GUI 里拖时间轴查看折纸变化：

```powershell
blender -P pipeline/scripts/render.py -- `
   pipeline/generated/example.trajectory_forward.json `
   pipeline/render_output `
   --preview
```

说明：

- `--preview` 会加载轨迹并注册时间轴回调，不执行逐帧渲染。
- 仍会复用同一份网格更新逻辑，便于和无头渲染保持一致。

## Reconstruct

```powershell
python pipeline/scripts/reconstruct.py pipeline/render_output
```

默认会在输出目录内生成拼接视频。

## Replay Validate (No-Web Debug)

用于离线验证“每条折痕只影响预期面”，不需要打开编辑器网页：

```powershell
node pipeline/scripts/validate_replay.js --project pipeline/projects/kite.json
```

可选传入断言文件，并将完整报告写到 JSON：

```powershell
node pipeline/scripts/validate_replay.js -- `
   --project pipeline/projects/kite.json `
   --expect pipeline/generated/kite.expectation.json `
   --report pipeline/generated/kite.validation_report.json
```

退出码：

- `0`: 全部断言通过
- `1`: 至少一条 crease 断言失败
- `2`: 参数或运行错误

断言文件格式（`creases` 以 crease id 为 key）：

```json
{
   "strictScope": true,
   "creases": {
      "crease-id": {
         "scopeFaceIds": [0],
         "changedSourceFaces": [0],
         "maxChangedSourceFaces": 1,
         "minChangedSourceFaces": 1
      }
   }
}
```

## SVG Sequence Validate (Updated Pipeline)

针对 `type: "svg-sequence"` 项目，快速检查“折痕组到边映射 + 步骤分配”是否一致：

```powershell
node pipeline/scripts/validate_svg_sequence.js --project pipeline/projects/demo.json --strict
```

说明：

- 会检查 `creaseGroups[].edgeIndices` 是否为空或越界。
- 会检查同一条 edge 是否被多个 creaseGroup 重复占用。
- 会检查 `steps[].creaseIds` 是否引用了不存在的折痕组。
- 返回码：`0` 通过，`1` 有校验失败，`2` 参数或运行错误。
