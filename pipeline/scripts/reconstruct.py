"""
reconstruct.py
==============
生成 RGB | Depth 并排对比视频。

可独立运行：
  python reconstruct.py [output_dir]

也可由 render.py 自动调用（默认开启）。
"""

import os
import sys

# 必须在 import cv2 之前设置
os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"

import cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import imageio.v2 as imageio_v2


def build_rgbd_video(output_dir, fps=8):
    """从 output_dir/rgb/ 和 output_dir/depth/ 生成 output_dir/output_rgbd_side.mp4。"""
    rgb_dir   = os.path.join(output_dir, "rgb")
    depth_dir = os.path.join(output_dir, "depth")
    out_path  = os.path.join(output_dir, "output_rgbd_side.mp4")

    frames = sorted(f for f in os.listdir(rgb_dir) if f.endswith(".png"))
    n = len(frames)
    if n == 0:
        print("[reconstruct] 未找到 RGB 帧，跳过视频生成。")
        return

    def read_rgb(i):
        img = cv2.imread(os.path.join(rgb_dir, f"frame_{i:04d}.png"), cv2.IMREAD_COLOR)
        if img is None:
            raise FileNotFoundError(os.path.join(rgb_dir, f"frame_{i:04d}.png"))
        return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    def read_depth(i):
        d = cv2.imread(os.path.join(depth_dir, f"frame_{i:04d}.exr"),
                       cv2.IMREAD_ANYCOLOR | cv2.IMREAD_ANYDEPTH)
        if d is None:
            raise FileNotFoundError(os.path.join(depth_dir, f"frame_{i:04d}.exr"))
        return d[:, :, 0].astype(np.float32)

    def depth_to_colormap(depth, vmin, vmax):
        d_norm = np.clip((depth - vmin) / (vmax - vmin + 1e-8), 0, 1)
        colored = (plt.get_cmap("plasma")(d_norm)[:, :, :3] * 255).astype(np.uint8)
        colored[depth > 1e9] = 255
        return colored

    print("[reconstruct] 扫描深度范围...")
    vmin, vmax = float("inf"), float("-inf")
    for i in range(1, n + 1):
        valid = read_depth(i)
        valid = valid[valid < 1e9]
        if len(valid):
            vmin = min(vmin, valid.min())
            vmax = max(vmax, np.percentile(valid, 98))
    print(f"[reconstruct] 深度范围: {vmin:.3f} ~ {vmax:.3f}")

    writer = imageio_v2.get_writer(out_path, fps=fps, codec="libx264", quality=8)
    for i in range(1, n + 1):
        rgb  = read_rgb(i)
        dcol = depth_to_colormap(read_depth(i), vmin, vmax)
        cv2.putText(rgb,  f"RGB  f{i:02d}", (8, 24),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.putText(dcol, "Depth (plasma)", (8, 24),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 1, cv2.LINE_AA)
        writer.append_data(np.concatenate([rgb, dcol], axis=1))
    writer.close()
    print(f"[reconstruct] ✅ 已保存: {out_path}")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..")), "render_output"
    )
    build_rgbd_video(out)
