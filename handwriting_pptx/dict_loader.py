"""辞書JSON読み込み。

CLAUDE.md「辞書JSONフォーマット仕様」を参照。
正規化座標 [0,1] × [0,1] のストロークデータを Glyph に変換する。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from .stroke import Glyph, Stroke


@dataclass
class Anchor:
    """文字内の意味的位置（数式組版用）。

    type:  "sub" (下添字) | "sup" (上添字) | "body" (本体開始)
    x, y:  bbox を [0,1]×[0,1] にした正規化座標
    """
    type: str
    x: float
    y: float


@dataclass
class Variant:
    id: str
    strokes: List[Stroke]
    bbox: List[float]
    advance: float = 1.0
    pressures: List[List[float]] = field(default_factory=list)
    anchors: List[Anchor] = field(default_factory=list)
    # "bbox" (default): strokes are normalized to stroke bbox; placed in glyph_size square.
    # "canvas": strokes are normalized to original canvas [0,1]; placed preserving
    #           written position/aspect within a canvas cell of size (canvas_cell_size).
    coord_space: str = "bbox"


class Dictionary:
    """文字 → Variant 一覧 のマップ。

    現状は最初のバリエーションだけを使う簡易実装。
    """

    def __init__(self, data: Optional[dict] = None):
        self._data = data or {"version": "1", "characters": {}}
        self._chars: Dict[str, List[Variant]] = {}
        self._parse()

    @classmethod
    def from_path(cls, path: str | Path) -> "Dictionary":
        with open(path, "r", encoding="utf-8") as f:
            return cls(json.load(f))

    @classmethod
    def empty(cls) -> "Dictionary":
        return cls()

    def _parse(self) -> None:
        chars = self._data.get("characters", {}) or {}
        for ch, payload in chars.items():
            variants_raw = payload.get("variants", []) or []
            variants: List[Variant] = []
            for v in variants_raw:
                strokes_raw = v.get("strokes", []) or []
                strokes: List[Stroke] = []
                pressures: List[List[float]] = []
                for s in strokes_raw:
                    points = [tuple(p) for p in s.get("points", [])]
                    if len(points) < 1:
                        continue
                    strokes.append(Stroke(points=points))
                    pressures.append(list(s.get("pressures") or []))
                anchors_raw = v.get("anchors", []) or []
                anchors = [
                    Anchor(type=a.get("type", ""), x=float(a.get("x", 0)), y=float(a.get("y", 0)))
                    for a in anchors_raw
                    if a.get("type")
                ]
                coord_space = v.get("coord_space", "bbox")
                variants.append(
                    Variant(
                        id=v.get("id", "v?"),
                        strokes=strokes,
                        bbox=v.get("bbox", [0.0, 0.0, 1.0, 1.0]),
                        advance=float(v.get("advance", 1.0)),
                        pressures=pressures,
                        anchors=anchors,
                        coord_space=coord_space,
                    )
                )
            if variants:
                self._chars[ch] = variants

    # ASCII記号 → 全角フォールバック (片方しか登録されていなくても表示できるように)
    ASCII_FULLWIDTH_FALLBACK = {
        "!": "！",  "?": "？",
        "(": "（",  ")": "）",
        ",": "、",  ".": "。",
        ":": "：",  ";": "；",
        "*": "＊",
        # 逆方向
        "！": "!", "？": "?",
        "（": "(", "）": ")",
        "、": ",",  "。": ".",
        "＊": "*",
    }

    def has(self, ch: str) -> bool:
        if ch in self._chars:
            return True
        alt = self.ASCII_FULLWIDTH_FALLBACK.get(ch)
        return alt is not None and alt in self._chars

    def get(self, ch: str) -> Optional[Variant]:
        vs = self._chars.get(ch)
        if not vs:
            alt = self.ASCII_FULLWIDTH_FALLBACK.get(ch)
            if alt:
                vs = self._chars.get(alt)
        return vs[0] if vs else None

    def glyph(self, ch: str) -> Optional[Glyph]:
        v = self.get(ch)
        if v is None:
            return None
        from .stroke import GlyphAnchor
        anchors = [GlyphAnchor(type=a.type, x=a.x, y=a.y) for a in v.anchors]
        return Glyph(
            char=ch,
            strokes=list(v.strokes),
            advance=v.advance,
            anchors=anchors,
            coord_space=v.coord_space,
        )

    def characters(self) -> List[str]:
        return list(self._chars.keys())


def fallback_bullet_glyph() -> Glyph:
    """辞書に '・' が無い場合のフォールバック: 小さな黒丸ストローク。"""
    # 12点で小円を描く
    import math

    cx, cy, r = 0.5, 0.5, 0.08
    pts = []
    n = 16
    for i in range(n + 1):
        t = 2 * math.pi * i / n
        pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    return Glyph(char="・", strokes=[Stroke(points=pts)], advance=0.5)


def fallback_unknown_glyph(ch: str) -> Glyph:
    """辞書未登録文字の超簡易プレースホルダ: 小さな四角を描く。"""
    pts = [
        (0.15, 0.15),
        (0.85, 0.15),
        (0.85, 0.85),
        (0.15, 0.85),
        (0.15, 0.15),
    ]
    return Glyph(char=ch, strokes=[Stroke(points=pts)], advance=1.0)
