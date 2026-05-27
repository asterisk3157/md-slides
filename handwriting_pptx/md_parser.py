"""Markdown パーサ (docs/md_spec.md 準拠)。

入力: MD文字列
出力: MDDocument (frontmatter + slides)

各スライドは:
- heading: List[str | Math]  ← インライン $...$ 数式を分割
- bullets: List[List[str | Math]]  ← 各箇条書きも同様
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Union, Dict, Any, Tuple

from .api import Math, Bold, Span


# テキスト / 数式 / 太字 / 装飾スパン のセグメント
Segment = Union[str, Math, Bold, Span]


# ---------- コンテンツアイテム (スライド本文の構成要素) ----------

@dataclass
class Bullet:
    """箇条書き 1 項目。"""
    segments: List[Segment] = field(default_factory=list)


@dataclass
class Paragraph:
    """地の文 (箇条書きマーカー無しの 1 行)。"""
    segments: List[Segment] = field(default_factory=list)


@dataclass
class BlockMath:
    """ブロック数式 `$$...$$` (中央寄せの式)。"""
    formula: str = ""


@dataclass
class SubHeading:
    """小見出し `##` / `###`。"""
    segments: List[Segment] = field(default_factory=list)
    level: int = 2


@dataclass
class Note:
    """メモ `> ...` (本文流れに小さめ・グレーで配置)。"""
    segments: List[Segment] = field(default_factory=list)


@dataclass
class Table:
    """表 (増減表など)。header + rows。各セルは Segment 列。"""
    header: List[List[Segment]] = field(default_factory=list)
    rows: List[List[List[Segment]]] = field(default_factory=list)


ContentItem = Union[Bullet, Paragraph, BlockMath, SubHeading, Note, Table]


@dataclass
class SlideMD:
    heading: List[Segment] = field(default_factory=list)
    content: List[ContentItem] = field(default_factory=list)

    @property
    def bullets(self) -> List[List[Segment]]:
        """後方互換: content 中の Bullet の segments 列を返す。"""
        return [c.segments for c in self.content if isinstance(c, Bullet)]


@dataclass
class MDDocument:
    meta: Dict[str, Any] = field(default_factory=dict)
    slides: List[SlideMD] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)


_BOLD_RE = re.compile(r"\*\*([^*]+)\*\*")
_ITALIC_RE = re.compile(r"(?<!\*)\*(\S(?:[^*\n]*\S)?)\*(?!\*)")


def _strip_italic(text: str) -> str:
    """*italic* マーカーのみ剥がす (手書きでは斜体表現しない)。"""
    return _ITALIC_RE.sub(r"\1", text)


def _split_bold(text: str) -> List[Segment]:
    """テキスト内の **bold** を Bold セグメントに分割。

    数式は事前に Math セグメントに分割済みなので、ここでは純粋テキストのみ扱う。
    italic マーカー *...* は中身をそのまま残してマーカーだけ剥がす。
    """
    segments: List[Segment] = []
    pos = 0
    for m in _BOLD_RE.finditer(text):
        if m.start() > pos:
            pre = _strip_italic(text[pos:m.start()])
            if pre:
                segments.append(pre)
        inner = _strip_italic(m.group(1))
        if inner:
            segments.append(Bold(inner))
        pos = m.end()
    if pos < len(text):
        tail = _strip_italic(text[pos:])
        if tail:
            segments.append(tail)
    return segments


def _split_inline_math(text: str) -> List[Segment]:
    """テキスト内の $...$ を Math セグメントに分割。

    エスケープ \\$ は文字 $ として残す。
    閉じていない $ は警告対象だが、ここでは raw 文字として返す。
    テキスト部分は **bold** / *italic* マーカーを剥がしてから返す。
    """
    segments: List[Segment] = []
    buf = ""
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "\\" and i + 1 < len(text) and text[i + 1] == "$":
            buf += "$"
            i += 2
            continue
        if ch == "$":
            # find matching $
            j = i + 1
            while j < len(text):
                if text[j] == "\\" and j + 1 < len(text):
                    j += 2
                    continue
                if text[j] == "$":
                    break
                j += 1
            if j >= len(text):
                # 閉じていない $: そのまま raw 文字扱い
                buf += "$"
                i += 1
                continue
            # buf を text segment として flush (Boldを抽出)
            if buf:
                segments.extend(_split_bold(buf))
                buf = ""
            formula = text[i + 1:j]
            segments.append(Math(formula))
            i = j + 1
            continue
        buf += ch
        i += 1
    if buf:
        segments.extend(_split_bold(buf))
    return segments


_SPAN_OPEN_RE = re.compile(r'<span\s+class\s*=\s*"([^"]*)"\s*>', re.IGNORECASE)
_SPAN_TAG_RE = re.compile(r'<span\s+class\s*=\s*"[^"]*"\s*>|</span\s*>', re.IGNORECASE)


def _parse_inline(text: str) -> List[Segment]:
    """インライン要素をパース: `<span class="...">` を Span に、その他は数式+太字へ。

    span はネスト可。span 内の数式・太字も再帰的に処理する。
    """
    segments: List[Segment] = []
    pos = 0
    while pos < len(text):
        m = _SPAN_OPEN_RE.search(text, pos)
        if m is None:
            segments.extend(_split_inline_math(text[pos:]))
            break
        # span の前のテキスト
        if m.start() > pos:
            segments.extend(_split_inline_math(text[pos:m.start()]))
        class_name = m.group(1).strip()
        # ネストを考慮して対応する </span> を探す
        depth = 1
        inner_end = None
        close_end = None
        for tm in _SPAN_TAG_RE.finditer(text, m.end()):
            if tm.group(0).lower().startswith("<span"):
                depth += 1
            else:
                depth -= 1
                if depth == 0:
                    inner_end = tm.start()
                    close_end = tm.end()
                    break
        if inner_end is None:
            # 閉じていない span: 残り全部を中身扱い
            inner_end = len(text)
            close_end = len(text)
        inner = _parse_inline(text[m.end():inner_end])
        segments.append(Span(inner, class_name))
        pos = close_end
    return segments


def _parse_inline_flow_dict(s: str) -> Dict[str, Any]:
    """`{ color: red, bold: true }` のような YAML inline-flow を簡易パース。"""
    out: Dict[str, Any] = {}
    s = s.strip()
    if s.startswith("{") and s.endswith("}"):
        s = s[1:-1]
    for pair in s.split(","):
        if ":" not in pair:
            continue
        k, _, v = pair.partition(":")
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if v.lower() in ("true", "false"):
            out[k] = (v.lower() == "true")
        else:
            out[k] = v
    return out


def _parse_frontmatter(lines: List[str]) -> Tuple[Dict[str, Any], int]:
    """先頭が '---' で始まり、次の '---' まで を YAML として簡易パース。

    使えるキーは限定的なので、自前で `key: value` 形式のみ対応 (YAML パーサ不要)。
    """
    if not lines or lines[0].strip() != "---":
        return {}, 0
    # 次の '---' を探す
    end = None
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            end = idx
            break
    if end is None:
        return {}, 0
    meta: Dict[str, Any] = {}
    fm_lines = lines[1:end]
    idx = 0
    while idx < len(fm_lines):
        raw = fm_lines[idx]
        s = raw.strip()
        idx += 1
        if not s or s.startswith("#"):
            continue
        if ":" not in s:
            continue
        key, _, val = s.partition(":")
        key = key.strip()
        val = val.strip()

        # styles: ネストブロック (子は `name: { ... }` の inline-flow)
        if key == "styles" and val == "":
            styles: Dict[str, Any] = {}
            while idx < len(fm_lines):
                child = fm_lines[idx]
                if child.strip() == "" or child.strip().startswith("#"):
                    idx += 1
                    continue
                # インデントが無くなったらブロック終了
                if not (child.startswith(" ") or child.startswith("\t")):
                    break
                cs = child.strip()
                if ":" not in cs:
                    idx += 1
                    continue
                cname, _, cval = cs.partition(":")
                styles[cname.strip()] = _parse_inline_flow_dict(cval)
                idx += 1
            meta["styles"] = styles
            continue

        # クォート除去
        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        # 数値かどうか判定
        try:
            if "." in val:
                meta[key] = float(val)
            else:
                meta[key] = int(val)
        except ValueError:
            meta[key] = val
    return meta, end + 1  # end の次行から本文


def parse_md(text: str) -> MDDocument:
    """MD文字列をパースする。

    エラーは doc.errors に蓄積し、致命的でなければ続行する。
    """
    doc = MDDocument()
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")

    # フロントマター
    meta, body_start = _parse_frontmatter(lines)
    doc.meta = meta
    body_lines = lines[body_start:]

    # スライド分割: 行頭 '---' で区切る (前後空行は許容)。
    # 加えて、新しい H1 見出し ('# ') もスライド開始とみなす
    # (--- 区切りを書かなくても # を並べるだけで複数スライドにできる)。
    # ただし frontmatter は既に処理済み
    slide_chunks: List[List[str]] = [[]]
    for line in body_lines:
        if line.strip() == "---" and line.lstrip().startswith("---"):
            slide_chunks.append([])
            continue
        if _HEADING_RE.match(line) and any(ln.strip() for ln in slide_chunks[-1]):
            slide_chunks.append([])
        slide_chunks[-1].append(line)

    for slide_idx, chunk in enumerate(slide_chunks, start=1):
        # 空ブロックはスキップ
        if not any(ln.strip() for ln in chunk):
            continue
        slide = _parse_slide(chunk, slide_idx, doc)
        if slide is not None:
            doc.slides.append(slide)

    return doc


_HEADING_RE = re.compile(r"^#\s+(.+)$")
_SUBHEADING_RE = re.compile(r"^(#{2,3})\s+(.+)$")
_BULLET_RE = re.compile(r"^\s*-\s+(.+)$")  # 先頭インデント許容 (ネストは平坦化)
_BAD_BULLET_RE = re.compile(r"^[\*\+]\s+")
_TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")
_TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{2,}.*$")  # |---|---| 区切り行


def _split_table_row(line: str) -> List[str]:
    """`| a | b | c |` を ["a","b","c"] に分割 (前後の空 | を除く)。"""
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip() for c in s.split("|")]


def _is_table_sep(line: str) -> bool:
    s = line.strip()
    if "|" not in s and "-" not in s:
        return False
    # 各セルが --- 系か
    cells = _split_table_row(line)
    if not cells:
        return False
    return all(re.match(r"^:?-{2,}:?$", c.strip()) for c in cells if c.strip() != "")


def _parse_slide(lines: List[str], slide_idx: int, doc: MDDocument) -> "SlideMD | None":
    slide = SlideMD()
    seen_heading = False
    i = 0
    n = len(lines)
    while i < n:
        raw = lines[i]
        line = raw.rstrip()
        s = line.strip()
        if not s:
            i += 1
            continue

        # コメント行 ( <!-- ... --> や (* ... *) 図注釈 ) は静かにスキップ
        if (s.startswith("<!--") and s.endswith("-->")) or (s.startswith("(*") and s.endswith("*)")):
            i += 1
            continue

        # 見出し (# )
        m = _HEADING_RE.match(line)
        if m:
            if seen_heading:
                doc.errors.append(f"slide {slide_idx}: multiple headings")
            else:
                slide.heading = _parse_inline(m.group(1).strip())
                seen_heading = True
            i += 1
            continue

        # 小見出し (## / ###)
        m = _SUBHEADING_RE.match(line)
        if m:
            level = len(m.group(1))
            slide.content.append(SubHeading(_parse_inline(m.group(2).strip()), level=level))
            i += 1
            continue

        # ブロック数式 $$ ... $$
        if s.startswith("$$"):
            after = s[2:].strip()
            if after.endswith("$$") and len(after) >= 2:
                # 1行完結: $$ x^2 $$
                slide.content.append(BlockMath(after[:-2].strip()))
                i += 1
                continue
            if after:
                # $$ で始まり中身が同一行 (閉じは後続行)
                buf = [after]
            else:
                buf = []
            i += 1
            closed = False
            while i < n:
                ln = lines[i].strip()
                if ln.endswith("$$"):
                    inner = ln[:-2].strip()
                    if inner:
                        buf.append(inner)
                    closed = True
                    i += 1
                    break
                buf.append(ln)
                i += 1
            slide.content.append(BlockMath(" ".join(b for b in buf if b)))
            if not closed:
                doc.warnings.append(f"slide {slide_idx}: 閉じていない $$ ブロック")
            continue

        # 表 (| ... |  +  次行が |---|)
        if _TABLE_ROW_RE.match(line) and i + 1 < n and _is_table_sep(lines[i + 1]):
            header = [_parse_inline(c) for c in _split_table_row(line)]
            i += 2  # ヘッダ行 + 区切り行
            rows: List[List[List[Segment]]] = []
            while i < n and _TABLE_ROW_RE.match(lines[i].rstrip()) and not _is_table_sep(lines[i]):
                rows.append([_parse_inline(c) for c in _split_table_row(lines[i])])
                i += 1
            slide.content.append(Table(header=header, rows=rows))
            continue

        # メモ (> ...): 本文流れに小さめ＋グレー
        if s.startswith(">"):
            note_str = re.sub(r"^>\s?", "", s).strip()
            slide.content.append(Note(_parse_inline(note_str)))
            i += 1
            continue

        # 箇条書き (- )
        m = _BULLET_RE.match(line)
        if m:
            content_str = m.group(1).strip()
            # 中身が丸ごと注釈コメント (* ... *) ならスキップ
            if content_str.startswith("(*") and content_str.endswith("*)"):
                i += 1
                continue
            slide.content.append(Bullet(_parse_inline(content_str)))
            i += 1
            continue

        # 不正な箇条書き記号
        if _BAD_BULLET_RE.match(line):
            doc.errors.append(f"slide {slide_idx}: only '- ' bullet marker supported (got {line[0]})")
            i += 1
            continue

        # その他: 地の文 (Paragraph) として扱う
        slide.content.append(Paragraph(_parse_inline(s)))
        i += 1

    if not seen_heading:
        doc.errors.append(f"slide {slide_idx}: heading required")
        return None
    return slide


def extract_chars(doc: MDDocument) -> List[str]:
    """MDドキュメントに含まれる全文字 (テキスト+数式中の文字) をユニーク化して返す。

    辞書未登録チェック (audit) 用。
    """
    from .formula import parse_formula

    seen = set()
    chars: List[str] = []

    def add_text(text: str):
        for c in text:
            if c in " \t\n　":
                continue
            if c not in seen:
                seen.add(c)
                chars.append(c)

    def add_segments(segs: List[Segment]):
        for s in segs:
            if isinstance(s, Math):
                # 数式パースして atom 抽出
                exprs = parse_formula(s.formula)
                _walk_expr(exprs)
            elif isinstance(s, (Bold, Span)):
                add_segments(s.parts)
            else:
                add_text(s)

    def _walk_expr(exprs):
        for e in exprs:
            if e.base:
                add_text(e.base)
            if e.children:
                _walk_expr(e.children)
            if e.sub:
                _walk_expr(e.sub)
            if e.sup:
                _walk_expr(e.sup)
            if e.arg:
                _walk_expr(e.arg)
            if e.frac:
                _walk_expr(e.frac[0])
                _walk_expr(e.frac[1])
            if e.vec:
                _walk_expr(e.vec)
            # fn_name は文字単位で atom 扱い
            if getattr(e, "fn_name", None):
                add_text(e.fn_name)

    def add_item(item):
        if isinstance(item, (Bullet, Paragraph, SubHeading)):
            add_segments(item.segments)
        elif isinstance(item, BlockMath):
            _walk_expr(parse_formula(item.formula))
        elif isinstance(item, Table):
            for cell in item.header:
                add_segments(cell)
            for row in item.rows:
                for cell in row:
                    add_segments(cell)

    for slide in doc.slides:
        add_segments(slide.heading)
        for item in slide.content:
            add_item(item)
    return chars


def validate_styles(doc: MDDocument, styles: Dict[str, Any]) -> List[str]:
    """全 Span の class が styles に定義済みか検証。未定義クラスのエラーリストを返す。"""
    from . import theme
    errs: List[str] = []

    def walk(segs):
        for s in segs:
            if isinstance(s, Span):
                for cls in s.class_name.split():
                    if cls in theme.RESERVED_CLASSES:
                        continue
                    if cls not in styles:
                        errs.append(f"未定義の装飾クラス: '{cls}'")
                walk(s.parts)
            elif isinstance(s, Bold):
                walk(s.parts)

    def walk_item(item):
        if isinstance(item, (Bullet, Paragraph, SubHeading)):
            walk(item.segments)
        elif isinstance(item, Table):
            for cell in item.header:
                walk(cell)
            for row in item.rows:
                for cell in row:
                    walk(cell)

    for slide in doc.slides:
        walk(slide.heading)
        for item in slide.content:
            walk_item(item)
    return errs
