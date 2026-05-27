"""<p:timing> 要素ジェネレータ。

各ブロックを clickEffect (presetID=63, presetClass="entr") で
drawProgress 0→1 (1秒) のアニメで順次表示する。
お手本 slide1_pretty.xml の 3959-4032 行を完全準拠。
"""
from __future__ import annotations

from typing import List


def build_timing(sp_ids, duration_ms: int = 1000) -> str:
    """timing XML 文字列を返す (`<p:timing>` から `</p:timing>` まで)。

    sp_ids: クリックステップ単位のグループのリスト。
        - List[int] (後方互換): 各 sp_id が単独で 1 click として扱われる。
        - List[List[int]]: 各グループ内の全 sp_id を 1 click で同時表示。
          (通常ストローク + 太字ストローク を同時に描画する用)。
    """
    # 入力を List[List[int]] に正規化
    groups = []
    for item in sp_ids:
        if isinstance(item, list):
            groups.append(item)
        else:
            groups.append([item])

    parts: List[str] = []
    parts.append("<p:timing>")
    parts.append("<p:tnLst>")
    parts.append('<p:par>')
    parts.append(
        '<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">'
    )
    parts.append("<p:childTnLst>")
    parts.append('<p:seq concurrent="1" nextAc="seek">')
    parts.append('<p:cTn id="2" dur="indefinite" nodeType="mainSeq">')
    parts.append("<p:childTnLst>")

    next_id = 3
    for group in groups:
        outer_id = next_id
        mid_id = next_id + 1
        click_id = next_id + 2
        next_id += 3

        parts.append("<p:par>")
        parts.append(f'<p:cTn id="{outer_id}" fill="hold">')
        parts.append("<p:stCondLst>")
        parts.append('<p:cond delay="indefinite"/>')
        parts.append("</p:stCondLst>")
        parts.append("<p:childTnLst>")
        parts.append("<p:par>")
        parts.append(f'<p:cTn id="{mid_id}" fill="hold">')
        parts.append("<p:stCondLst>")
        parts.append('<p:cond delay="0"/>')
        parts.append("</p:stCondLst>")
        parts.append("<p:childTnLst>")
        parts.append("<p:par>")
        parts.append(
            f'<p:cTn id="{click_id}" presetID="63" presetClass="entr" '
            'presetSubtype="0" fill="hold" nodeType="clickEffect">'
        )
        parts.append("<p:stCondLst>")
        parts.append('<p:cond delay="0"/>')
        parts.append("</p:stCondLst>")
        parts.append("<p:childTnLst>")
        # group 内の各 sp_id について set + anim を追加 (どれも delay=0 で同時発火)
        for sp_id in group:
            set_id = next_id
            anim_id = next_id + 1
            next_id += 2
            parts.append("<p:set>")
            parts.append("<p:cBhvr>")
            parts.append(f'<p:cTn id="{set_id}" dur="1" fill="hold">')
            parts.append("<p:stCondLst>")
            parts.append('<p:cond delay="0"/>')
            parts.append("</p:stCondLst>")
            parts.append("</p:cTn>")
            parts.append(f'<p:tgtEl><p:spTgt spid="{sp_id}"/></p:tgtEl>')
            parts.append(
                "<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>"
            )
            parts.append("</p:cBhvr>")
            parts.append('<p:to><p:strVal val="visible"/></p:to>')
            parts.append("</p:set>")
            parts.append('<p:anim calcmode="lin" valueType="num">')
            parts.append("<p:cBhvr>")
            parts.append(f'<p:cTn id="{anim_id}" dur="{duration_ms}" fill="hold"/>')
            parts.append(f'<p:tgtEl><p:spTgt spid="{sp_id}"/></p:tgtEl>')
            parts.append(
                "<p:attrNameLst><p:attrName>drawProgress</p:attrName></p:attrNameLst>"
            )
            parts.append("</p:cBhvr>")
            parts.append("<p:tavLst>")
            parts.append('<p:tav tm="0"><p:val><p:fltVal val="0"/></p:val></p:tav>')
            parts.append('<p:tav tm="100000"><p:val><p:fltVal val="1"/></p:val></p:tav>')
            parts.append("</p:tavLst>")
            parts.append("</p:anim>")
        parts.append("</p:childTnLst>")
        parts.append("</p:cTn>")
        parts.append("</p:par>")
        parts.append("</p:childTnLst>")
        parts.append("</p:cTn>")
        parts.append("</p:par>")
        parts.append("</p:childTnLst>")
        parts.append("</p:cTn>")
        parts.append("</p:par>")

    parts.append("</p:childTnLst>")
    parts.append("</p:cTn>")
    # seq の next/prev 条件
    parts.append("<p:prevCondLst>")
    parts.append(
        '<p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond>'
    )
    parts.append("</p:prevCondLst>")
    parts.append("<p:nextCondLst>")
    parts.append(
        '<p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond>'
    )
    parts.append("</p:nextCondLst>")
    parts.append("</p:seq>")
    parts.append("</p:childTnLst>")
    parts.append("</p:cTn>")
    parts.append("</p:par>")
    parts.append("</p:tnLst>")
    parts.append("</p:timing>")
    return "".join(parts)
