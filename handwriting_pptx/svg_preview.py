"""配置済みストロークを SVG プレビューに変換。

pptx を開かずにブラウザで配置・色・太字を確認できる。
Presentation の各 Slide (blocks → placed strokes) を SVG にする。

注意: これは Python 側のプレビュー。最終的な WYSIWYG エディタは JS レンダラへ
移植予定 (docs/design_decisions.md §6) だが、まずは同じ配置データを描いて
バグ確認できる状態を作る。
"""
from __future__ import annotations

from typing import List, Optional

from .inkml import PlacedStroke


def _stroke_to_polyline(s: PlacedStroke, px_per_cm: float,
                        default_color: str, base_width_cm: float,
                        bold_mult: float = 2.2) -> str:
    if not s.points_cm:
        return ""
    pts = " ".join(f"{x * px_per_cm:.1f},{y * px_per_cm:.1f}" for (x, y) in s.points_cm)
    color = s.color or default_color
    w_cm = base_width_cm * (bold_mult if s.bold else 1.0)
    w_px = max(1.0, w_cm * px_per_cm)
    return (
        f'<polyline points="{pts}" fill="none" stroke="{color}" '
        f'stroke-width="{w_px:.2f}" stroke-linecap="round" stroke-linejoin="round"/>'
    )


def slide_to_svg(slide, slide_w_cm: float, slide_h_cm: float,
                 px_per_cm: float = 40.0) -> str:
    """1 Slide を SVG 文字列に変換。"""
    w_px = slide_w_cm * px_per_cm
    h_px = slide_h_cm * px_per_cm
    parts: List[str] = []
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w_px:.0f}" height="{h_px:.0f}" '
        f'viewBox="0 0 {w_px:.0f} {h_px:.0f}" style="background:#fff;border:1px solid #ddd">'
    )
    for blk in slide.blocks:
        for s in blk.placed:
            line = _stroke_to_polyline(s, px_per_cm, slide.color, slide.brush_width_cm)
            if line:
                parts.append(line)
    parts.append("</svg>")
    return "".join(parts)


def presentation_to_svgs(pres, px_per_cm: float = 40.0) -> List[str]:
    """Presentation の全スライドを SVG リストに変換。"""
    return [
        slide_to_svg(s, pres.slide_w_cm, pres.slide_h_cm, px_per_cm)
        for s in pres._slides
    ]
