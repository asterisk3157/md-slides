#!/usr/bin/env python3
"""Compose fallback PNGs from each slide's XML into a single image per slide."""
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image

NS = {
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
}

BASE = Path('/Users/hi/pptx_auto/analysis/unpacked/ppt')
OUT_DIR = Path('/Users/hi/pptx_auto/analysis/composed')
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Slide size from presentation.xml
SLIDE_CX = 12188825
SLIDE_CY = 6858000

# Scale: 8000 EMU per pixel -> roughly 1524 x 857 px
SCALE = 8000


def load_rels(slide_num):
    rels_path = BASE / 'slides' / '_rels' / f'slide{slide_num}.xml.rels'
    tree = ET.parse(rels_path)
    root = tree.getroot()
    rels = {}
    for rel in root:
        rid = rel.attrib.get('Id')
        target = rel.attrib.get('Target')
        rels[rid] = target
    return rels


def parse_slide_pics(slide_num):
    """Return list of (image_path, x_emu, y_emu, cx_emu, cy_emu) from <mc:Fallback> <p:pic>."""
    slide_path = BASE / 'slides' / f'slide{slide_num}.xml'
    tree = ET.parse(slide_path)
    root = tree.getroot()
    rels = load_rels(slide_num)

    pics = []
    # Iterate Fallback regions
    for fb in root.iter('{%s}Fallback' % NS['mc']):
        for pic in fb.iter('{%s}pic' % NS['p']):
            blip = pic.find('.//{%s}blip' % NS['a'])
            if blip is None:
                continue
            embed = blip.attrib.get('{%s}embed' % NS['r'])
            if not embed or embed not in rels:
                continue
            target = rels[embed]
            # Target like ../media/imageN.png
            img_path = (BASE / 'slides' / target).resolve()
            xfrm = pic.find('.//{%s}spPr/{%s}xfrm' % (NS['p'], NS['a']))
            if xfrm is None:
                continue
            off = xfrm.find('{%s}off' % NS['a'])
            ext = xfrm.find('{%s}ext' % NS['a'])
            if off is None or ext is None:
                continue
            x = int(off.attrib['x'])
            y = int(off.attrib['y'])
            cx = int(ext.attrib['cx'])
            cy = int(ext.attrib['cy'])
            pics.append((str(img_path), x, y, cx, cy))
    return pics


def compose_slide(slide_num):
    pics = parse_slide_pics(slide_num)
    print(f'Slide {slide_num}: {len(pics)} pictures')

    width = SLIDE_CX // SCALE
    height = SLIDE_CY // SCALE
    canvas = Image.new('RGBA', (width, height), (255, 255, 255, 255))

    for img_path, x, y, cx, cy in pics:
        try:
            im = Image.open(img_path).convert('RGBA')
        except Exception as e:
            print(f'  ! Cannot open {img_path}: {e}')
            continue
        target_w = max(1, cx // SCALE)
        target_h = max(1, cy // SCALE)
        try:
            im_resized = im.resize((target_w, target_h), Image.LANCZOS)
        except Exception as e:
            print(f'  ! Resize fail: {e}')
            continue
        px = x // SCALE
        py = y // SCALE
        canvas.alpha_composite(im_resized, dest=(px, py))

    out_path = OUT_DIR / f'slide{slide_num}.png'
    canvas.convert('RGB').save(out_path, 'PNG', optimize=True)
    print(f'  -> {out_path} ({width}x{height})')


def main():
    for n in range(1, 7):
        compose_slide(n)


if __name__ == '__main__':
    main()
