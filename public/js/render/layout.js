// テキスト行レイアウト (Python handwriting_pptx/layout.py の JS 版)。
// PlacedStroke: { points_cm:[[x,y],...], pressures, bold, color }
// Glyph:        { char, strokes:[{points:[[x,y],...]}], advance, anchors, coord_space }
// Segment:      string | {kind:'math',formula} | {kind:'bold',parts} | {kind:'span',parts,className}

import { buildStyles, resolveClass, StyleError } from "./theme.js";
import { fallbackBulletGlyph, fallbackUnknownGlyph } from "./dict.js";

export const CHAR_GAP = 0.18; // 文字間 (font_size 比)。Python layout._CHAR_GAP と一致。

export function strokeToPlaced(stroke, ox, oy, size, pressures, bold, color) {
  const pts = stroke.points.map(([x, y]) => [ox + x * size, oy + y * size]);
  return { points_cm: pts, pressures: pressures || null, bold: !!bold, color: color || null };
}

export function bboxOfPlaced(strokes) {
  let xs = [], ys = [];
  for (const s of strokes) for (const [x, y] of s.points_cm) { xs.push(x); ys.push(y); }
  if (!xs.length) return [0, 0, 0, 0];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function isMath(s) { return s && typeof s === "object" && s.kind === "math"; }
function isBold(s) { return s && typeof s === "object" && s.kind === "bold"; }
function isSpan(s) { return s && typeof s === "object" && s.kind === "span"; }

export function flatten(segments, styles, boldFlag = false, color = null) {
  if (!styles) styles = buildStyles();
  const out = [];
  for (const seg of segments) {
    if (isBold(seg)) {
      out.push(...flatten(seg.parts, styles, true, color));
    } else if (isSpan(seg)) {
      let st;
      try { st = resolveClass(seg.className, styles); }
      catch (e) { if (e instanceof StyleError) st = { color: null, bold: false }; else throw e; }
      const newColor = st.color ? st.color : color;
      const newBold = boldFlag || st.bold;
      out.push(...flatten(seg.parts, styles, newBold, newColor));
    } else {
      out.push([seg, boldFlag, color]);
    }
  }
  return out;
}

export function placeChars(chars, placed, cursorX, cursorY, fontSize, useMetrics, bold, color, M, elements) {
  for (const g of chars) {
    if (!g.strokes || g.strokes.length === 0) {
      cursorX += g.advance * fontSize;
      continue;
    }
    // 読点・カンマは左に少し余白を空ける (前の字に詰まりすぎないように)
    if (g.char === "," || g.char === "、") cursorX += fontSize * 0.10;
    const elStart = placed.length;
    // em 座標 (登録マスの基準線基準): 描いた占有比率・ベースラインをそのまま反映。
    // y=0 が cap 線 (= 行の上端 cursorY), y=1 が baseline (= cursorY+fontSize)。
    // char_metrics は使わず、大文字小文字/記号/小書き仮名の大小は描き方で決まる。
    if (g.coord_space === "em") {
      const exs = [];
      for (const s of g.strokes) for (const p of s.points) exs.push(p[0]);
      const eMin = exs.length ? Math.min(...exs) : 0.0;
      const eMax = exs.length ? Math.max(...exs) : 0.0;
      const xOrigin = cursorX - eMin * fontSize;
      for (const s of g.strokes) {
        placed.push(strokeToPlaced(s, xOrigin, cursorY, fontSize, null, bold, color));
      }
      if (elements && placed.length > elStart) elements.push({ start: elStart, end: placed.length });
      cursorX += (eMax - eMin) * fontSize + fontSize * CHAR_GAP;
      continue;
    }
    let relSize, valign;
    if (useMetrics) [relSize, valign] = M.charMetrics(g.char);
    else if (M.isSmallKana(g.char)) [relSize, valign] = M.charMetrics(g.char);
    else { relSize = 1.0; valign = "top"; }
    const glyphSize = fontSize * relSize;
    let yOffset;
    if (valign === "middle") yOffset = (fontSize - glyphSize) / 2;
    else if (valign === "bottom") yOffset = fontSize - glyphSize;
    else yOffset = 0.0;

    const nxs = [];
    for (const s of g.strokes) for (const p of s.points) nxs.push(p[0]);
    const nxMin = nxs.length ? Math.min(...nxs) : 0.0;
    const nxMax = nxs.length ? Math.max(...nxs) : 1.0;
    const xOrigin = cursorX - nxMin * glyphSize;
    for (const s of g.strokes) {
      placed.push(strokeToPlaced(s, xOrigin, cursorY + yOffset, glyphSize, null, bold, color));
    }
    if (elements && placed.length > elStart) elements.push({ start: elStart, end: placed.length });
    const inkW = (nxMax - nxMin) * glyphSize;
    cursorX += inkW + fontSize * CHAR_GAP;
  }
  return cursorX;
}

// placeFormula は formula.js から注入 (循環回避のため引数で受ける)
export function layoutTextLine(text, dictionary, xCm, yCm, fontSizeCm, opts) {
  opts = opts || {};
  const includeBullet = !!opts.includeBullet;
  const useMetrics = opts.useMetrics !== undefined ? opts.useMetrics : true;
  const styles = opts.styles || null;
  const M = opts.M;
  const placeFormula = opts.placeFormula; // (formula,x,y,size,dict,M)->[placed,width]

  const segments = Array.isArray(text) ? text : [text];
  let cursorX = xCm, cursorY = yCm;
  const placed = [];
  const elements = []; // 文字単位編集用: [{start,end (placed index range)}]

  if (includeBullet) {
    const bullet = dictionary.glyph("・") || fallbackBulletGlyph();
    const bulletSize = fontSizeCm * 0.30;
    const bulletYOff = (fontSizeCm - bulletSize) / 2;
    const st = placed.length;
    for (const s of bullet.strokes) placed.push(strokeToPlaced(s, cursorX, cursorY + bulletYOff, bulletSize, null, false, null));
    if (placed.length > st) elements.push({ start: st, end: placed.length });
    cursorX += bulletSize + fontSizeCm * 0.5;
  }

  const labelParts = [];
  const runs = [];        // テキストモード描画用: [{text,bold,color} | {math,formula,bold,color}]
  let hasMath = false;
  for (const [seg, bold, color] of flatten(segments, styles)) {
    if (isMath(seg)) {
      hasMath = true;
      runs.push({ math: true, formula: seg.formula, bold, color });
      const st = placed.length;
      const [fp, fw, fparts] = placeFormula(seg.formula, cursorX, cursorY, fontSizeCm, dictionary, M);
      for (const ps of fp) { if (bold) ps.bold = true; if (color && ps.color === null) ps.color = color; }
      placed.push(...fp);
      if (placed.length > st) {
        // 数式は parts (分子/分母/上限/下限/本体 等) ごとに要素化して個別編集可能にする
        if (fparts && fparts.length) {
          const covered = new Set();
          for (const p of fparts) {
            const a = st + p.start, b = st + p.end;
            if (b > a) { elements.push({ start: a, end: b }); for (let k = a; k < b; k++) covered.add(k); }
          }
          // どの part にも属さない余りストロークを連続範囲ごとに1要素化 (保険)
          let restStart = -1;
          for (let k = st; k <= placed.length; k++) {
            const inRest = k < placed.length && !covered.has(k);
            if (inRest) { if (restStart < 0) restStart = k; }
            else if (restStart >= 0) { elements.push({ start: restStart, end: k }); restStart = -1; }
          }
        } else {
          elements.push({ start: st, end: placed.length });
        }
      }
      cursorX += fw;
      labelParts.push(bold ? `**$${seg.formula}$**` : `$${seg.formula}$`);
      continue;
    }
    const textSeg = typeof seg === "string" ? seg : String(seg);
    labelParts.push(bold ? `**${textSeg}**` : textSeg);
    runs.push({ text: textSeg, bold, color });
    const chars = [];
    for (const ch of textSeg) {
      if (ch === " " || ch === "　") { chars.push({ char: ch, strokes: [], advance: ch === " " ? 0.5 : 1.0 }); continue; }
      let g = dictionary.glyph(ch);
      if (g === null) g = fallbackUnknownGlyph(ch);
      chars.push(g);
    }
    cursorX = placeChars(chars, placed, cursorX, cursorY, fontSizeCm, useMetrics, bold, color, M, elements);
  }

  let w = Math.max(0.0, cursorX - xCm);
  let h = fontSizeCm;
  let newY = yCm;
  if (placed.length) {
    const ys = [];
    for (const s of placed) for (const p of s.points_cm) ys.push(p[1]);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    newY = Math.min(yCm, yMin - 0.05);
    h = Math.max(fontSizeCm, yMax - newY + 0.05);
  }
  // 各要素の bbox を計算
  for (const el of elements) bboxForElement(el, placed);
  // テキストモード描画用のメタ (手書き描画には未使用・出力に影響しない)
  return { placed, elements, x_cm: xCm, y_cm: newY, w_cm: w, h_cm: h, label: labelParts.join(""),
           fontSizeCm, runs, hasMath, includeBullet };
}

function bboxForElement(el, placed) {
  let xs = [], ys = [];
  for (let i = el.start; i < el.end; i++) for (const [x, y] of placed[i].points_cm) { xs.push(x); ys.push(y); }
  if (!xs.length) { el.x_cm = 0; el.y_cm = 0; el.w_cm = 0; el.h_cm = 0; return; }
  const xmin = Math.min(...xs), ymin = Math.min(...ys), xmax = Math.max(...xs), ymax = Math.max(...ys);
  el.x_cm = xmin; el.y_cm = ymin; el.w_cm = xmax - xmin; el.h_cm = ymax - ymin;
}
