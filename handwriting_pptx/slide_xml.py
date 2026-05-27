"""スライドXML 生成。

各ブロックを 1個の <mc:AlternateContent> として配置。
<mc:Choice> 内に <p:contentPart r:id="rIdN"> + <p14:xfrm>。
<mc:Fallback> は最小限の透明 <p:pic>。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List

from .units import cm_to_emu


P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006"
P14_NS = "http://schemas.microsoft.com/office/powerpoint/2010/main"


@dataclass
class SlideBlockXmlInput:
    """slide_xml にブロックを渡すためのDTO。

    お手本準拠で、各ブロックを `<p:grpSp>` で包む。timing の spTgt は
    grpSp の cNvPr/@id (= sp_id) を参照する。
    contentPart 自体は grpSp の子で、別の cNvPr/@id (= inner_id) を持つ。
    """

    sp_id: int        # ★grpSp の cNvPr/@id (timing の spTgt から参照される)
    inner_id: int     # contentPart と fallback pic の cNvPr/@id
    name: str         # cNvPr/@name (例 "インク 1")
    x_cm: float
    y_cm: float
    w_cm: float
    h_cm: float
    ink_rel_id: str   # 例 "rId3" (contentPart の r:id)
    fallback_rel_id: str  # 例 "rId4" (Fallback 用画像)


def build_slide_xml(
    blocks: List[SlideBlockXmlInput],
    slide_w_cm: float,
    slide_h_cm: float,
) -> str:
    """スライドXML文字列を返す (UTF-8 declaration付き)。"""
    parts: List[str] = []
    parts.append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
    # ★ お手本準拠: root では p/a/r のみ宣言。mc/p14 は AlternateContent 内で宣言する
    parts.append(
        '<p:sld xmlns:a="{a}" xmlns:r="{r}" xmlns:p="{p}">'.format(
            a=A_NS, r=R_NS, p=P_NS
        )
    )
    parts.append("<p:cSld>")
    parts.append("<p:spTree>")
    parts.append("<p:nvGrpSpPr>")
    parts.append('<p:cNvPr id="1" name=""/>')
    parts.append("<p:cNvGrpSpPr/>")
    parts.append("<p:nvPr/>")
    parts.append("</p:nvGrpSpPr>")
    parts.append("<p:grpSpPr>")
    parts.append("<a:xfrm>")
    parts.append('<a:off x="0" y="0"/>')
    parts.append('<a:ext cx="0" cy="0"/>')
    parts.append('<a:chOff x="0" y="0"/>')
    parts.append('<a:chExt cx="0" cy="0"/>')
    parts.append("</a:xfrm>")
    parts.append("</p:grpSpPr>")

    for blk in blocks:
        ox = cm_to_emu(blk.x_cm)
        oy = cm_to_emu(blk.y_cm)
        ex = max(cm_to_emu(blk.w_cm), 1)
        ey = max(cm_to_emu(blk.h_cm), 1)
        group_name = f"グループ化 {blk.sp_id}"

        # ★ お手本準拠: contentPart を grpSp で包む。
        # timing の spTgt は grpSp の cNvPr/@id (sp_id) を参照する。
        parts.append("<p:grpSp>")
        parts.append("<p:nvGrpSpPr>")
        parts.append(
            '<p:cNvPr id="{id}" name="{name}"/>'.format(id=blk.sp_id, name=group_name)
        )
        parts.append("<p:cNvGrpSpPr/>")
        parts.append("<p:nvPr/>")
        parts.append("</p:nvGrpSpPr>")
        parts.append("<p:grpSpPr>")
        parts.append("<a:xfrm>")
        parts.append('<a:off x="{}" y="{}"/>'.format(ox, oy))
        parts.append('<a:ext cx="{}" cy="{}"/>'.format(ex, ey))
        parts.append('<a:chOff x="{}" y="{}"/>'.format(ox, oy))
        parts.append('<a:chExt cx="{}" cy="{}"/>'.format(ex, ey))
        parts.append("</a:xfrm>")
        parts.append("</p:grpSpPr>")

        # ★ お手本準拠: mc/p14 を AlternateContent で宣言
        parts.append('<mc:AlternateContent xmlns:mc="{}" xmlns:p14="{}">'.format(MC_NS, P14_NS))
        # Choice (modern PowerPoint)
        parts.append('<mc:Choice Requires="p14">')
        parts.append(
            '<p:contentPart xmlns:r="{r}" p14:bwMode="auto" r:id="{rid}">'.format(
                r=R_NS, rid=blk.ink_rel_id
            )
        )
        parts.append("<p14:nvContentPartPr>")
        parts.append(
            '<p14:cNvPr id="{id}" name="{name}"/>'.format(id=blk.inner_id, name=blk.name)
        )
        parts.append("<p14:cNvContentPartPr/>")
        parts.append("<p14:nvPr/>")
        parts.append("</p14:nvContentPartPr>")
        parts.append("<p14:xfrm>")
        parts.append('<a:off x="{}" y="{}"/>'.format(ox, oy))
        parts.append('<a:ext cx="{}" cy="{}"/>'.format(ex, ey))
        parts.append("</p14:xfrm>")
        parts.append("</p:contentPart>")
        parts.append("</mc:Choice>")
        # Fallback (legacy renderers) — ★ お手本準拠: xmlns="" で default namespace を解除
        parts.append('<mc:Fallback xmlns="">')
        parts.append("<p:pic>")
        parts.append("<p:nvPicPr>")
        parts.append(
            '<p:cNvPr id="{id}" name="{name}"/>'.format(id=blk.inner_id, name=blk.name)
        )
        parts.append("<p:cNvPicPr/>")
        parts.append("<p:nvPr/>")
        parts.append("</p:nvPicPr>")
        parts.append("<p:blipFill>")
        parts.append('<a:blip r:embed="{}"/>'.format(blk.fallback_rel_id))
        parts.append("<a:stretch><a:fillRect/></a:stretch>")
        parts.append("</p:blipFill>")
        parts.append("<p:spPr>")
        parts.append("<a:xfrm>")
        parts.append('<a:off x="{}" y="{}"/>'.format(ox, oy))
        parts.append('<a:ext cx="{}" cy="{}"/>'.format(ex, ey))
        parts.append("</a:xfrm>")
        parts.append('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>')
        parts.append("</p:spPr>")
        parts.append("</p:pic>")
        parts.append("</mc:Fallback>")
        parts.append("</mc:AlternateContent>")
        parts.append("</p:grpSp>")

    parts.append("</p:spTree>")
    parts.append("</p:cSld>")
    parts.append("<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>")
    return "".join(parts)


def append_timing(slide_xml: str, timing_xml: str) -> str:
    """build_slide_xml で生成した文字列の最後の </p:sld> 直前に timing を差し込む。"""
    needle = "</p:sld>"
    idx = slide_xml.rfind(needle)
    if idx == -1:
        return slide_xml + timing_xml
    return slide_xml[:idx] + timing_xml + slide_xml[idx:]


def close_slide(slide_xml: str) -> str:
    """build_slide_xml だけだと </p:sld> 閉じが入っていないので付ける。"""
    if slide_xml.rstrip().endswith("</p:sld>"):
        return slide_xml
    return slide_xml + "</p:sld>"
