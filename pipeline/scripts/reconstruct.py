"""
reconstruct.py
==============
从 render_output/ 的 RGB-D 数据生成 RGB | Depth 并排对比视频。

运行：
  conda activate mlagents
  python reconstruct.py
"""

import os

# 必须在 import cv2 之前设置，否则 OpenCV 初始化时不生效
os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"

import numpy as np
import cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import imageio.v2 as imageio_v2

BASE_DIR  = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))  # data/
RGB_DIR   = os.path.join(BASE_DIR, "render_output", "rgb")
DEPTH_DIR = os.path.join(BASE_DIR, "render_output", "depth")
OUT_DIR   = os.path.join(BASE_DIR, "render_output")
os.makedirs(OUT_DIR, exist_ok=True)

FPS = 8
N_FRAMES = len([f for f in os.listdir(RGB_DIR) if f.endswith(".png")])


def read_rgb(i):
    p = os.path.join(RGB_DIR, f"frame_{i:04d}.png")
    img = cv2.imread(p, cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(p)
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def read_depth(i):
    p = os.path.join(DEPTH_DIR, f"frame_{i:04d}.exr")
    d = cv2.imread(p, cv2.IMREAD_ANYCOLOR | cv2.IMREAD_ANYDEPTH)
    if d is None:
        raise FileNotFoundError(p)
    return d[:, :, 0].astype(np.float32)


def depth_to_colormap(depth, vmin, vmax):
    d_norm = np.clip((depth - vmin) / (vmax - vmin + 1e-8), 0, 1)
    colored = (plt.get_cmap("plasma")(d_norm)[:, :, :3] * 255).astype(np.uint8)
    colored[depth > 1e9] = 255   # 背景设为白色
    return colored


def collect_depth_stats():
    vmin, vmax = float("inf"), float("-inf")
    for i in range(1, N_FRAMES + 1):
        valid = read_depth(i)
        valid = valid[valid < 1e9]
        if len(valid):
            vmin = min(vmin, valid.min())
            vmax = max(vmax, np.percentile(valid, 98))
    return vmin, vmax


if __name__ == "__main__":
    print("扫描深度范围...")
    vmin, vmax = collect_depth_stats()
    print(f"深度范围: {vmin:.3f} ~ {vmax:.3f}")

    out_path = os.path.join(OUT_DIR, "output_rgbd_side.mp4")
    writer = imageio_v2.get_writer(out_path, fps=FPS, codec="libx264", quality=8)

    for i in range(1, N_FRAMES + 1):
        rgb  = read_rgb(i)
        dcol = depth_to_colormap(read_depth(i), vmin, vmax)

        cv2.putText(rgb,  f"RGB  f{i:02d}", (8, 24),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.putText(dcol, "Depth (plasma)", (8, 24),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 1, cv2.LINE_AA)

        writer.append_data(np.concatenate([rgb, dcol], axis=1))

    writer.close()
    print(f"✅ 已保存: {out_path}")
