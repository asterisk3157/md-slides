"""数式組版エンジン (L3)。

入力記法 (Word linear math 風):
- atom: 1文字 (例: "x", "1", "+", "∫")
- ^expr: 直前のatomに上付き
- _expr: 直前のatomに下付き
- {...}: グループ化 (複数文字を1つの中身として扱う)
- \name: 名前付き記号 (例: \int=∫, \sum=∑, \sqrt=√, \pi=π)

例:
  "x^2"             → x の右上に小さく 2
  "a_n"             → a の右下に小さく n
  "x^2_n"           → x の右上に 2、右下に n
  "(x+1)^2"         → (, x, +, 1, ) の連続 + ) の右上に 2 ※グループ要らない場合
  "{x+1}^2"         → グループ化して右上に 2
  "\\int_0^1 f(x)"   → ∫ の sub=0, sup=1、続いて f, (, x, )
  "\\sum_{n=1}^N"    → ∑ の sub=n=1, sup=N
  "\\sqrt{x+1}"      → √ の arg=(x+1) （※√のarg配置は将来 future_root_extension）

配置:
  base 文字を size でスケール → アンカー位置 (anchors[type]) を物理座標化
  → sub/sup の中身をその位置を中心に小さく (sub/sup_scale=0.55) 配置
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from .dict_loader import Dictionary, fallback_unknown_glyph
from .inkml import PlacedStroke, stroke_to_placed
from .stroke import Glyph


# 名前付き記号 (LaTeX風)
LATEX_MAP = {
    "int":   "∫",
    "sum":   "∑",
    "sqrt":  "√",
    "pi":    "π",
    "theta": "θ",
    "alpha": "α",
    "beta":  "β",
    "gamma": "γ",
    "lambda":"λ",
    "mu":    "μ",
    "sigma": "σ",
    "phi":   "φ",
    "omega": "ω",
    "infty": "∞",
    "leq":   "≦",
    "geq":   "≧",
    "neq":   "≠",
    "approx":"≈",
    "pm":    "±",
    "times": "×",
    "div":   "÷",
    "sim":   "〜",   # 範囲 (i)〜(iii) などに使う波ダッシュ
    "equiv": "≡",
    "propto":"∝",
    # 矢印・関係記号 (関数記法・極限などで使用)
    "to":            "→",
    "rightarrow":    "→",
    "leftarrow":     "←",
    "Rightarrow":    "⇒",
    "Leftrightarrow":"⇔",
    "cdot":          "・",
    # 省略記号 (1つの手書きグリフとして登録: 細い3点を本人の筆跡で)
    "cdots":         "⋯",
    "ldots":         "…",
    "dots":          "…",
    # 増減表の矢印 (右上=増加, 右下=減少)
    "nearrow":       "↗",
    "searrow":       "↘",
    "nwarrow":       "↖",
    "swarrow":       "↙",
    # 論理・証明
    "therefore":     "∴",   # ゆえに (thus)
    "because":       "∵",   # なぜなら (because)
    "qed":           "□",   # 証明終了
    "square":        "□",
    "blacksquare":   "∎",   # 証明終了 (黒四角)
    "Box":           "□",
}


# 関数名 (合字として扱うもの)
# パース時、\name が FUNCTION_NAMES に含まれていれば
# Expr(base="", fn_name=name) として扱う。
FUNCTION_NAMES = {
    "sin", "cos", "tan",
    "log", "ln", "exp", "lim",
    "arcsin", "arccos", "arctan",
    "sinh", "cosh", "tanh",
}

# 増減表(2回微分)用カーブ矢印。手書き登録不要の手続き描画。
# 増加/減少 × 下に凸(∪)/上に凸(∩) の4種。
CURVE_KINDS = {
    "incurveup": "incUp", "incurvedown": "incDown",
    "decurveup": "decUp", "decurvedown": "decDown",
}
CURVE_W = 0.85
CURVE_H = 0.90


@dataclass
class Expr:
    """1つの数式ノード (atom = 1文字、修飾子で sub/sup/arg を持つ)。

    base: 基底文字 (1文字)。グループの場合は空でchildrenを持つ
    children: グループの中身 (base=="" のときに使用)
    sub: 下添字の中身 (任意)
    sup: 上添字の中身 (任意)
    arg: arg (本体引数、∫の被積分関数や√の被開数等、任意)
    frac: 分数 (numerator, denominator) のタプル。指定時は base/children は無視
    """
    base: str = ""
    children: Optional[List["Expr"]] = None
    sub: Optional[List["Expr"]] = None
    sup: Optional[List["Expr"]] = None
    arg: Optional[List["Expr"]] = None
    frac: Optional[Tuple[List["Expr"], List["Expr"]]] = None
    # 関数名 (\sin, \cos, \lim 等)。指定時は base/children は無視され、
    # fn_name の各文字を 1 atom 扱いで詰めて配置する。
    fn_name: Optional[str] = None
    # ベクトル \vec{...}: 中身を配置し、上に矢印を描画。
    # 指定時は base/children は無視。
    vec: Optional[List["Expr"]] = None
    # 増減表(2回微分)用カーブ矢印。incUp/incDown/decUp/decDown。
    curve: Optional[str] = None


# ---------- パーサ ----------

class _Parser:
    def __init__(self, src: str):
        self.s = src
        self.i = 0

    def peek(self) -> str:
        return self.s[self.i] if self.i < len(self.s) else ""

    def consume(self) -> str:
        c = self.peek()
        self.i += 1
        return c

    def parse_sequence(self, end_chars: str = "") -> List[Expr]:
        items: List[Expr] = []
        while self.i < len(self.s):
            c = self.peek()
            # Pythonでは "" in "abc" が True なので、c非空を明示
            if c and end_chars and c in end_chars:
                break
            atom = self._parse_atom()
            if atom is None:
                # スキップ (進めないと無限ループ)
                self.consume()
                continue
            # 修飾子 ^ / _ を貪欲に取る (peekが非空かつ ^_ のときのみ)
            while True:
                p = self.peek()
                if not p or p not in "^_":
                    break
                op = self.consume()
                modifier_content = self._parse_modifier_arg()
                if op == "^":
                    atom.sup = modifier_content
                else:
                    atom.sub = modifier_content
            items.append(atom)
        return items

    def _parse_atom(self) -> Optional[Expr]:
        c = self.peek()
        if not c:
            return None
        if c == "{":
            self.consume()
            children = self.parse_sequence(end_chars="}")
            if self.peek() == "}":
                self.consume()
            return Expr(base="", children=children)
        if c == "\\":
            # \name または \\ 自身
            self.consume()
            m = re.match(r"[a-zA-Z]+", self.s[self.i:])
            if m:
                name = m.group(0)
                self.i += len(name)
                # \frac{num}{denom} は特別: 続く2つのグループを取って frac へ
                if name == "frac":
                    num = self._parse_modifier_arg()
                    denom = self._parse_modifier_arg()
                    return Expr(base="", frac=(num, denom))
                # \sqrt[n]{radicand} または \sqrt{radicand}
                if name == "sqrt":
                    index = None
                    if self.peek() == "[":
                        self.consume()
                        index = self.parse_sequence(end_chars="]")
                        if self.peek() == "]":
                            self.consume()
                    radicand = self._parse_modifier_arg()
                    expr = Expr(base="√", arg=radicand)
                    if index is not None:
                        expr.sup = index   # n乗根指数として sup アンカーへ
                    return expr
                # \vec{...}: 中身を保持し配置時に上に矢印
                if name == "vec":
                    content = self._parse_modifier_arg()
                    return Expr(base="", vec=content)
                # 増減表カーブ矢印
                if name in CURVE_KINDS:
                    return Expr(base="", curve=CURVE_KINDS[name])
                # 関数名 (\sin, \cos, \lim 等)
                if name in FUNCTION_NAMES:
                    return Expr(base="", fn_name=name)
                sym = LATEX_MAP.get(name, "")
                if sym:
                    return Expr(base=sym)
                # 未知の名前: 誤った文字を出さないよう空 atom (advanceのみ) にする
                return Expr(base="")
            # \ で始まるけど名前無し → そのまま無視
            return None
        if c in " \t\n":
            self.consume()
            # 空白も atom として扱う (advance を持つ)
            return Expr(base=" ")
        # 普通の1文字
        return Expr(base=self.consume())

    def _parse_modifier_arg(self) -> List[Expr]:
        """^ や _ の直後の中身を1つだけ取り出す。

        {grp} ならグループ、それ以外なら1 atom。
        """
        c = self.peek()
        if c == "{":
            self.consume()
            items = self.parse_sequence(end_chars="}")
            if self.peek() == "}":
                self.consume()
            return items
        atom = self._parse_atom()
        return [atom] if atom else []


_PRIME_CHARS = {"'", '"', "’", "”", "′", "″"}


def _merge_primes_into_sup(exprs: List[Expr]) -> List[Expr]:
    """`letter '` を `letter.sup = ['] と統合。f'(x), f''(x) 用。

    ' 自身が sub/sup を持つ場合は変換しない。
    """
    out: List[Expr] = []
    i = 0
    n = len(exprs)
    while i < n:
        e = exprs[i]
        if e.base and len(e.base) == 1 and e.base.isalpha():
            primes: List[Expr] = []
            j = i + 1
            while j < n and exprs[j].base in _PRIME_CHARS \
                    and exprs[j].sub is None and exprs[j].sup is None:
                primes.append(exprs[j])
                j += 1
            if primes:
                existing = e.sup or []
                e.sup = primes + existing
                out.append(e)
                i = j
                continue
        out.append(e)
        i += 1
    return out


def parse_formula(src: str) -> List[Expr]:
    """文字列を Expr 列にパース。

    `letter '` 系の微分表記を sup に統合する後処理を含む。
    """
    exprs = _Parser(src).parse_sequence()
    return _merge_primes_into_sup(exprs)


# ---------- 配置 ----------

# サイズと位置
SUB_SUP_SCALE = 0.32       # 添字スケール (base の何倍) — 小さめが綺麗
# sup/sub の中心 y を base 上端からどれだけ離すか (size比)
# 負値 = base より上に浮く / > 1.0 = base より下に沈む
SUP_CENTER_Y = 0.05        # sup 中心は base 上端のすぐ下 → sup は半分以上 base 上に浮く
SUB_CENTER_Y = 0.95        # sub 中心は base 下端のすぐ上 → sub は半分以上 base 下に沈む
SUB_SUP_X_OFFSET = 0.08    # sup/sub を base 右端から右にずらす比 (font_size比)
# 記号別 sup/sub アンカー微調整は metrics.anchor_nudge() に集約 (データ化済み)。
ARG_SCALE = 1.0            # arg (∫の被積分関数等) のスケール
BODY_LEFT_SHIFT = 0.90     # body アンカーを左へずらす量 (font_size 比) — 被積分関数/総和項を記号に寄せる
SQRT_BODY_LEFT_SHIFT = 0.50  # √ は radicand が見えなくならない程度の控えめ寄せ
# 関数名 (\sin, \cos 等)
FN_CHAR_ADVANCE = 0.50     # 関数名の各文字の advance (font_size 比) — 詰めて配置
FN_TRAIL_GAP    = 0.05     # 関数名の実インク右端と引数の隙間 (font_size 比)
LIM_SUB_SCALE   = 0.50     # \lim の下添字は通常 sub より大きく
LIM_SUB_VGAP    = 0.0      # \lim 下端と sub 上端の縦余白 (font_size 比, 負にすると文字に重なる)
# ベクトル \vec{...}
VEC_GAP            = 0.16  # 文字 top と矢印 y の間隔 (font_size 比) — 大きいほど矢印が上
VEC_HEAD_LEN       = 0.18  # 矢頭の長さ (font_size 比)
VEC_HEAD_HALFWIDTH = 0.07  # 矢頭の半幅 (font_size 比)
VEC_MARGIN         = 0.05  # 矢印水平線の左右余白 (font_size 比)
# 1.0 を超える rel_size の記号 (∫ ∑ √ 等) を縦中央付近に持ち上げる比率。
# 0 = そのまま下方向にはみ出す / 1.0 = 完全に中央揃え (上下に均等にはみ出す)
SYMBOL_VCENTER_RATIO = 0.6

# 配置ルールは metrics.py に集約。数式メトリクス・アンカー微調整をここから使う。
from .metrics import formula_metrics as _formula_metrics, anchor_nudge, anchor_pos


def _strokes_bbox(strokes: List[PlacedStroke]) -> Tuple[float, float, float, float]:
    """配置済みストロークのbbox (x_min, y_min, x_max, y_max)。空ならゼロ。"""
    xs: List[float] = []
    ys: List[float] = []
    for s in strokes:
        for (x, y) in s.points_cm:
            xs.append(x)
            ys.append(y)
    if not xs:
        return 0.0, 0.0, 0.0, 0.0
    return min(xs), min(ys), max(xs), max(ys)


def _place_atom(e: Expr, x: float, y: float, size: float,
                dictionary: Dictionary) -> Tuple[List[PlacedStroke], float, Glyph]:
    """単一atom (Expr.base) を配置。

    Returns: (placed_strokes, advance_x_cm, glyph_used)
    advance は cursor をどれだけ進めるか。
    """
    placed: List[PlacedStroke] = []
    if e.base == " ":
        return placed, size * 0.20, Glyph(char=" ")
    if e.base == "　":
        return placed, size * 0.45, Glyph(char=" ")
    if e.base == "":
        # 空 atom (未知コマンド等): 余計な隙間を作らないよう advance 0
        return placed, 0.0, Glyph(char="")

    g = dictionary.glyph(e.base)
    if g is None:
        g = fallback_unknown_glyph(e.base)

    # em 字を数式で使う場合の扱い:
    #  - 英字 (A-Za-z): 大文字小文字のサイズを揃えるため高さを size に正規化。
    #  - 記号 (+, =, < 等): 描いた占有比率・位置のまま (size基準・cap=y/baseline=y+size)。
    if g.coord_space == "em":
        xs = [p[0] for s in g.strokes for p in s.points]
        ys = [p[1] for s in g.strokes for p in s.points]
        if not xs:
            g._placed_size = size
            g._placed_y_offset = 0.0
            return placed, size * 0.3, g
        xmin, xmax = min(xs), max(xs)
        import re as _re
        if _re.match(r"[A-Za-z]", e.base or ""):
            ymin, ymax = min(ys), max(ys)
            sc = size / max(ymax - ymin, 1e-6)
            x_off = x - xmin * sc
            y_off = y - ymin * sc
            for s in g.strokes:
                placed.append(stroke_to_placed(s, (x_off, y_off), sc))
            g._placed_size = size
            g._placed_y_offset = 0.0
            return placed, (xmax - xmin) * sc + size * 0.05, g
        x_off = x - xmin * size
        for s in g.strokes:
            placed.append(stroke_to_placed(s, (x_off, y), size))
        g._placed_size = size
        g._placed_y_offset = 0.0
        return placed, (xmax - xmin) * size + size * 0.05, g

    rel_size, valign, adv_factor = _formula_metrics(e.base)
    glyph_size = size * rel_size

    if g.coord_space == "canvas":
        # canvas 空間: ストロークだけの bbox を計算し、その高さが
        # size * rel_size になるよう scale。アンカーは strokes と同じ scale で
        # 配置され、stroke bbox の外側に来ても可 (∑ の sup/sub などは
        # ガイド上 stroke 範囲の外に配置されている = 数学的に正しい)。
        stroke_pts = []
        for s in g.strokes:
            stroke_pts.extend(s.points)
        if not stroke_pts:
            advance = glyph_size
            x_offset = 0.0
            y_offset = 0.0
        else:
            sx_min = min(p[0] for p in stroke_pts)
            sx_max = max(p[0] for p in stroke_pts)
            sy_min = min(p[1] for p in stroke_pts)
            sy_max = max(p[1] for p in stroke_pts)
            bb_h = max(sy_max - sy_min, 1e-6)
            scale = (size * rel_size) / bb_h
            # rel_size > 1 のとき symbol を上方向に引き上げる
            # (rel_size-1)*size 分はみ出し、その SYMBOL_VCENTER_RATIO 分だけ上に
            overflow = max(0.0, (rel_size - 1.0) * size)
            vshift = overflow * SYMBOL_VCENTER_RATIO
            x_offset = x - sx_min * scale
            y_offset = y - sy_min * scale - vshift
            for s in g.strokes:
                placed.append(stroke_to_placed(s, (x_offset, y_offset), scale))
            if adv_factor is not None:
                advance = size * adv_factor
            else:
                advance = (sx_max - sx_min) * scale + size * 0.05
            # アンカー解決用 (同じ scale + offset を使う)
            g._placed_scale = scale            # type: ignore[attr-defined]
            g._placed_canvas_x_off = x_offset  # type: ignore[attr-defined]
            g._placed_canvas_y_off = y_offset  # type: ignore[attr-defined]
    else:
        # bbox 空間 (既存挙動)
        if valign == "middle":
            y_offset = (size - glyph_size) / 2
        elif valign == "bottom":
            y_offset = size - glyph_size
        else:
            y_offset = 0.0

        if adv_factor is not None:
            advance = size * adv_factor
        else:
            advance = glyph_size + size * 0.03

        # 狭い文字を advance 中央へ揃え
        x_offset = 0.0
        if adv_factor is not None and g.strokes:
            norm_xs = [p[0] for s in g.strokes for p in s.points]
            if norm_xs:
                norm_cx = (min(norm_xs) + max(norm_xs)) / 2
                target_cx = advance / 2
                x_offset = target_cx - norm_cx * glyph_size

        for s in g.strokes:
            placed.append(stroke_to_placed(s, (x + x_offset, y + y_offset), glyph_size))
    # アンカー情報を Glyph に保持して返す (呼び出し側でsub/sup配置に使う)
    # ただし glyph_size と y_offset の情報も必要 → 別途返す
    g._placed_size = glyph_size       # type: ignore[attr-defined]
    g._placed_y_offset = y_offset     # type: ignore[attr-defined]
    return placed, advance, g


def _anchor_world(g: Glyph, anchor_type: str, base_x: float, base_y: float) -> Optional[Tuple[float, float]]:
    """アンカー型から世界座標(cm)を返す。無ければNone。

    coord_space="canvas" のときは _placed_scale + canvas_x_off/y_off を使う。
    coord_space="bbox" のときは _placed_size + y_offset を使う (既存)。
    """
    # metrics によるアンカー位置の上書き (登録時の sub/sup 逆転などをデータで修正)
    ov = anchor_pos(g.char, anchor_type)
    if g.coord_space == "canvas":
        scale = getattr(g, "_placed_scale", 0.0)
        x_off = getattr(g, "_placed_canvas_x_off", base_x)
        y_off = getattr(g, "_placed_canvas_y_off", base_y)
        if ov is not None:
            return (x_off + ov[0] * scale, y_off + ov[1] * scale)
        for a in g.anchors:
            if a.type == anchor_type:
                return (x_off + a.x * scale, y_off + a.y * scale)
        return None
    # bbox 空間 (既存)
    glyph_size = getattr(g, "_placed_size", 0.0)
    y_off = getattr(g, "_placed_y_offset", 0.0)
    if ov is not None:
        return (base_x + ov[0] * glyph_size, base_y + y_off + ov[1] * glyph_size)
    for a in g.anchors:
        if a.type == anchor_type:
            return (base_x + a.x * glyph_size, base_y + y_off + a.y * glyph_size)
    return None


def _place_centered(exprs: List[Expr], center_x: float, center_y: float,
                    size: float, dictionary: Dictionary,
                    left_align: bool = False) -> Tuple[List[PlacedStroke], Tuple[float, float, float, float]]:
    """式列を「中心点」基準で配置。中心 = (center_x, center_y) に内容のbboxの中心が合う。
    left_align=True なら水平中央でなく「左端を center_x に合わせる」(複数文字の指数/添字用)。

    Returns: (placed_strokes, bbox)
    """
    # まず仮原点 (0, 0) に配置して幅と高さを測る
    tmp_x = 0.0
    tmp_y = 0.0
    tmp_placed: List[PlacedStroke] = []
    cursor = tmp_x
    for e in exprs:
        ps, w = _place_expr(e, cursor, tmp_y, size, dictionary)
        tmp_placed.extend(ps)
        cursor += w
    x_min, y_min, x_max, y_max = _strokes_bbox(tmp_placed)
    # 中心 or 左端へオフセット
    dx = (center_x - x_min) if left_align else (center_x - (x_min + x_max) / 2)
    dy = center_y - (y_min + y_max) / 2
    shifted: List[PlacedStroke] = []
    for s in tmp_placed:
        new_points = [(px + dx, py + dy) for (px, py) in s.points_cm]
        shifted.append(PlacedStroke(points_cm=new_points, pressures=list(s.pressures or [])))
    return shifted, (x_min + dx, y_min + dy, x_max + dx, y_max + dy)


def _place_function(e: Expr, x: float, y: float, size: float,
                    dictionary: Dictionary) -> Tuple[List[PlacedStroke], float]:
    """関数名 (\\sin, \\cos, \\lim 等) を配置。

    - fn_name の各文字を等しい advance (FN_CHAR_ADVANCE * size) で詰めて並べる
    - 末尾に FN_TRAIL_GAP * size の空白
    - e.sup があれば 関数名右肩へ通常の上付き配置 (`\\sin^{-1} x` など)
    - e.sub があれば:
        - fn_name == "lim" なら関数名の真下に中サイズで sub 配置
        - それ以外 (\\log_{10} 等) は通常の右下 sub 配置
    """
    placed: List[PlacedStroke] = []
    name = e.fn_name or ""

    # ★ 関数名そのものが辞書に手書き登録されていれば、∑/∫ と同様に
    #   単一グリフ(canvas空間+anchor)として配置する。登録が無ければ
    #   従来どおり 1 文字ずつ合成 (フォールバック)。
    if name and dictionary.has(name):
        atom = Expr(base=name, sub=e.sub, sup=e.sup, arg=e.arg)
        return _place_expr(atom, x, y, size, dictionary)

    cursor = x
    glyph_size = size
    name_start = len(placed)
    for ch in name:
        g = dictionary.glyph(ch)
        if g is None:
            g = fallback_unknown_glyph(ch)
        # 固定 advance + 中央寄せ (元の詰め配置)
        advance = size * FN_CHAR_ADVANCE
        if g.strokes:
            norm_xs = [p[0] for s in g.strokes for p in s.points]
            x_offset = 0.0
            if norm_xs:
                norm_cx = (min(norm_xs) + max(norm_xs)) / 2
                x_offset = advance / 2 - norm_cx * glyph_size
            for s in g.strokes:
                placed.append(stroke_to_placed(s, (cursor + x_offset, y), glyph_size))
        cursor += advance
    # 固定advanceは視覚幅を過小評価する(n,m 等が広い)。実インク右端を基準に
    # 引数/添字を置き、引数が名前末尾に重ならないようにする。
    name_ink_right = cursor
    for k in range(name_start, len(placed)):
        for p in placed[k].points_cm:
            if p[0] > name_ink_right:
                name_ink_right = p[0]
    cursor = name_ink_right + size * FN_TRAIL_GAP
    name_right = name_ink_right
    name_left = x
    name_cx = (name_left + name_right) / 2

    # 上付き (\sin^{-1} x など)
    if e.sup:
        sup_size = size * SUB_SUP_SCALE
        cx = name_right + size * SUB_SUP_X_OFFSET
        cy = y + size * SUP_CENTER_Y
        sup_placed, sup_bbox = _place_centered(e.sup, cx, cy, sup_size, dictionary, len(e.sup) > 1)
        placed.extend(sup_placed)
        cursor = max(cursor, sup_bbox[2] + size * 0.03)

    # 下付き
    if e.sub:
        if name == "lim":
            # lim の真下に中サイズで配置
            lim_sub_size = size * LIM_SUB_SCALE
            # 中身を測ってからセンタリング
            sub_placed, sub_w, sub_h = _layout_sequence_origin(e.sub, lim_sub_size, dictionary)
            target_y = y + size + size * LIM_SUB_VGAP
            target_x = name_cx - sub_w / 2
            if sub_placed:
                sx_min = min(p[0] for s in sub_placed for p in s.points_cm)
                sy_min = min(p[1] for s in sub_placed for p in s.points_cm)
                shifted = _shift_strokes(sub_placed, target_x - sx_min, target_y - sy_min)
                placed.extend(shifted)
                # 下付き(x→0等)は真下に置くだけ。後続は名前幅基準で続けて左に詰める
                # (下付きが幅広でも右に押し出さない。下に潜り込んでOK)。
        else:
            sub_size = size * SUB_SUP_SCALE
            cx = name_right + size * SUB_SUP_X_OFFSET
            cy = y + size * SUB_CENTER_Y
            sub_placed, sub_bbox = _place_centered(e.sub, cx, cy, sub_size, dictionary, len(e.sub) > 1)
            placed.extend(sub_placed)
            cursor = max(cursor, sub_bbox[2] + size * 0.03)

    return placed, cursor - x


def _make_vec_arrow(left_x: float, right_x: float, y_top: float,
                    size: float) -> PlacedStroke:
    """ベクトル矢印を 1 ストロークで生成。

    水平線 + 右端三角矢頭 (上端 → 右端 → 下端)。
    """
    margin = size * VEC_MARGIN
    line_left = left_x + margin
    line_right = right_x - margin
    if line_right <= line_left:
        # 文字が極端に短い場合のフォールバック
        line_right = left_x + max(size * 0.2, right_x - left_x)
        line_left = left_x
    head_len = size * VEC_HEAD_LEN
    head_hw = size * VEC_HEAD_HALFWIDTH
    pts = [
        (line_left, y_top),
        (line_right, y_top),
        (line_right - head_len, y_top - head_hw),
        (line_right, y_top),
        (line_right - head_len, y_top + head_hw),
    ]
    return PlacedStroke(points_cm=pts, pressures=[0.35] * len(pts))


def _curve_sample(P0, P1, P2, n):
    """2次ベジエを n 分割してポリライン化 (JS と同一式)。"""
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        pts.append((u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0],
                    u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1]))
    return pts


def _make_curve_arrow(kind: str, x: float, y: float, size: float) -> PlacedStroke:
    """増減表カーブ矢印 (手続き描画)。kind: incUp/incDown/decUp/decDown。"""
    w = size * CURVE_W
    h = size * CURVE_H
    L = x + 0.12 * w
    Rt = x + 0.88 * w
    T = y + 0.12 * h
    B = y + 0.88 * h
    if kind == "incUp":      # 増加・下に凸 ∪
        P0, P2, P1 = (L, B), (Rt, T), (Rt, B)
    elif kind == "incDown":  # 増加・上に凸 ∩
        P0, P2, P1 = (L, B), (Rt, T), (L, T)
    elif kind == "decUp":    # 減少・下に凸 ∪
        P0, P2, P1 = (L, T), (Rt, B), (L, B)
    else:                    # 減少・上に凸 ∩
        P0, P2, P1 = (L, T), (Rt, B), (Rt, T)
    arc = _curve_sample(P0, P1, P2, 14)
    prev = arc[-2]
    end = P2
    dx = end[0] - prev[0]
    dy = end[1] - prev[1]
    length = (dx * dx + dy * dy) ** 0.5 or 1.0
    dx /= length
    dy /= length
    hl = size * 0.16
    hw = size * 0.10
    bx = end[0] - dx * hl
    by = end[1] - dy * hl
    nx, ny = -dy, dx
    barb1 = (bx + nx * hw, by + ny * hw)
    barb2 = (bx - nx * hw, by - ny * hw)
    pts = arc + [barb1, (end[0], end[1]), barb2]
    return PlacedStroke(points_cm=pts, pressures=[0.4] * len(pts))


def _place_curve(kind: str, x: float, y: float, size: float) -> Tuple[List[PlacedStroke], float]:
    """カーブ矢印を1ストロークで配置。"""
    s = _make_curve_arrow(kind, x, y, size)
    return [s], size * CURVE_W + size * 0.05


def _place_vector(e: Expr, x: float, y: float, size: float,
                  dictionary: Dictionary) -> Tuple[List[PlacedStroke], float]:
    """\\vec{...} を配置: 中身を通常配置し、上に矢印を載せる。"""
    placed: List[PlacedStroke] = []
    cursor = x
    for child in e.vec or []:
        ps, w = _place_expr(child, cursor, y, size, dictionary)
        placed.extend(ps)
        cursor += w
    if not placed:
        # 中身が空 → 何もしない
        return placed, cursor - x
    xs = [p[0] for s in placed for p in s.points_cm]
    ys = [p[1] for s in placed for p in s.points_cm]
    content_left = min(xs)
    content_right = max(xs)
    content_top = min(ys)
    arrow_y = content_top - size * VEC_GAP
    arrow = _make_vec_arrow(content_left, content_right, arrow_y, size)
    placed.append(arrow)
    return placed, cursor - x


def _place_expr(e: Expr, x: float, y: float, size: float,
                dictionary: Dictionary) -> Tuple[List[PlacedStroke], float]:
    """Expr 1つを (x, y) を左上原点に、高さ size で配置。

    Returns: (placed_strokes, advance_x_cm)
    """
    placed: List[PlacedStroke] = []

    # 分数 \frac{num}{denom}
    if e.frac is not None:
        return _place_fraction(e.frac[0], e.frac[1], x, y, size, dictionary)

    # 関数名 (\sin, \cos, \lim 等)
    if e.fn_name is not None:
        return _place_function(e, x, y, size, dictionary)

    # ベクトル \vec{...}
    if e.vec is not None:
        return _place_vector(e, x, y, size, dictionary)

    # 増減表カーブ矢印
    if e.curve is not None:
        return _place_curve(e.curve, x, y, size)

    if e.base == "" and e.children is not None:
        # グループ: childrenを連続配置
        cursor = x
        for child in e.children:
            ps, w = _place_expr(child, cursor, y, size, dictionary)
            placed.extend(ps)
            cursor += w
        advance = cursor - x
        # sub/sup が付くとき、グループ全体の右側に配置するのが自然
        # 仮想的に "グループ末尾atom" のアンカーを使う代わりに、
        # 単純に「グループ右上/右下」を sub/sup の中心とする
        right = cursor
        if e.sup:
            sup_size = size * SUB_SUP_SCALE
            sup_placed, _ = _place_centered(e.sup, right, y + sup_size / 2, sup_size, dictionary, len(e.sup) > 1)
            placed.extend(sup_placed)
            sx_min, _, sx_max, _ = _strokes_bbox(sup_placed)
            advance = max(advance, sx_max - x)
        if e.sub:
            sub_size = size * SUB_SUP_SCALE
            sub_placed, _ = _place_centered(e.sub, right, y + size - sub_size / 2, sub_size, dictionary, len(e.sub) > 1)
            placed.extend(sub_placed)
            sx_min, _, sx_max, _ = _strokes_bbox(sub_placed)
            advance = max(advance, sx_max - x)
        return placed, advance

    # 単一atom
    base_ps, base_adv, g = _place_atom(e, x, y, size, dictionary)
    placed.extend(base_ps)
    right_after_base = x + base_adv

    # √ 特殊処理: sub/sup より先に実行 (placed[-1] がまだ √ の最終ストロークなので)
    sqrt_handled = False
    if e.base == "√" and e.arg is not None and base_ps:
        # √ の最後の点 = √ 本体の頂点 (top-right of radical sign)
        last_idx = len(placed) - 1
        last = placed[last_idx]
        if last.points_cm:
            end_pt = last.points_cm[-1]
            bar_y_world = end_pt[1]   # バーは √ 頂点の Y に合わせる
        else:
            body_anchor = _anchor_world(g, "body", x, y)
            bar_y_world = body_anchor[1] if body_anchor else y
        # radicand は通常テキスト位置 (バーは √ の頂点に残り、間に自然な余白)
        # √ は控えめな左寄せ (radicand が見えなくならないように)
        body_anchor = _anchor_world(g, "body", x, y)
        bx = (body_anchor[0] - size * SQRT_BODY_LEFT_SHIFT) if body_anchor else right_after_base
        rad_size = size            # 通常文字と同サイズ
        rad_y_top = y              # 通常テキストと同じベースライン
        rad_placed: List[PlacedStroke] = []
        rad_cursor_x = bx
        for child in e.arg:
            ps, w = _place_expr(child, rad_cursor_x, rad_y_top, rad_size, dictionary)
            rad_placed.extend(ps)
            rad_cursor_x += w
        if rad_placed:
            rad_right = max(p[0] for s in rad_placed for p in s.points_cm) + size * 0.05
        else:
            rad_right = rad_cursor_x + size * 0.05
        # √ 本体の最後のストロークから水平に rad_right まで延長
        # バー部分の pressure を低めにして細く描画
        if last.points_cm:
            bar_end = (rad_right, bar_y_world)
            new_pts = list(last.points_cm) + [bar_end]
            base_pres = list(last.pressures or [0.5] * len(last.points_cm))
            if not base_pres:
                base_pres = [0.5] * len(last.points_cm)
            # 既存最後点とバー終点を細く (pressure 0.30)
            new_pres = base_pres[:-1] + [0.30, 0.30]
            placed[last_idx] = PlacedStroke(points_cm=new_pts, pressures=new_pres)
        placed.extend(rad_placed)
        right_after_base = max(right_after_base, rad_right)
        sqrt_handled = True

    # sub
    if e.sub:
        sub_size = size * SUB_SUP_SCALE
        anchor = _anchor_world(g, "sub", x, y)
        if anchor is None:
            cx, cy = right_after_base + size * SUB_SUP_X_OFFSET, y + size * SUB_CENTER_Y
        else:
            cx, cy = anchor
        ndx, ndy = anchor_nudge(e.base, "sub")
        cx += ndx * size
        cy += ndy * size
        # 複数文字の添字 (通常文字基底・アンカー無し) は左揃え。∫/∑ の下限(アンカー有)は中央。
        sub_placed, sub_bbox = _place_centered(e.sub, cx, cy, sub_size, dictionary, anchor is None and len(e.sub) > 1)
        placed.extend(sub_placed)
        if anchor is None:
            right_after_base = max(right_after_base, sub_bbox[2] + size * 0.03)

    # sup
    if e.sup:
        sup_size = size * SUB_SUP_SCALE
        anchor = _anchor_world(g, "sup", x, y)
        if anchor is None:
            cx, cy = right_after_base + size * SUB_SUP_X_OFFSET, y + size * SUP_CENTER_Y
        else:
            cx, cy = anchor
        ndx, ndy = anchor_nudge(e.base, "sup")
        cx += ndx * size
        cy += ndy * size
        # 複数文字の指数 (n-1 等・アンカー無し) は左揃え。∫/∑ の上限(アンカー有)は中央。
        sup_placed, sup_bbox = _place_centered(e.sup, cx, cy, sup_size, dictionary, anchor is None and len(e.sup) > 1)
        placed.extend(sup_placed)
        if anchor is None:
            right_after_base = max(right_after_base, sup_bbox[2] + size * 0.03)

    # body アンカー (∫_0^1 f(x) の f が ∫ の body アンカー位置から始まる)
    # √ はすでに sqrt_handled で処理済みなのでスキップ
    # ※ base_adv は無視して body anchor 起点で配置 (base 視覚範囲を超えて中に入っても可)
    if not sqrt_handled:
        body_anchor = _anchor_world(g, "body", x, y)
        if body_anchor is not None:
            bndx, _ = anchor_nudge(e.base, "body")  # body 起点の水平微調整 (記号別)
            shifted = body_anchor[0] - size * BODY_LEFT_SHIFT + bndx * size
            right_after_base = max(x, shifted)   # x より左には行かない

    # 通常の arg (∫f(x)dx の f(x)dx 部分 — 簡易: bodyアンカー位置に配置)
    if e.arg and not sqrt_handled:
        anchor = _anchor_world(g, "body", x, y)
        if anchor is not None:
            ax_cursor, ay = anchor
            for child in e.arg:
                ps, w = _place_expr(child, ax_cursor, ay - size / 2, size * ARG_SCALE, dictionary)
                placed.extend(ps)
                ax_cursor += w
            right_after_base = max(right_after_base, ax_cursor)

    return placed, right_after_base - x


def _layout_sequence_origin(exprs: List[Expr], size: float,
                            dictionary: Dictionary) -> Tuple[List[PlacedStroke], float, float]:
    """式列を原点 (0,0) ベースで配置し、配置済みstrokeと幅と高さを返す。"""
    cursor = 0.0
    placed: List[PlacedStroke] = []
    for e in exprs:
        ps, w = _place_expr(e, cursor, 0.0, size, dictionary)
        placed.extend(ps)
        cursor += w
    if placed:
        xs = [p[0] for s in placed for p in s.points_cm]
        ys = [p[1] for s in placed for p in s.points_cm]
        width = max(xs) - min(xs) if xs else cursor
    else:
        width = cursor
    height = 0.0
    if placed:
        ys = [p[1] for s in placed for p in s.points_cm]
        height = (max(ys) - min(ys)) if ys else 0.0
    return placed, max(width, cursor), height


def _shift_strokes(strokes: List[PlacedStroke], dx: float, dy: float) -> List[PlacedStroke]:
    """配置済みstrokeを平行移動した新リストを返す (副作用なし)。"""
    out: List[PlacedStroke] = []
    for s in strokes:
        new_pts = [(p[0] + dx, p[1] + dy) for p in s.points_cm]
        out.append(PlacedStroke(points_cm=new_pts, pressures=list(s.pressures or [])))
    return out


# 分数のスケール係数 (numerator/denominator は size の何倍)
FRAC_SCALE = 0.65
FRAC_BAR_MARGIN = 0.10    # バー長を max(num,denom) の何倍にするか加算 (両端の余白)
FRAC_VGAP = 0.22          # num/denom とバーの間の縦余白 (size比)


def _place_fraction(num: List[Expr], denom: List[Expr],
                    x: float, y: float, size: float,
                    dictionary: Dictionary) -> Tuple[List[PlacedStroke], float]:
    """分数を配置: numerator が上、denominator が下、間に水平バー。

    バー長は max(num_width, denom_width) + 余白 で動的決定。
    全体の縦高さは size (font_size) に収まるよう num/denom は小さく。
    """
    frac_size = size * FRAC_SCALE

    # 原点ベースで num/denom を配置 → 幅と高さを取得
    num_placed, num_w, _ = _layout_sequence_origin(num, frac_size, dictionary)
    denom_placed, denom_w, _ = _layout_sequence_origin(denom, frac_size, dictionary)

    bar_w = max(num_w, denom_w) * (1.0 + FRAC_BAR_MARGIN * 2)
    bar_w = max(bar_w, frac_size * 0.3)  # 最低限の幅
    bar_y = y + size * 0.5  # バーは base の縦中心
    # 左マージンで中央寄せ
    bar_left_x = x
    bar_right_x = bar_left_x + bar_w

    bar_cx = bar_left_x + bar_w / 2  # バーの中心 (num/denom はこの x に実インク中心を合わせる)

    # numerator を バー上、実インク中心をバー中心に合わせて配置
    num_target_y = bar_y - frac_size - size * FRAC_VGAP
    if num_placed:
        nxs = [p[0] for s in num_placed for p in s.points_cm]
        ny_min = min(p[1] for s in num_placed for p in s.points_cm)
        num_cx = (min(nxs) + max(nxs)) / 2
        num_shifted = _shift_strokes(num_placed, bar_cx - num_cx, num_target_y - ny_min)
    else:
        num_shifted = []

    # denominator を バー下、実インク中心をバー中心に合わせて配置
    denom_target_y = bar_y + size * FRAC_VGAP
    if denom_placed:
        dxs = [p[0] for s in denom_placed for p in s.points_cm]
        dy_min = min(p[1] for s in denom_placed for p in s.points_cm)
        denom_cx = (min(dxs) + max(dxs)) / 2
        denom_shifted = _shift_strokes(denom_placed, bar_cx - denom_cx, denom_target_y - dy_min)
    else:
        denom_shifted = []

    # 水平バー: 文字より細く (pressure 低め)
    # 通常文字は pressure 0.5 デフォルト → バーは 0.35 で細めに
    bar = PlacedStroke(
        points_cm=[(bar_left_x, bar_y), (bar_right_x, bar_y)],
        pressures=[0.35, 0.35],
    )

    out = num_shifted + [bar] + denom_shifted
    advance = bar_w + size * 0.05
    return out, advance


def place_formula(src: str, x_cm: float, y_cm: float, size_cm: float,
                  dictionary: Dictionary) -> Tuple[List[PlacedStroke], float]:
    """数式文字列をパースして配置。

    全 atom を等倍で配置する。以前あった「関数引数 f(x) の (x) や微分 dx を
    自動縮小する」処理は撤廃した。理由: `f(x)`(関数) と `t(t-3)`(掛け算) は
    構文的に区別不能で誤爆する上、標準の数式組版でも引数は等倍であるため。

    Returns: (placed_strokes, total_width_cm)
    """
    exprs = parse_formula(src)
    cursor = x_cm
    placed: List[PlacedStroke] = []
    for e in exprs:
        ps, w = _place_expr(e, cursor, y_cm, size_cm, dictionary)
        placed.extend(ps)
        cursor += w
    return placed, cursor - x_cm
