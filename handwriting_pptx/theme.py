"""装飾テーマ (styles)。

`<span class="key">` のような意味ロールを、色・太さに解決する。
3層マージ: 組込みデフォルト → グローバルテーマ(D1) → 文書frontmatter。

styles の値:
    { "color": "<パレット名 or #RRGGBB>", "bold": <bool> }

詳細は docs/design_decisions.md §4-5。
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Dict, Optional


# 名前付きパレット (色名 → hex)。styles の color はこの名前か #RRGGBB を取る。
PALETTE: Dict[str, str] = {
    "black": "#000000",
    "red":   "#cc0000",
    "blue":  "#0040cc",
    "green": "#0a7a3a",
    "gray":  "#888888",
    "grey":  "#888888",
    "orange": "#e07000",
    "purple": "#7a3aa0",
}

# CSS 標準名前付きカラー (Color Module Level 4)。PALETTE に無い名前のフォールバック。
# JS dict_app/public/js/render/theme.js の CSS_COLORS と完全一致させること。
CSS_COLORS: Dict[str, str] = {
    "aliceblue":"#F0F8FF","antiquewhite":"#FAEBD7","aqua":"#00FFFF","aquamarine":"#7FFFD4","azure":"#F0FFFF",
    "beige":"#F5F5DC","bisque":"#FFE4C4","black":"#000000","blanchedalmond":"#FFEBCD","blue":"#0000FF",
    "blueviolet":"#8A2BE2","brown":"#A52A2A","burlywood":"#DEB887","cadetblue":"#5F9EA0","chartreuse":"#7FFF00",
    "chocolate":"#D2691E","coral":"#FF7F50","cornflowerblue":"#6495ED","cornsilk":"#FFF8DC","crimson":"#DC143C",
    "cyan":"#00FFFF","darkblue":"#00008B","darkcyan":"#008B8B","darkgoldenrod":"#B8860B","darkgray":"#A9A9A9",
    "darkgreen":"#006400","darkgrey":"#A9A9A9","darkkhaki":"#BDB76B","darkmagenta":"#8B008B","darkolivegreen":"#556B2F",
    "darkorange":"#FF8C00","darkorchid":"#9932CC","darkred":"#8B0000","darksalmon":"#E9967A","darkseagreen":"#8FBC8F",
    "darkslateblue":"#483D8B","darkslategray":"#2F4F4F","darkslategrey":"#2F4F4F","darkturquoise":"#00CED1","darkviolet":"#9400D3",
    "deeppink":"#FF1493","deepskyblue":"#00BFFF","dimgray":"#696969","dimgrey":"#696969","dodgerblue":"#1E90FF",
    "firebrick":"#B22222","floralwhite":"#FFFAF0","forestgreen":"#228B22","fuchsia":"#FF00FF","gainsboro":"#DCDCDC",
    "ghostwhite":"#F8F8FF","gold":"#FFD700","goldenrod":"#DAA520","gray":"#808080","green":"#008000",
    "greenyellow":"#ADFF2F","grey":"#808080","honeydew":"#F0FFF0","hotpink":"#FF69B4","indianred":"#CD5C5C",
    "indigo":"#4B0082","ivory":"#FFFFF0","khaki":"#F0E68C","lavender":"#E6E6FA","lavenderblush":"#FFF0F5",
    "lawngreen":"#7CFC00","lemonchiffon":"#FFFACD","lightblue":"#ADD8E6","lightcoral":"#F08080","lightcyan":"#E0FFFF",
    "lightgoldenrodyellow":"#FAFAD2","lightgray":"#D3D3D3","lightgreen":"#90EE90","lightgrey":"#D3D3D3","lightpink":"#FFB6C1",
    "lightsalmon":"#FFA07A","lightseagreen":"#20B2AA","lightskyblue":"#87CEFA","lightslategray":"#778899","lightslategrey":"#778899",
    "lightsteelblue":"#B0C4DE","lightyellow":"#FFFFE0","lime":"#00FF00","limegreen":"#32CD32","linen":"#FAF0E6",
    "magenta":"#FF00FF","maroon":"#800000","mediumaquamarine":"#66CDAA","mediumblue":"#0000CD","mediumorchid":"#BA55D3",
    "mediumpurple":"#9370DB","mediumseagreen":"#3CB371","mediumslateblue":"#7B68EE","mediumspringgreen":"#00FA9A","mediumturquoise":"#48D1CC",
    "mediumvioletred":"#C71585","midnightblue":"#191970","mintcream":"#F5FFFA","mistyrose":"#FFE4E1","moccasin":"#FFE4B5",
    "navajowhite":"#FFDEAD","navy":"#000080","oldlace":"#FDF5E6","olive":"#808000","olivedrab":"#6B8E23",
    "orange":"#FFA500","orangered":"#FF4500","orchid":"#DA70D6","palegoldenrod":"#EEE8AA","palegreen":"#98FB98",
    "paleturquoise":"#AFEEEE","palevioletred":"#DB7093","papayawhip":"#FFEFD5","peachpuff":"#FFDAB9","peru":"#CD853F",
    "pink":"#FFC0CB","plum":"#DDA0DD","powderblue":"#B0E0E6","purple":"#800080","rebeccapurple":"#663399",
    "red":"#FF0000","rosybrown":"#BC8F8F","royalblue":"#4169E1","saddlebrown":"#8B4513","salmon":"#FA8072",
    "sandybrown":"#F4A460","seagreen":"#2E8B57","seashell":"#FFF5EE","sienna":"#A0522D","silver":"#C0C0C0",
    "skyblue":"#87CEEB","slateblue":"#6A5ACD","slategray":"#708090","slategrey":"#708090","snow":"#FFFAFA",
    "springgreen":"#00FF7F","steelblue":"#4682B4","tan":"#D2B48C","teal":"#008080","thistle":"#D8BFD8",
    "tomato":"#FF6347","turquoise":"#40E0D0","violet":"#EE82EE","wheat":"#F5DEB3","white":"#FFFFFF",
    "whitesmoke":"#F5F5F5","yellow":"#FFFF00","yellowgreen":"#9ACD32",
}

# 組込みデフォルトの意味ロール
DEFAULT_STYLES: Dict[str, Dict] = {
    "key":  {"color": "red",  "bold": True},   # 重要・キーワード
    "note": {"color": "blue"},                 # 補足・注釈
    "weak": {"color": "gray"},                 # 控えめ
}

# クラス名に使えない予約語 (太字/斜体は ** / * が担当)
RESERVED_CLASSES = {"strong", "em", "b", "i"}

_HEX6_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_HEX3_RE = re.compile(r"^#[0-9a-fA-F]{3}$")
_RGB_RE = re.compile(r"^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$", re.IGNORECASE)


def _clamp255(n: int) -> int:
    return max(0, min(255, n))


def resolve_color(value: Optional[str]) -> Optional[str]:
    """color を #RRGGBB に解決。対応: #rgb / #rrggbb / rgb()/rgba() / パレット名 / CSS標準色名。"""
    if not value or not isinstance(value, str):
        return None
    v = value.strip()
    if _HEX6_RE.match(v):
        return v.upper()
    if _HEX3_RE.match(v):
        h = v[1:]
        return ("#" + h[0]*2 + h[1]*2 + h[2]*2).upper()
    rgb = _RGB_RE.match(v)
    if rgb:
        return "#{:02X}{:02X}{:02X}".format(_clamp255(int(rgb.group(1))), _clamp255(int(rgb.group(2))), _clamp255(int(rgb.group(3))))
    key = v.lower()
    if key in PALETTE:          # 手書き向け調整色を優先
        return PALETTE[key].upper()
    if key in CSS_COLORS:       # CSS標準色名
        return CSS_COLORS[key]
    return None


def merge_styles(*layers: Optional[Dict]) -> Dict[str, Dict]:
    """styles を後勝ちでマージ。layers は (組込み, グローバル, 文書) の順で渡す。"""
    out: Dict[str, Dict] = {}
    for layer in layers:
        if not layer:
            continue
        for name, spec in layer.items():
            if name in RESERVED_CLASSES:
                continue
            if isinstance(spec, dict):
                out[name] = dict(spec)
    return out


def build_styles(doc_styles: Optional[Dict] = None,
                 global_styles: Optional[Dict] = None) -> Dict[str, Dict]:
    """3層マージ済み styles を返す。"""
    return merge_styles(DEFAULT_STYLES, global_styles, doc_styles)


class StyleError(ValueError):
    """未定義クラス参照などの装飾エラー。"""


def load_theme_from_path(path) -> Dict:
    """dict.json (= /api/export のキャッシュ) から theme フィールドを読む。

    戻り値: {"styles": {...}, "metrics": {...}}。無ければ {}。
    """
    try:
        p = Path(path)
        if not p.exists():
            return {}
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    theme = data.get("theme")
    return theme if isinstance(theme, dict) else {}


def apply_theme(path) -> Dict[str, Dict]:
    """dict.json の theme を読み込み、配置metricsを適用してグローバルstylesを返す。

    - theme["metrics"] → metrics.apply_overrides (配置ルール上書き)
    - theme["styles"]  → 戻り値 (Presentation.set_styles の global_styles に渡す)
    """
    th = load_theme_from_path(path)
    metrics_ov = th.get("metrics")
    if isinstance(metrics_ov, dict):
        from . import metrics as _metrics
        _metrics.apply_overrides(metrics_ov)
    styles = th.get("styles")
    return styles if isinstance(styles, dict) else {}


def resolve_class(class_name: str, styles: Dict[str, Dict]) -> Dict:
    """クラス名 → {"color": hex or None, "bold": bool}。

    未定義クラスは StyleError。複数クラス (空白区切り) も許可し、後勝ちでマージ。
    """
    result: Dict = {"color": None, "bold": False}
    for cls in class_name.split():
        if cls in RESERVED_CLASSES:
            # strong/em 相当はスパンでは扱わない (** / * を使う)
            continue
        if cls not in styles:
            raise StyleError(f"未定義の装飾クラス: '{cls}'")
        spec = styles[cls]
        col = resolve_color(spec.get("color"))
        if col is not None:
            result["color"] = col
        if spec.get("bold"):
            result["bold"] = True
    return result
