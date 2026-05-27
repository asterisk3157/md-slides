"""公開API。

使い方:
    from handwriting_pptx import Presentation
    p = Presentation(dict_path="data/dict.json")
    p.add_slide_5block(
        heading="接線の本数",
        bullets=["定義の確認", "条件1", "条件2", "結論"],
        color="#004F8B",
        brush_width_cm=0.06,
    )
    p.save("out.pptx")
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from .builder import SlideData, build_pptx, transparent_png_bytes
from .dict_loader import Dictionary
from .inkml import build_inkml
from .layout import layout_5block, layout_text_line, Block
from .slide_xml import SlideBlockXmlInput, build_slide_xml, close_slide, append_timing
from .timing import build_timing
from .units import DEFAULT_SLIDE_W_CM, DEFAULT_SLIDE_H_CM


@dataclass
class _SlideSpec:
    blocks: List[Block]
    color: str = "#000000"
    brush_width_cm: float = 0.06


class HandwrittenText:
    """1行ぶんの手書きテキスト指定 (現状: add_slide_5block の中でだけ使う)。"""

    def __init__(self, text: str, x_cm: float, y_cm: float, font_size_cm: float,
                 include_bullet: bool = False):
        self.text = text
        self.x_cm = x_cm
        self.y_cm = y_cm
        self.font_size_cm = font_size_cm
        self.include_bullet = include_bullet


class Math:
    """数式記法 (Word linear math 風) を直接渡すラッパ。

    使い方:
        bullets=[
            "y = ax + b",          # 通常テキスト
            Math("\\int_0^1 f(x) dx"),  # 数式 (アンカー駆動配置)
            Math("x^2 + y^2 = r^2"),
        ]
    """
    def __init__(self, formula: str):
        self.formula = formula


class Bold:
    """太字セグメント。中身は str / Math / さらに Bold (ネストは平坦化扱い) の混在。

    手書きでは「ペン圧最大 + 太いブラシ」で太字を表現する。
    """
    def __init__(self, parts):
        # parts は単一の str/Math または List[str|Math]
        if not isinstance(parts, list):
            parts = [parts]
        # ネストした Bold は中身に展開
        flat = []
        for p in parts:
            if isinstance(p, Bold):
                flat.extend(p.parts)
            else:
                flat.append(p)
        self.parts = flat


class Span:
    """装飾スパン `<span class="...">`。中身は str / Math / Bold / Span の混在。

    class_name は theme.styles で定義された意味ロール (key/note/...)。
    配置時に color/bold に解決される。
    """
    def __init__(self, parts, class_name: str):
        if not isinstance(parts, list):
            parts = [parts]
        self.parts = parts
        self.class_name = class_name


class Image:
    """画像配置プレースホルダ (未実装)。"""

    def __init__(self, *args, **kwargs):
        raise NotImplementedError("Image placement is not implemented yet.")


class Slide:
    """1スライドの抽象。 add_slide_5block 経由で構築される。"""

    def __init__(self, presentation: "Presentation"):
        self.presentation = presentation
        self.blocks: List[Block] = []
        self.color: str = "#000000"
        self.brush_width_cm: float = 0.06

    def add_block(self, block: Block) -> None:
        self.blocks.append(block)


class Presentation:
    """pptx ビルダのトップレベル。

    Args:
        dict_path: 辞書JSONのパス (省略すると空辞書 → 全文字フォールバック)
        slide_w_cm, slide_h_cm: スライドサイズ (デフォルト: 16:9 widescreen)
    """

    def __init__(
        self,
        dict_path: Optional[str | Path] = None,
        dictionary: Optional[Dictionary] = None,
        slide_w_cm: float = DEFAULT_SLIDE_W_CM,
        slide_h_cm: float = DEFAULT_SLIDE_H_CM,
    ):
        if dictionary is not None:
            self.dictionary = dictionary
        elif dict_path is not None:
            self.dictionary = Dictionary.from_path(dict_path)
        else:
            self.dictionary = Dictionary.empty()
        self.slide_w_cm = slide_w_cm
        self.slide_h_cm = slide_h_cm
        self._slides: List[Slide] = []
        from . import theme
        self.styles = theme.build_styles()  # 装飾クラス解決表 (組込みデフォルト)

    def set_styles(self, doc_styles=None, global_styles=None) -> None:
        """3層マージした装飾 styles を設定 (組込み→グローバル→文書)。"""
        from . import theme
        self.styles = theme.build_styles(doc_styles=doc_styles, global_styles=global_styles)

    def add_slide_from_md(self, slide_md, color: str = "#000000",
                          brush_width_cm: float = 0.06,
                          heading_size_cm: float = 1.8,
                          bullet_size_cm: float = 1.0,
                          subheading_size_cm: float = None,
                          note_size_cm: float = None) -> "Slide":
        """SlideMD (md_parser.SlideMD) を 1 枚のスライドとして追加。

        content (Bullet/BlockMath/SubHeading/Note/Table) をフローレイアウトで配置する。
        """
        return self.add_slide_flow(
            heading=slide_md.heading,
            content=slide_md.content,
            color=color,
            brush_width_cm=brush_width_cm,
            heading_size_cm=heading_size_cm,
            bullet_size_cm=bullet_size_cm,
            subheading_size_cm=subheading_size_cm,
            note_size_cm=note_size_cm,
        )

    def add_slide_flow(
        self,
        heading,
        content,                # List[Bullet|BlockMath|SubHeading|Note|Table]
        color: str = "#000000",
        brush_width_cm: float = 0.06,
        heading_size_cm: float = 1.8,
        bullet_size_cm: float = 1.0,
        subheading_size_cm: float = None,
        note_size_cm: float = None,
        styles=None,
    ) -> Slide:
        from .layout import layout_flow
        s = Slide(self)
        s.color = color
        s.brush_width_cm = brush_width_cm
        blocks = layout_flow(
            heading=heading,
            content=content,
            dictionary=self.dictionary,
            heading_size_cm=heading_size_cm,
            body_size_cm=bullet_size_cm,
            subheading_size_cm=subheading_size_cm,
            note_size_cm=note_size_cm,
            styles=styles if styles is not None else self.styles,
            slide_w_cm=self.slide_w_cm,
            slide_h_cm=self.slide_h_cm,
        )
        for b in blocks:
            s.add_block(b)
        self._slides.append(s)
        return s

    def add_slide_5block(
        self,
        heading,                # str / Math / List[str|Math|Bold|Span]
        bullets: List,          # List[...]
        color: str = "#000000",
        brush_width_cm: float = 0.06,
        heading_size_cm: float = 1.8,
        bullet_size_cm: float = 1.0,
        styles=None,
    ) -> Slide:
        s = Slide(self)
        s.color = color
        s.brush_width_cm = brush_width_cm
        blocks = layout_5block(
            heading=heading,
            bullets=bullets,
            dictionary=self.dictionary,
            heading_size_cm=heading_size_cm,
            bullet_size_cm=bullet_size_cm,
            styles=styles if styles is not None else self.styles,
        )
        for b in blocks:
            s.add_block(b)
        self._slides.append(s)
        return s

    def save(self, path: str | Path) -> None:
        slide_data: List[SlideData] = []
        global_ink_counter = 0
        global_img_counter = 0
        for s in self._slides:
            sd = self._build_slide_data(s, global_ink_counter, global_img_counter)
            global_ink_counter += len(sd.ink_xmls)
            global_img_counter += len(sd.fallback_png_bytes)
            slide_data.append(sd)
        build_pptx(
            slide_data,
            out_path=path,
            slide_w_cm=self.slide_w_cm,
            slide_h_cm=self.slide_h_cm,
        )

    # --- internals ---

    def _build_slide_data(self, s: Slide, ink_base: int, img_base: int) -> SlideData:
        """Slide → SlideData (XML文字列群と画像バイト列)。

        ブロック i の rels:
            ink rId = "rId{1000 + 2*i}"
            image rId = "rId{1000 + 2*i + 1}"
        sp_id (cNvPr/@id) は 100, 101, ... と振る (1はrootグループで予約)。
        """
        ink_xmls: List[str] = []
        png_bytes: List[bytes] = []
        ink_rel_ids: List[str] = []
        img_rel_ids: List[str] = []
        block_inputs: List[SlideBlockXmlInput] = []
        sp_ids: List[int] = []

        BOLD_BRUSH_MULT = 1.45  # 太字は通常の約1.45倍幅 (通常を細く、太字=従来の通常太さ)
        for i, blk in enumerate(s.blocks):
            # 1ブロック=1ink。太字は同一inkファイル内の太字ブラシ(br1)で描画。
            ink_xml = build_inkml(
                strokes=blk.placed,
                color=s.color,
                brush_width_cm=s.brush_width_cm,
                bold_width_mult=BOLD_BRUSH_MULT,
            )
            ink_xmls.append(ink_xml)
            png_bytes.append(transparent_png_bytes())

            ink_rid = f"rId{1000 + 2 * i}"
            img_rid = f"rId{1000 + 2 * i + 1}"
            ink_rel_ids.append(ink_rid)
            img_rel_ids.append(img_rid)

            sp_id = 100 + i
            inner_id = 1000 + i
            sp_ids.append(sp_id)
            block_inputs.append(
                SlideBlockXmlInput(
                    sp_id=sp_id,
                    inner_id=inner_id,
                    name=f"インク {i + 1}",
                    x_cm=blk.x_cm,
                    y_cm=blk.y_cm,
                    w_cm=max(blk.w_cm, 0.1),
                    h_cm=max(blk.h_cm, 0.1),
                    ink_rel_id=ink_rid,
                    fallback_rel_id=img_rid,
                )
            )

        slide_xml = build_slide_xml(
            blocks=block_inputs,
            slide_w_cm=self.slide_w_cm,
            slide_h_cm=self.slide_h_cm,
        )
        timing_xml = build_timing(sp_ids=sp_ids, duration_ms=1000)
        slide_xml = close_slide(slide_xml)
        slide_xml = append_timing(slide_xml, timing_xml)

        sd = SlideData(
            slide_xml=slide_xml,
            ink_xmls=ink_xmls,
            fallback_png_bytes=png_bytes,
        )
        # rels 生成のために補助情報を SlideData にアタッチ
        sd.__dict__["_ink_base"] = ink_base
        sd.__dict__["_img_base"] = img_base
        sd.__dict__["_ink_rel_ids"] = ink_rel_ids
        sd.__dict__["_img_rel_ids"] = img_rel_ids
        return sd
