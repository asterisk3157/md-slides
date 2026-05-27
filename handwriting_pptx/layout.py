"""5ブロック自動配置。

見出し(x=1.5, y=1.0) + 箇条書き×4(x=2.0, y=4.0/6.0/8.0/10.0)
各文字を font_size_cm の幅で等間隔に並べる。
行頭に '・' を入れる。

文字種ごとのサイズ・縦位置を CHAR_METRICS で持つ。中黒・句読点・演算子などは
標準文字より小さく描画される。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from .dict_loader import Dictionary, fallback_bullet_glyph, fallback_unknown_glyph
from .inkml import PlacedStroke, stroke_to_placed
from .stroke import Glyph


from . import theme

# Math/Bold/Span wrapper (api.py で定義) を扱うために遅延 import
def _is_math(obj) -> bool:
    return hasattr(obj, "formula") and obj.__class__.__name__ == "Math"


def _is_bold(obj) -> bool:
    return hasattr(obj, "parts") and obj.__class__.__name__ == "Bold"


def _is_span(obj) -> bool:
    return hasattr(obj, "parts") and obj.__class__.__name__ == "Span"


def _flatten(segments, styles=None, bold_flag=False, color=None):
    """Bold/Span を再帰展開して [(seg, bold, color)] のフラットリストに。

    segments: List[str | Math | Bold | Span]
    styles: クラス→{color,bold} 解決用。None なら組込みデフォルトのみ。
    """
    if styles is None:
        styles = theme.build_styles()
    out = []
    for seg in segments:
        if _is_bold(seg):
            out.extend(_flatten(seg.parts, styles, bold_flag=True, color=color))
        elif _is_span(seg):
            try:
                st = theme.resolve_class(seg.class_name, styles)
            except theme.StyleError:
                st = {"color": None, "bold": False}
            new_color = st["color"] if st.get("color") else color
            new_bold = bold_flag or st.get("bold", False)
            out.extend(_flatten(seg.parts, styles, bold_flag=new_bold, color=new_color))
        else:
            out.append((seg, bold_flag, color))
    return out


# 配置ルール (CHAR_METRICS 等) は handwriting_pptx/metrics.py に集約。
# 後方互換のため char_metrics をここから re-export する。
from .metrics import char_metrics, is_small_kana


@dataclass
class Block:
    """1ブロック (=1行) の配置済みストローク群。

    placed: InkMLに直接書き込めるストローク列
    origin_cm / size_cm: グループの (左上, 幅×高さ) - スライドXMLの xfrm 用
    label: デバッグ表示用
    """

    placed: List[PlacedStroke] = field(default_factory=list)
    x_cm: float = 0.0
    y_cm: float = 0.0
    w_cm: float = 0.0
    h_cm: float = 0.0
    label: str = ""


def layout_text_line(
    text,                              # str / Math / List[str|Math|Bold|Span]
    dictionary: Dictionary,
    x_cm: float,
    y_cm: float,
    font_size_cm: float,
    include_bullet: bool = False,
    use_metrics: bool = True,
    styles=None,
) -> Block:
    """1行ぶんを文字単位に並べて配置。

    text は str, Math, または List[str|Math|Bold|Span] (混在対応)。

    Args:
        include_bullet: True なら行頭にバレット ・ を入れる (箇条書き用)。
            バレットは行内の中黒より大きめに固定サイズで描画する。
        use_metrics: False なら CHAR_METRICS を無視して全文字を均等扱い (見出し用)。
        styles: 装飾クラス→{color,bold} の解決表 (Span用)。
    """
    # mixed segments への変換: 単一 str or Math は [text] にラップ
    if isinstance(text, list):
        segments = text
    else:
        segments = [text]
    cursor_x = x_cm
    cursor_y = y_cm
    placed: List[PlacedStroke] = []

    # 行頭バレット: 通常の中黒メトリクスを使わず固定サイズで配置
    # サイズは小さめにし、バレット自体+後ろの余白で適切な空白を維持
    if include_bullet:
        bullet = dictionary.glyph("・") or fallback_bullet_glyph()
        bullet_size = font_size_cm * 0.30       # 小さめ
        bullet_y_offset = (font_size_cm - bullet_size) / 2  # 縦中央
        for s in bullet.strokes:
            placed.append(
                stroke_to_placed(s, (cursor_x, cursor_y + bullet_y_offset), bullet_size)
            )
        # バレット後の余白を広く取って、テキスト開始位置を従来通り保つ
        cursor_x += bullet_size + font_size_cm * 0.5

    # 各セグメントを順次配置。Bold/Span は再帰展開して bold/color を伝搬
    label_parts: List[str] = []
    flat = _flatten(segments, styles)
    for seg, bold, color in flat:
        if _is_math(seg):
            from .formula import place_formula
            formula_placed, formula_w = place_formula(
                seg.formula, cursor_x, cursor_y, font_size_cm, dictionary
            )
            for ps in formula_placed:
                if bold:
                    ps.bold = True
                if color and ps.color is None:
                    ps.color = color
            placed.extend(formula_placed)
            cursor_x += formula_w
            label_parts.append(("**$" + seg.formula + "$**") if bold else ("$" + seg.formula + "$"))
            continue

        # text segment
        text_seg = seg if isinstance(seg, str) else str(seg)
        label_parts.append(("**" + text_seg + "**") if bold else text_seg)
        chars: List[Glyph] = []
        for ch in text_seg:
            if ch == " " or ch == "　":
                chars.append(Glyph(char=ch, strokes=[], advance=0.5 if ch == " " else 1.0))
                continue
            g = dictionary.glyph(ch)
            if g is None:
                g = fallback_unknown_glyph(ch)
            chars.append(g)
        cursor_x = _place_chars(chars, placed, cursor_x, cursor_y, font_size_cm, use_metrics, bold=bold, color=color)

    w = max(0.0, cursor_x - x_cm)
    h = font_size_cm
    new_y_cm = y_cm
    if placed:
        ys = [p[1] for s in placed for p in s.points_cm]
        actual_y_min = min(ys)
        actual_y_max = max(ys)
        new_y_cm = min(y_cm, actual_y_min - 0.05)
        h = max(font_size_cm, actual_y_max - new_y_cm + 0.05)
    return Block(placed=placed, x_cm=x_cm, y_cm=new_y_cm, w_cm=w, h_cm=h, label="".join(label_parts))


# 文字間の視覚的な間隔 (font_size 比)。インク幅 advance に加算する。
_CHAR_GAP = 0.18


def _place_chars(chars, placed, cursor_x, cursor_y, font_size_cm, use_metrics, bold=False, color=None):
    """通常文字列の各 Glyph を cursor_x から配置。新しい cursor_x を返す。

    advance は「箱(1.0幅)」ではなく **実際のインク幅** 基準。これにより細い字
    (i, 括弧, ! など) は自然に詰まり、太い字(かな)は従来どおりの間隔になる。
    各グリフはインク左端が cursor に来るよう左シフトして配置する。

    bold=True なら太字フラグ、color 指定なら色を PlacedStroke に立てる。
    """
    for g in chars:
        # ストローク無し (スペースなど) は g.advance を素直に使う
        if not g.strokes:
            cursor_x += g.advance * font_size_cm
            continue

        # 読点・カンマは左に少し余白を空ける (前の字に詰まりすぎないように)
        if g.char in (",", "、"):
            cursor_x += font_size_cm * 0.10

        # em 座標 (登録マスの基準線基準): 描いた占有比率・ベースラインをそのまま反映。
        # y=0 が cap 線 (= 行上端 cursor_y), y=1 が baseline (= cursor_y+font_size)。
        if getattr(g, "coord_space", "bbox") == "em":
            exs = [p[0] for s in g.strokes for p in s.points]
            e_min = min(exs) if exs else 0.0
            e_max = max(exs) if exs else 0.0
            x_origin = cursor_x - e_min * font_size_cm
            for s in g.strokes:
                placed.append(stroke_to_placed(s, (x_origin, cursor_y), font_size_cm, bold=bold, color=color))
            cursor_x += (e_max - e_min) * font_size_cm + font_size_cm * _CHAR_GAP
            continue

        if use_metrics:
            rel_size, valign = char_metrics(g.char)
        elif is_small_kana(g.char):
            # 見出し等 (use_metrics=False) でも小書き仮名だけは縮小する
            rel_size, valign = char_metrics(g.char)
        else:
            # それ以外は均等扱い (括弧・記号も等倍に保つ)
            rel_size, valign = 1.0, "top"
        glyph_size = font_size_cm * rel_size
        if valign == "middle":
            y_offset = (font_size_cm - glyph_size) / 2
        elif valign == "bottom":
            y_offset = font_size_cm - glyph_size
        else:  # top
            y_offset = 0.0

        # インク x 範囲を取り、インク左端を cursor に合わせて左シフト
        nxs = [p[0] for s in g.strokes for p in s.points]
        nx_min = min(nxs) if nxs else 0.0
        nx_max = max(nxs) if nxs else 1.0
        x_origin = cursor_x - nx_min * glyph_size
        for s in g.strokes:
            placed.append(stroke_to_placed(s, (x_origin, cursor_y + y_offset), glyph_size, bold=bold, color=color))
        ink_w = (nx_max - nx_min) * glyph_size
        cursor_x += ink_w + font_size_cm * _CHAR_GAP
    return cursor_x


def layout_5block(
    heading: str,
    bullets: List[str],
    dictionary: Dictionary,
    heading_size_cm: float = 1.8,
    bullet_size_cm: float = 1.0,
    heading_origin: tuple = (1.5, 1.0),
    bullets_origin: tuple = (2.0, 4.2),
    bullet_v_spacing_cm: float = 2.7,
    styles=None,
) -> List[Block]:
    """5ブロック分のレイアウトを生成。bullets は4個前提だが少なくても動く。"""
    blocks: List[Block] = []
    hx, hy = heading_origin
    blocks.append(
        layout_text_line(
            heading,
            dictionary,
            x_cm=hx,
            y_cm=hy,
            font_size_cm=heading_size_cm,
            include_bullet=False,
            use_metrics=False,   # 小書き仮名のみ縮小・括弧は等倍
            styles=styles,
        )
    )
    bx, by = bullets_origin
    for i, b in enumerate(bullets):
        blocks.append(
            layout_text_line(
                b,
                dictionary,
                x_cm=bx,
                y_cm=by + i * bullet_v_spacing_cm,
                font_size_cm=bullet_size_cm,
                include_bullet=True,
                styles=styles,
            )
        )
    return blocks


# ---------- フローレイアウト (可変コンテンツ: bullet / 小見出し / ブロック数式 / 表) ----------

def _shift_block(blk: "Block", dx: float, dy: float) -> "Block":
    """Block のストロークを (dx, dy) 平行移動した新 Block を返す。"""
    new_placed = [
        PlacedStroke(points_cm=[(px + dx, py + dy) for (px, py) in s.points_cm],
                     pressures=s.pressures, bold=s.bold, color=s.color)
        for s in blk.placed
    ]
    return Block(placed=new_placed, x_cm=blk.x_cm + dx, y_cm=blk.y_cm + dy,
                 w_cm=blk.w_cm, h_cm=blk.h_cm, label=blk.label)


def _render_table(table, x_cm: float, y_cm: float, size: float,
                  dictionary: Dictionary, styles=None) -> "Block":
    """表 (md_parser.Table) をグリッド線＋セル内容で配置した Block を返す。"""
    cell_size = size * 0.78
    pad = cell_size * 0.30
    all_rows = [table.header] + list(table.rows)
    nrows = len(all_rows)
    ncols = max((len(r) for r in all_rows), default=0)
    if nrows == 0 or ncols == 0:
        return Block(x_cm=x_cm, y_cm=y_cm, w_cm=0.0, h_cm=0.0, label="[table]")

    # 各セルを原点で描画して幅を測る
    cell_blocks = {}
    col_w = [0.0] * ncols
    for r, row in enumerate(all_rows):
        for c in range(ncols):
            cell = row[c] if c < len(row) else []
            blk = layout_text_line(cell, dictionary, 0.0, 0.0, cell_size,
                                   include_bullet=False, styles=styles)
            cell_blocks[(r, c)] = blk
            col_w[c] = max(col_w[c], blk.w_cm)
    col_w = [w + 2 * pad for w in col_w]
    row_h = cell_size * 1.7
    total_w = sum(col_w)
    total_h = row_h * nrows

    placed: List[PlacedStroke] = []
    # 罫線 (横)
    for r in range(nrows + 1):
        yy = y_cm + r * row_h
        placed.append(PlacedStroke(points_cm=[(x_cm, yy), (x_cm + total_w, yy)], pressures=[0.5, 0.5]))
    # 罫線 (縦)。左から2番目の線 (= 第1列の右、c==1) は増減表慣習で2重線にする。
    dbl_gap = cell_size * 0.14
    for c in range(ncols + 1):
        xx = x_cm + sum(col_w[:c])
        placed.append(PlacedStroke(points_cm=[(xx, y_cm), (xx, y_cm + total_h)], pressures=[0.5, 0.5]))
        if c == 1:
            placed.append(PlacedStroke(
                points_cm=[(xx + dbl_gap, y_cm), (xx + dbl_gap, y_cm + total_h)], pressures=[0.5, 0.5]))
    # セル内容 (各セルを中央寄せで配置)
    for r in range(nrows):
        for c in range(ncols):
            blk = cell_blocks[(r, c)]
            if not blk.placed:
                continue
            cell_x = x_cm + sum(col_w[:c])
            cell_y = y_cm + r * row_h
            dx = cell_x + (col_w[c] - blk.w_cm) / 2.0 - blk.x_cm
            dy = cell_y + (row_h - cell_size) / 2.0
            for s in blk.placed:
                placed.append(PlacedStroke(
                    points_cm=[(px + dx, py + dy) for (px, py) in s.points_cm],
                    pressures=s.pressures, bold=s.bold, color=s.color))
    return Block(placed=placed, x_cm=x_cm, y_cm=y_cm, w_cm=total_w, h_cm=total_h, label="[table]")


NOTE_COLOR = "#808080"  # メモ(note)ロールの既定色 (本文流れ・小さめ・グレー)


def _render_item(item, x_cm: float, y_cm: float, size: float,
                 dictionary: Dictionary, styles=None,
                 slide_w_cm: float = 33.867,
                 subheading_size_cm: float = None,
                 note_size_cm: float = None) -> Tuple["Block", float]:
    """1 コンテンツアイテムを (x_cm, y_cm) 起点で配置。(Block, height_cm) を返す。

    size=本文サイズ。小見出し/メモは subheading_size_cm / note_size_cm を使う
    (未指定なら本文比 ×1.12 / ×0.62)。
    """
    # 遅延 import (循環回避)
    from .md_parser import Bullet, Paragraph, BlockMath, SubHeading, Note, Table
    from .api import Math

    if subheading_size_cm is None:
        subheading_size_cm = size * 1.12
    if note_size_cm is None:
        note_size_cm = size * 0.62

    if isinstance(item, Bullet):
        blk = layout_text_line(item.segments, dictionary, x_cm, y_cm, size,
                               include_bullet=True, styles=styles)
        return blk, blk.h_cm
    if isinstance(item, Paragraph):
        blk = layout_text_line(item.segments, dictionary, x_cm, y_cm, size,
                               include_bullet=False, styles=styles)
        return blk, blk.h_cm
    if isinstance(item, Note):
        # メモ: 本文流れに小さめ＋グレー。明示 span 色は尊重し、無色のみグレー化。
        blk = layout_text_line(item.segments, dictionary, x_cm, y_cm, note_size_cm,
                               include_bullet=False, use_metrics=True, styles=styles)
        new_placed = [
            PlacedStroke(points_cm=s.points_cm, pressures=s.pressures, bold=s.bold,
                         color=(s.color if s.color is not None else NOTE_COLOR))
            for s in blk.placed
        ]
        blk = Block(placed=new_placed, x_cm=blk.x_cm, y_cm=blk.y_cm,
                    w_cm=blk.w_cm, h_cm=blk.h_cm, label=blk.label)
        return blk, blk.h_cm
    if isinstance(item, SubHeading):
        # 小見出しも本文同様に CHAR_METRICS を適用 (・ や句読点などの記号を縮小する)
        blk = layout_text_line(item.segments, dictionary, x_cm, y_cm, subheading_size_cm,
                               include_bullet=False, use_metrics=True, styles=styles)
        return blk, blk.h_cm
    if isinstance(item, BlockMath):
        blk = layout_text_line([Math(item.formula)], dictionary, x_cm, y_cm, size,
                               include_bullet=False, styles=styles)
        # 水平中央寄せ
        center_target = slide_w_cm / 2.0
        cur_center = blk.x_cm + blk.w_cm / 2.0
        blk = _shift_block(blk, center_target - cur_center, 0.0)
        return blk, blk.h_cm
    if isinstance(item, Table):
        blk = _render_table(item, x_cm, y_cm, size, dictionary, styles=styles)
        return blk, blk.h_cm
    # 未知アイテム
    return Block(x_cm=x_cm, y_cm=y_cm, w_cm=0.0, h_cm=0.0), 0.0


PT_TO_CM = 2.54 / 72  # 1pt = 1/72 inch


def resolve_tier_sizes(meta: dict) -> Tuple[float, float, float, float]:
    """frontmatter meta から (heading, body, subheading, note) サイズ(cm)を解決。

    pt キー優先 → 旧 cm キー → 既定(本文比)。JS render/index.js と同一ロジック。
    pt 未指定なら従来どおりで出力不変 (後方互換)。
    """
    hp = meta.get("heading_pt")
    bp = meta.get("body_pt")
    sp = meta.get("subheading_pt")
    np_ = meta.get("note_pt")
    heading = hp * PT_TO_CM if hp else float(meta.get("heading_size_cm", 1.8))
    body = bp * PT_TO_CM if bp else float(meta.get("bullet_size_cm", 1.0))
    subheading = sp * PT_TO_CM if sp else body * 1.12
    note = np_ * PT_TO_CM if np_ else body * 0.62
    return heading, body, subheading, note


def layout_flow(
    heading,
    content,
    dictionary: Dictionary,
    heading_size_cm: float = 1.8,
    body_size_cm: float = 1.0,
    subheading_size_cm: float = None,
    note_size_cm: float = None,
    heading_origin: tuple = (1.5, 1.0),
    body_origin: tuple = (2.0, 4.2),
    styles=None,
    slide_w_cm: float = 33.867,
    slide_h_cm: float = 19.05,
) -> List["Block"]:
    """見出し + 可変コンテンツ (bullet/小見出し/メモ/ブロック数式/表) を縦フロー配置。

    固定サイズ方式: フォントは行数に応じて自動縮小しない (役割別サイズをそのまま使う)。
    入り切らない場合はそのまま (溢れはプレビュー側で警告)。
    subheading_size_cm / note_size_cm 未指定なら本文比 ×1.12 / ×0.62。
    """
    if subheading_size_cm is None:
        subheading_size_cm = body_size_cm * 1.12
    if note_size_cm is None:
        note_size_cm = body_size_cm * 0.62

    blocks: List[Block] = []
    hx, hy = heading_origin
    blocks.append(
        layout_text_line(heading, dictionary, x_cm=hx, y_cm=hy,
                         font_size_cm=heading_size_cm, include_bullet=False,
                         use_metrics=True, styles=styles)   # 見出しでも ・： 等の記号は縮小
    )
    if not content:
        return blocks

    bx, by = body_origin
    bottom_margin = 0.8
    available_h = max(1.0, slide_h_cm - by - bottom_margin)
    n = len(content)
    min_gap = body_size_cm * 0.45

    def render(it, x, y):
        return _render_item(it, x, y, body_size_cm, dictionary, styles, slide_w_cm,
                            subheading_size_cm, note_size_cm)

    # 高さを 1 度測り、入り切る場合のみ余白を均等分配して縦に散らす (サイズは変えない)。
    heights = [render(it, bx, 0.0)[1] for it in content]
    needed = sum(heights) + min_gap * max(0, n - 1)
    gap = min_gap
    if n > 1 and needed <= available_h:
        extra = available_h - needed
        if extra > 0:
            gap = max(min_gap, extra / (n - 1))

    cursor_y = by
    for it, h in zip(content, heights):
        blk, _ = render(it, bx, cursor_y)
        blocks.append(blk)
        cursor_y += h + gap
    return blocks
