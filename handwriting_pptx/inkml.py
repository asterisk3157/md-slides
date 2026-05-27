"""InkML XML 生成。

W3C InkML 形式の `<inkml:ink>` を、お手本 (PowerPoint 互換) と
同じ要素構造で出力する。座標は絶対座標表記 `"x1 y1 F1, x2 y2 F2, ..."`
を採用 (PowerPoint も読める)。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

from .stroke import Stroke
from .units import cm_to_ink


INKML_NS = "http://www.w3.org/2003/InkML"


@dataclass
class PlacedStroke:
    """配置済みストローク (絶対座標 cm)。"""

    points_cm: List[Tuple[float, float]]
    pressures: Optional[List[float]] = None  # 0..1
    bold: bool = False   # True なら太字ブラシ (幅を太く)
    color: Optional[str] = None  # "#RRGGBB"。None ならブロック既定色を使う


def _norm_color(c: str) -> str:
    if not c.startswith("#"):
        c = "#" + c
    return c.upper()


def build_inkml(
    strokes: Sequence[PlacedStroke],
    color: str = "#000000",
    brush_width_cm: float = 0.08571,
    timestamp: str = "2026-05-18T00:00:00.000",
    bold_width_mult: float = 1.8,
) -> str:
    """InkML XML 文字列を返す。

    ストロークごとの (色, 太字) の組合せ分だけブラシを定義し、各 trace が
    対応する brushRef を参照する。色はストローク個別 (PlacedStroke.color) を優先し、
    無ければブロック既定色 `color`。太字は幅 bold_width_mult 倍。
    これにより太字・色分けを別ファイル/別ブロックに分けずに済み、xfrm の引き伸ばしを防ぐ。
    """
    default_color = _norm_color(color)
    bold_width_cm = brush_width_cm * bold_width_mult

    # 出現する (色, 太字) の組合せ → brush id を割り当て
    combos: dict = {}
    for s in strokes:
        if not s.points_cm:
            continue
        c = _norm_color(s.color) if s.color else default_color
        key = (c, bool(s.bold))
        if key not in combos:
            combos[key] = f"br{len(combos)}"
    if not combos:
        combos[(default_color, False)] = "br0"

    parts: List[str] = []
    parts.append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
    parts.append('<inkml:ink xmlns:inkml="http://www.w3.org/2003/InkML">')
    parts.append("<inkml:definitions>")
    parts.append('<inkml:context xml:id="ctx0">')
    parts.append('<inkml:inkSource xml:id="inkSrc0">')
    parts.append("<inkml:traceFormat>")
    parts.append(
        '<inkml:channel name="X" type="integer" min="-2.14748E9" max="2.14748E9" units="cm"/>'
    )
    parts.append(
        '<inkml:channel name="Y" type="integer" min="-2.14748E9" max="2.14748E9" units="cm"/>'
    )
    parts.append('<inkml:channel name="F" type="integer" max="32767" units="dev"/>')
    parts.append("</inkml:traceFormat>")
    parts.append("<inkml:channelProperties>")
    parts.append(
        '<inkml:channelProperty channel="X" name="resolution" value="1000" units="1/cm"/>'
    )
    parts.append(
        '<inkml:channelProperty channel="Y" name="resolution" value="1000" units="1/cm"/>'
    )
    parts.append(
        '<inkml:channelProperty channel="F" name="resolution" value="0" units="1/dev"/>'
    )
    parts.append("</inkml:channelProperties>")
    parts.append("</inkml:inkSource>")
    parts.append(f'<inkml:timestamp xml:id="ts0" timeString="{timestamp}"/>')
    parts.append("</inkml:context>")
    # (色, 太字) ごとにブラシを定義
    for (c, is_bold), brush_id in combos.items():
        w = bold_width_cm if is_bold else brush_width_cm
        parts.append(f'<inkml:brush xml:id="{brush_id}">')
        parts.append(f'<inkml:brushProperty name="width" value="{w:.5f}" units="cm"/>')
        parts.append(f'<inkml:brushProperty name="height" value="{w:.5f}" units="cm"/>')
        parts.append(f'<inkml:brushProperty name="color" value="{c}"/>')
        parts.append("</inkml:brush>")
    parts.append("</inkml:definitions>")

    for s in strokes:
        if not s.points_cm:
            continue
        triples: List[str] = []
        for i, (x, y) in enumerate(s.points_cm):
            xi = cm_to_ink(x)
            yi = cm_to_ink(y)
            if s.pressures and i < len(s.pressures):
                f = int(round(max(0.0, min(1.0, s.pressures[i])) * 32767))
            else:
                f = 16384
            triples.append(f"{xi} {yi} {f}")
        trace_text = ", ".join(triples)
        c = _norm_color(s.color) if s.color else default_color
        brush_ref = combos[(c, bool(s.bold))]
        parts.append(
            f'<inkml:trace contextRef="#ctx0" brushRef="#{brush_ref}">{trace_text}</inkml:trace>'
        )
    parts.append("</inkml:ink>")
    return "".join(parts)


def stroke_to_placed(
    stroke: Stroke,
    origin_cm: Tuple[float, float],
    size_cm: float,
    pressures: Optional[List[float]] = None,
    bold: bool = False,
    color: Optional[str] = None,
) -> PlacedStroke:
    """正規化 (0..1) Stroke を、配置済み絶対座標 PlacedStroke に変換。"""
    ox, oy = origin_cm
    pts = [(ox + x * size_cm, oy + y * size_cm) for (x, y) in stroke.points]
    return PlacedStroke(points_cm=pts, pressures=pressures, bold=bold, color=color)


def bbox_of_placed(strokes: Sequence[PlacedStroke]) -> Tuple[float, float, float, float]:
    xs: List[float] = []
    ys: List[float] = []
    for s in strokes:
        for x, y in s.points_cm:
            xs.append(x)
            ys.append(y)
    if not xs:
        return (0.0, 0.0, 0.0, 0.0)
    return (min(xs), min(ys), max(xs), max(ys))
