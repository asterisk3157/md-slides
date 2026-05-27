"""Stroke — internal representation of one pen stroke (one inkml:trace).

A Stroke is a list of (x, y) points in a normalized 0..1 coordinate space
(per-glyph). When placed on a slide, points are scaled by font_size_cm and
translated to the glyph's origin.
"""
from dataclasses import dataclass, field
from typing import List, Tuple


Point = Tuple[float, float]   # (x, y) in 0..1 normalized glyph space


@dataclass
class Stroke:
    points: List[Point]                  # ordered pen samples

    def bbox(self) -> Tuple[float, float, float, float]:
        xs = [p[0] for p in self.points]
        ys = [p[1] for p in self.points]
        return min(xs), min(ys), max(xs), max(ys)


@dataclass
class GlyphAnchor:
    """文字内の意味的位置 (数式組版用)。

    type:  "sub" (下添字) | "sup" (上添字) | "body" (本体開始位置)
    x, y:  [0,1]×[0,1] 正規化座標 (グリフのbbox内)
    """
    type: str
    x: float
    y: float


@dataclass
class Glyph:
    """A glyph = list of strokes (in writing order) in a unit box [0,1]x[0,1].

    `advance` is the horizontal advance after this glyph, also in 0..1
    relative to font_size_cm (typically ~1.0 for fullwidth, ~0.5 for halfwidth).
    `anchors` は数式組版で使うアンカー点 (任意)。
    `coord_space`: "bbox" (デフォルト) or "canvas"。"canvas" は数式記号 (∫ ∑ √)
       でガイド枠に対する位置・サイズを保持する形式。
    """
    char: str
    strokes: List[Stroke] = field(default_factory=list)
    advance: float = 1.0
    anchors: List[GlyphAnchor] = field(default_factory=list)
    coord_space: str = "bbox"
