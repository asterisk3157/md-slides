"""文字描画メトリクスのデータ集約。

これまで layout.py / formula.py にハードコードされていた配置ルール
(CHAR_METRICS, FORMULA_METRICS, ANCHOR_NUDGE, TIGHT_ADV, FALLBACK_MAP) を
1か所に集約する。目的:

1. **JSレンダラとの共有**: `export_json()` で配置ルールを JSON 化でき、ブラウザ側の
   レンダラが同じルールで描画できる (WYSIWYG の土台)。
2. **3層マージ**: 組込みデフォルト → グローバルテーマ(D1) → 文書frontmatter を
   `apply_overrides()` で重ねられる。エディタの微調整を恒久設定として書き戻す土台。

値の意味:
- rel_size : 標準文字に対する縦横サイズ比 (1.0 = フル)
- valign   : "top" | "middle" | "bottom"
- advance  : (数式モード) size に対する横送り比。None = 自動 (glyph幅 + size*0.03)
"""
from __future__ import annotations

import copy
from typing import Dict, Optional, Tuple


# ---------- 組込みデフォルト ----------

# 通常テキストの文字メトリクス {char: {"rel_size", "valign"}}
DEFAULT_CHAR_METRICS: Dict[str, Dict] = {
    # 中黒・小さな点
    "・": {"rel_size": 0.25, "valign": "middle"},
    # コロン・セミコロン (全角・半角 共通で中黒同様)
    "：": {"rel_size": 0.25, "valign": "middle"},
    "；": {"rel_size": 0.25, "valign": "middle"},
    ":":  {"rel_size": 0.25, "valign": "middle"},
    ";":  {"rel_size": 0.25, "valign": "middle"},
    # 句読点
    "、": {"rel_size": 0.35, "valign": "bottom"},
    "。": {"rel_size": 0.35, "valign": "bottom"},
    ",":  {"rel_size": 0.25, "valign": "bottom"},
    ".":  {"rel_size": 0.20, "valign": "bottom"},
    # アスタリスク (注釈・脚注用、小さめ・中央)
    "*":  {"rel_size": 0.45, "valign": "middle"},
    "＊": {"rel_size": 0.45, "valign": "middle"},
    # 感嘆・疑問 (等倍 + 後で advance を詰める)
    "!":  {"rel_size": 1.00, "valign": "top"},
    "?":  {"rel_size": 1.00, "valign": "top"},
    "！": {"rel_size": 1.00, "valign": "top"},
    "？": {"rel_size": 1.00, "valign": "top"},
    # 数学演算子
    "+":  {"rel_size": 0.55, "valign": "middle"},
    "-":  {"rel_size": 0.50, "valign": "middle"},
    "=":  {"rel_size": 0.55, "valign": "middle"},
    "×":  {"rel_size": 0.50, "valign": "middle"},
    "÷":  {"rel_size": 0.55, "valign": "middle"},
    "±":  {"rel_size": 0.55, "valign": "middle"},
    "<":  {"rel_size": 0.55, "valign": "middle"},
    ">":  {"rel_size": 0.55, "valign": "middle"},
    "≦": {"rel_size": 0.55, "valign": "middle"},
    "≧": {"rel_size": 0.55, "valign": "middle"},
    "≠": {"rel_size": 0.55, "valign": "middle"},
    "≈": {"rel_size": 0.55, "valign": "middle"},
    # 括弧類 (() [] {} は等倍。advance はインク幅基準なので細く詰まる)
    "(":  {"rel_size": 1.00, "valign": "top"},
    ")":  {"rel_size": 1.00, "valign": "top"},
    "[":  {"rel_size": 1.00, "valign": "top"},
    "]":  {"rel_size": 1.00, "valign": "top"},
    "{":  {"rel_size": 1.00, "valign": "top"},
    "}":  {"rel_size": 1.00, "valign": "top"},
    # 「」は隅付き括弧なので小さめのまま (上隅/下隅のマーク)
    "「": {"rel_size": 0.45, "valign": "top"},
    "」": {"rel_size": 0.45, "valign": "bottom"},   # 閉じ括弧は右下
    # 拗音・促音 (小書き仮名) — 通常仮名の約55%
    "ゃ": {"rel_size": 0.55, "valign": "bottom"},
    "ゅ": {"rel_size": 0.55, "valign": "bottom"},
    "ょ": {"rel_size": 0.55, "valign": "bottom"},
    "っ": {"rel_size": 0.55, "valign": "bottom"},
    "ャ": {"rel_size": 0.55, "valign": "bottom"},
    "ュ": {"rel_size": 0.55, "valign": "bottom"},
    "ョ": {"rel_size": 0.55, "valign": "bottom"},
    "ッ": {"rel_size": 0.55, "valign": "bottom"},
    "ぁ": {"rel_size": 0.55, "valign": "bottom"},
    "ぃ": {"rel_size": 0.55, "valign": "bottom"},
    "ぅ": {"rel_size": 0.55, "valign": "bottom"},
    "ぇ": {"rel_size": 0.55, "valign": "bottom"},
    "ぉ": {"rel_size": 0.55, "valign": "bottom"},
    "ァ": {"rel_size": 0.55, "valign": "bottom"},
    "ィ": {"rel_size": 0.55, "valign": "bottom"},
    "ゥ": {"rel_size": 0.55, "valign": "bottom"},
    "ェ": {"rel_size": 0.55, "valign": "bottom"},
    "ォ": {"rel_size": 0.55, "valign": "bottom"},
}

# 通常テキストの advance 詰め (旧方式)。現在 _place_chars はインク幅基準の
# advance を使うため通常は未使用。明示的に上書きしたい文字だけ残す。
DEFAULT_TIGHT_ADV: Dict[str, float] = {}

# 数式モード専用の上書き {char: {"rel_size", "valign", "advance"(任意)}}
DEFAULT_FORMULA_METRICS: Dict[str, Dict] = {
    "(": {"rel_size": 1.00, "valign": "top", "advance": 0.45},
    ")": {"rel_size": 1.00, "valign": "top", "advance": 0.45},
    "[": {"rel_size": 1.00, "valign": "top", "advance": 0.45},
    "]": {"rel_size": 1.00, "valign": "top", "advance": 0.45},
    "{": {"rel_size": 1.00, "valign": "top", "advance": 0.50},
    "}": {"rel_size": 1.00, "valign": "top", "advance": 0.50},
    "|": {"rel_size": 1.00, "valign": "top", "advance": 0.30},
    "!":  {"rel_size": 1.00, "valign": "top", "advance": 0.30},
    "！": {"rel_size": 1.00, "valign": "top", "advance": 0.35},
    "∫": {"rel_size": 1.50, "valign": "top"},
    "∑": {"rel_size": 1.50, "valign": "top"},
    "√": {"rel_size": 1.50, "valign": "top"},
    "Π": {"rel_size": 1.50, "valign": "top"},
    "∏": {"rel_size": 1.50, "valign": "top"},
}

# 記号別 sup/sub アンカー微調整 {"char|type": {"dx", "dy"}} (font_size比, dx>0=右 dy<0=上)
DEFAULT_ANCHOR_NUDGE: Dict[str, Dict] = {
    # ∫ の被積分関数 (body) の開始位置を右へ。上下限と重ならないよう余白を確保。
    "∫|body": {"dx": 0.40, "dy": 0.0},
}

# 記号別アンカー位置の上書き {"char|type": {"x", "y"}} (グリフ正規化座標 0..1)。
# グリフに登録されたアンカーを完全に置き換える。
# ∫: 登録時に sub/sup が上下逆だったため修正 (下限=下・左 / 上限=上・右)。
DEFAULT_ANCHOR_POS: Dict[str, Dict] = {
    "∫|sub": {"x": 0.35, "y": 0.78},   # 下限 → 記号の下側
    "∫|sup": {"x": 0.55, "y": 0.18},   # 上限 → 記号の上側
    # lim を単一グリフ登録した場合、登録 sub アンカー(セル下部 y≈0.82)が
    # グリフ拡大率(≈4x)で増幅され添字が大きく下へ落ちる。筆跡の真下・水平中央へ補正。
    "lim|sub": {"x": 0.265, "y": 0.61},
}

# 小書き仮名 (見出しなど use_metrics=False でも常に縮小したい文字)
SMALL_KANA = frozenset("ゃゅょっャュョッぁぃぅぇぉァィゥェォ")


def is_small_kana(ch: str) -> bool:
    return ch in SMALL_KANA


# ASCII半角 → 全角フォールバック (全角のメトリクスを優先)
DEFAULT_FALLBACK_MAP: Dict[str, str] = {
    "!": "！", "?": "？",
    "(": "（", ")": "）",
    ":": "：", ";": "；",
    "*": "＊",
}


# ---------- 上書き層 ----------

_overrides: Dict[str, Dict] = {
    "char_metrics": {},
    "tight_adv": {},
    "formula_metrics": {},
    "anchor_nudge": {},
    "anchor_pos": {},
}


def apply_overrides(data: Dict) -> None:
    """テーマ/辞書からの上書きを重ねる (キー単位の shallow マージ)。

    data 例:
        {"char_metrics": {"・": {"rel_size": 0.3, "valign": "top"}},
         "anchor_nudge": {"∑|sup": {"dx": 0.1, "dy": -0.1}}}
    """
    if not isinstance(data, dict):
        return
    for group in ("char_metrics", "tight_adv", "formula_metrics", "anchor_nudge", "anchor_pos"):
        if group in data and isinstance(data[group], dict):
            _overrides[group].update(data[group])


def reset_overrides() -> None:
    for g in _overrides:
        _overrides[g] = {}


def _merged(group: str, defaults: Dict) -> Dict:
    out = dict(defaults)
    out.update(_overrides.get(group, {}))
    return out


# ---------- アクセサ (layout.py / formula.py が使う) ----------

def char_metrics(ch: str) -> Tuple[float, str]:
    """文字 → (rel_size, valign)。未登録は (1.0, 'top')。

    ASCII↔全角フォールバック対象は全角のメトリクスを優先。
    """
    cm = _merged("char_metrics", DEFAULT_CHAR_METRICS)
    alt = DEFAULT_FALLBACK_MAP.get(ch)
    if alt and alt in cm:
        m = cm[alt]
        return (m["rel_size"], m["valign"])
    if ch in cm:
        m = cm[ch]
        return (m["rel_size"], m["valign"])
    return (1.0, "top")


def tight_adv(ch: str) -> Optional[float]:
    """細い記号の advance 詰め比。無ければ None。"""
    return _merged("tight_adv", DEFAULT_TIGHT_ADV).get(ch)


def formula_metrics(ch: str) -> Tuple[float, str, Optional[float]]:
    """数式モード優先のメトリクス。(rel_size, valign, advance or None)。"""
    fm = _merged("formula_metrics", DEFAULT_FORMULA_METRICS)
    if ch in fm:
        m = fm[ch]
        return (m["rel_size"], m["valign"], m.get("advance"))
    rs, va = char_metrics(ch)
    return (rs, va, None)


def anchor_nudge(char: str, anchor_type: str) -> Tuple[float, float]:
    """記号別 sup/sub アンカー微調整 (dx, dy)。無ければ (0, 0)。"""
    an = _merged("anchor_nudge", DEFAULT_ANCHOR_NUDGE)
    m = an.get(f"{char}|{anchor_type}")
    if m:
        return (m.get("dx", 0.0), m.get("dy", 0.0))
    return (0.0, 0.0)


def anchor_pos(char: str, anchor_type: str) -> Optional[Tuple[float, float]]:
    """記号別アンカー位置の上書き (x, y) (グリフ正規化 0..1)。無ければ None。"""
    ap = _merged("anchor_pos", DEFAULT_ANCHOR_POS)
    m = ap.get(f"{char}|{anchor_type}")
    if m:
        return (m.get("x", 0.0), m.get("y", 0.0))
    return None


def export_json() -> Dict:
    """マージ後の全配置ルールを JSON 化 (JSレンダラ共有用)。"""
    return {
        "char_metrics": _merged("char_metrics", DEFAULT_CHAR_METRICS),
        "tight_adv": _merged("tight_adv", DEFAULT_TIGHT_ADV),
        "formula_metrics": _merged("formula_metrics", DEFAULT_FORMULA_METRICS),
        "anchor_nudge": _merged("anchor_nudge", DEFAULT_ANCHOR_NUDGE),
        "anchor_pos": _merged("anchor_pos", DEFAULT_ANCHOR_POS),
        "fallback_map": dict(DEFAULT_FALLBACK_MAP),
    }
