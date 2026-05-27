// Markdown パーサ (Python handwriting_pptx/md_parser.py の JS 版)。
// 出力: { meta, slides:[{heading:[seg], content:[item]}], warnings, errors }
// seg : string | {kind:'math',formula} | {kind:'bold',parts} | {kind:'span',parts,className}
// item: {type:'bullet'|'paragraph',segments} | {type:'subheading',segments,level}
//       | {type:'blockmath',formula} | {type:'table',header,rows}

const BOLD_RE = /\*\*([^*]+)\*\*/g;
const ITALIC_RE = /(?<!\*)\*(\S(?:[^*\n]*\S)?)\*(?!\*)/g;
const SPAN_OPEN_RE = /<span\s+class\s*=\s*"([^"]*)"\s*>/gi;
const SPAN_TAG_RE = /<span\s+class\s*=\s*"[^"]*"\s*>|<\/span\s*>/gi;
const HEADING_RE = /^#\s+(.+)$/;
const SUBHEADING_RE = /^(#{2,3})\s+(.+)$/;
const BULLET_RE = /^\s*-\s+(.+)$/;
const BAD_BULLET_RE = /^[*+]\s+/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const SEP_CELL_RE = /^:?-{2,}:?$/;

function stripItalic(text) { return text.replace(ITALIC_RE, "$1"); }

function splitBold(text) {
  const segs = [];
  let pos = 0; let m;
  BOLD_RE.lastIndex = 0;
  while ((m = BOLD_RE.exec(text)) !== null) {
    if (m.index > pos) { const pre = stripItalic(text.slice(pos, m.index)); if (pre) segs.push(pre); }
    const inner = stripItalic(m[1]); if (inner) segs.push({ kind: "bold", parts: [inner] });
    pos = m.index + m[0].length;
  }
  if (pos < text.length) { const tail = stripItalic(text.slice(pos)); if (tail) segs.push(tail); }
  return segs;
}

function splitInlineMath(text) {
  const segs = [];
  let buf = "", i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length && text[i + 1] === "$") { buf += "$"; i += 2; continue; }
    if (ch === "$") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\" && j + 1 < text.length) { j += 2; continue; }
        if (text[j] === "$") break;
        j += 1;
      }
      if (j >= text.length) { buf += "$"; i += 1; continue; }
      if (buf) { segs.push(...splitBold(buf)); buf = ""; }
      segs.push({ kind: "math", formula: text.slice(i + 1, j) });
      i = j + 1; continue;
    }
    buf += ch; i += 1;
  }
  if (buf) segs.push(...splitBold(buf));
  return segs;
}

function parseInline(text) {
  const segments = [];
  let pos = 0;
  while (pos < text.length) {
    SPAN_OPEN_RE.lastIndex = pos;
    const m = SPAN_OPEN_RE.exec(text);
    if (m === null) { segments.push(...splitInlineMath(text.slice(pos))); break; }
    if (m.index > pos) segments.push(...splitInlineMath(text.slice(pos, m.index)));
    const className = m[1].trim();
    let depth = 1, innerEnd = null, closeEnd = null;
    SPAN_TAG_RE.lastIndex = m.index + m[0].length;
    let tm;
    while ((tm = SPAN_TAG_RE.exec(text)) !== null) {
      if (tm[0].toLowerCase().startsWith("<span")) depth += 1;
      else { depth -= 1; if (depth === 0) { innerEnd = tm.index; closeEnd = tm.index + tm[0].length; break; } }
    }
    if (innerEnd === null) { innerEnd = text.length; closeEnd = text.length; }
    segments.push({ kind: "span", parts: parseInline(text.slice(m.index + m[0].length, innerEnd)), className });
    pos = closeEnd;
  }
  return segments;
}

function parseInlineFlowDict(s) {
  const out = {};
  s = s.trim();
  if (s.startsWith("{") && s.endsWith("}")) s = s.slice(1, -1);
  for (const pair of s.split(",")) {
    const idx = pair.indexOf(":");
    if (idx < 0) continue;
    const k = pair.slice(0, idx).trim();
    let v = pair.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (v.toLowerCase() === "true" || v.toLowerCase() === "false") out[k] = v.toLowerCase() === "true";
    else out[k] = v;
  }
  return out;
}

function parseFrontmatter(lines) {
  if (!lines.length || lines[0].trim() !== "---") return [{}, 0];
  let end = null;
  for (let idx = 1; idx < lines.length; idx++) if (lines[idx].trim() === "---") { end = idx; break; }
  if (end === null) return [{}, 0];
  const meta = {};
  const fm = lines.slice(1, end);
  let idx = 0;
  while (idx < fm.length) {
    const s = fm[idx].trim(); idx += 1;
    if (!s || s.startsWith("#")) continue;
    const ci = s.indexOf(":"); if (ci < 0) continue;
    const key = s.slice(0, ci).trim();
    let val = s.slice(ci + 1).trim();
    if (key === "styles" && val === "") {
      const styles = {};
      while (idx < fm.length) {
        const child = fm[idx];
        if (child.trim() === "" || child.trim().startsWith("#")) { idx += 1; continue; }
        if (!(child.startsWith(" ") || child.startsWith("\t"))) break;
        const cs = child.trim();
        const cci = cs.indexOf(":"); if (cci < 0) { idx += 1; continue; }
        styles[cs.slice(0, cci).trim()] = parseInlineFlowDict(cs.slice(cci + 1));
        idx += 1;
      }
      meta.styles = styles; continue;
    }
    // overrides: は JSON (空間オーバーライド)。エディタが書き込む。
    if (key === "overrides") {
      try { meta.overrides = JSON.parse(val); } catch (e) { meta.overrides = {}; }
      continue;
    }
    val = val.replace(/^["']|["']$/g, "");
    if (/^-?\d+$/.test(val)) meta[key] = parseInt(val, 10);
    else if (/^-?\d*\.\d+$/.test(val)) meta[key] = parseFloat(val);
    else meta[key] = val;
  }
  return [meta, end + 1];
}

function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isTableSep(line) {
  const s = line.trim();
  if (!s.includes("|") && !s.includes("-")) return false;
  const cells = splitTableRow(line);
  if (!cells.length) return false;
  return cells.every((c) => c.trim() === "" || SEP_CELL_RE.test(c.trim()));
}

// baseLine: この chunk の先頭行が元テキスト全体で何行目か (0-index)。
// 各ブロック/見出しに src:[globalStart, globalEnd) (終端排他) を付与する。
// 描画には使われず、エディタが「選択ブロック → 元MD該当行」を逆引きするための情報。
function parseSlide(lines, slideIdx, doc, baseLine = 0) {
  const slide = { heading: [], content: [] };
  let seenHeading = false;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i].replace(/\s+$/, "");
    const s = line.trim();
    if (!s) { i += 1; continue; }
    if ((s.startsWith("<!--") && s.endsWith("-->")) || (s.startsWith("(*") && s.endsWith("*)"))) { i += 1; continue; }

    let m = HEADING_RE.exec(line);
    if (m) {
      if (seenHeading) doc.errors.push(`slide ${slideIdx}: multiple headings`);
      else { slide.heading = parseInline(m[1].trim()); slide.headingSrc = [baseLine + i, baseLine + i + 1]; seenHeading = true; }
      i += 1; continue;
    }
    m = SUBHEADING_RE.exec(line);
    if (m) { slide.content.push({ type: "subheading", segments: parseInline(m[2].trim()), level: m[1].length, src: [baseLine + i, baseLine + i + 1] }); i += 1; continue; }

    if (s.startsWith("$$")) {
      const mathStart = i;
      const after = s.slice(2).trim();
      if (after.endsWith("$$") && after.length >= 2) { slide.content.push({ type: "blockmath", formula: after.slice(0, -2).trim(), src: [baseLine + mathStart, baseLine + i + 1] }); i += 1; continue; }
      const buf = after ? [after] : [];
      i += 1; let closed = false;
      while (i < n) {
        const ln = lines[i].trim();
        if (ln.endsWith("$$")) { const inner = ln.slice(0, -2).trim(); if (inner) buf.push(inner); closed = true; i += 1; break; }
        buf.push(ln); i += 1;
      }
      slide.content.push({ type: "blockmath", formula: buf.filter(Boolean).join(" "), src: [baseLine + mathStart, baseLine + i] });
      if (!closed) doc.warnings.push(`slide ${slideIdx}: 閉じていない $$ ブロック`);
      continue;
    }

    if (TABLE_ROW_RE.test(line) && i + 1 < n && isTableSep(lines[i + 1])) {
      const tableStart = i;
      const header = splitTableRow(line).map((c) => parseInline(c));
      i += 2;
      const rows = [];
      while (i < n && TABLE_ROW_RE.test(lines[i].replace(/\s+$/, "")) && !isTableSep(lines[i])) {
        rows.push(splitTableRow(lines[i]).map((c) => parseInline(c)));
        i += 1;
      }
      slide.content.push({ type: "table", header, rows, src: [baseLine + tableStart, baseLine + i] });
      continue;
    }

    // メモ (note): `> テキスト` → 本文流れに小さめ＋グレーで配置
    if (s.startsWith(">")) {
      const noteStr = s.replace(/^>\s?/, "").trim();
      slide.content.push({ type: "note", segments: parseInline(noteStr), src: [baseLine + i, baseLine + i + 1] });
      i += 1; continue;
    }

    m = BULLET_RE.exec(line);
    if (m) {
      const contentStr = m[1].trim();
      if (contentStr.startsWith("(*") && contentStr.endsWith("*)")) { i += 1; continue; }
      slide.content.push({ type: "bullet", segments: parseInline(contentStr), src: [baseLine + i, baseLine + i + 1] });
      i += 1; continue;
    }
    if (BAD_BULLET_RE.test(line)) { doc.errors.push(`slide ${slideIdx}: only '- ' bullet marker supported (got ${line[0]})`); i += 1; continue; }

    slide.content.push({ type: "paragraph", segments: parseInline(s), src: [baseLine + i, baseLine + i + 1] });
    i += 1;
  }
  if (!seenHeading) { doc.errors.push(`slide ${slideIdx}: heading required`); return null; }
  return slide;
}

export function parseMD(text) {
  const doc = { meta: {}, slides: [], warnings: [], errors: [] };
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n");
  const [meta, bodyStart] = parseFrontmatter(lines);
  doc.meta = meta;
  const bodyLines = lines.slice(bodyStart);
  // スライド分割: '---' 区切り、または新しい H1 見出し ('# ') でスライドを開始。
  // (--- を書かなくても # を並べるだけで複数スライドにできる)
  const chunks = [[]];
  const chunkStarts = [bodyStart]; // 各 chunk 先頭行の元テキスト全体での行番号 (0-index)
  for (let j = 0; j < bodyLines.length; j++) {
    const line = bodyLines[j];
    const gIdx = bodyStart + j;
    if (line.trim() === "---" && line.replace(/^\s+/, "").startsWith("---")) { chunks.push([]); chunkStarts.push(gIdx + 1); continue; }
    if (HEADING_RE.test(line) && chunks[chunks.length - 1].some((ln) => ln.trim())) { chunks.push([]); chunkStarts.push(gIdx); }
    chunks[chunks.length - 1].push(line);
  }
  let slideIdx = 0;
  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    slideIdx += 1;
    if (!chunk.some((ln) => ln.trim())) continue;
    const slide = parseSlide(chunk, slideIdx, doc, chunkStarts[c]);
    if (slide !== null) doc.slides.push(slide);
  }
  return doc;
}
