// テキストモード配置層 (辞書非依存・フォント計測ベース)。
// 手書き版 (layout.js/flow.js) の「ストローク配置」に対し、こちらは
// 「フォントで字送り」する前提の抽象配置を出力する。要件 §5/§8:
// layout は "文字 C を (x,y) にサイズ s で置く" 抽象配置を出力し、
// renderer (svg/pptx) がフォントで描く。
//
// 出力 Block: { type, x_cm, y_cm, w_cm, h_cm, items:[RenderItem], label }
// RenderItem (cm座標, y は下向き):
//   { t:"text", x, y, size, text, bold, color, italic }   // y = ベースライン
//   { t:"line", x1, y1, x2, y2, w }                        // 直線 (分数バー/罫線等)
//   { t:"poly", pts:[[x,y],...], w }                       // 折れ線 (矢印等)
//   { t:"disc", cx, cy, r, color }                         // 塗り円 (行頭マーク等)

import { flatten } from "./layout.js";
import { buildStyles } from "./theme.js";

// ベースライン比: 字面ボックス上端から baseline までを font_size の比で。
export const ASCENT = 0.82;
const CHAR_GAP = 0.0; // フォント字送りに任せるので追加の文字間は入れない
const NOTE_COLOR = "#808080";

// ---- フォント計測 (canvas)。ブラウザ外では近似フォールバック ----
let _ctx = null;
function measureCtx() {
  if (_ctx !== null) return _ctx;
  try { _ctx = (typeof document !== "undefined") ? document.createElement("canvas").getContext("2d") : false; }
  catch (_) { _ctx = false; }
  return _ctx;
}
const MEASURE_PX = 100; // 1cm=100px で計測 (比でしか効かないので解像度は十分)

export function createMeasure(fontFamily) {
  const fam = fontFamily || "sans-serif";
  return function measure(text, sizeCm, bold) {
    if (!text) return 0;
    const ctx = measureCtx();
    if (ctx) {
      ctx.font = `${bold ? "bold " : ""}${(sizeCm * MEASURE_PX).toFixed(2)}px ${fam}`;
      return ctx.measureText(text).width / MEASURE_PX;
    }
    // フォールバック: ASCII ≈ 0.55em, それ以外(CJK等) ≈ 1.0em
    let w = 0;
    for (const ch of text) w += (ch.codePointAt(0) < 0x2000 ? 0.55 : 1.0) * sizeCm;
    return w * (bold ? 1.03 : 1);
  };
}

// ---- 1行(セグメント列)のフォント配置 ----
// segments: parseInline 由来 (string | {kind:'math'|'bold'|'span'})
// 返り値 Block (items は cm 絶対座標)。placeFormula(src,x,yTop,size,bold,color)->{items,width} は数式描画器(注入)。
export function layoutLine(segments, xCm, yTopCm, sizeCm, opts) {
  opts = opts || {};
  const styles = opts.styles || buildStyles();
  const measure = opts.measure;
  const placeFormula = opts.placeFormula;
  const includeBullet = !!opts.includeBullet;
  const items = [];
  let cursorX = xCm;
  const baseY = yTopCm + sizeCm * ASCENT;
  let yTopMin = yTopCm, yBotMax = yTopCm + sizeCm;
  const labelParts = [];

  if (includeBullet) {
    const r = sizeCm * 0.10;
    items.push({ t: "disc", cx: cursorX + sizeCm * 0.16, cy: yTopCm + sizeCm * 0.5, r, color: opts.bulletColor || null });
    cursorX += sizeCm * 0.55;
  }

  const segArr = Array.isArray(segments) ? segments : [segments];
  for (const [seg, bold, color] of flatten(segArr, styles)) {
    if (seg && typeof seg === "object" && seg.kind === "math") {
      labelParts.push(bold ? `**$${seg.formula}$**` : `$${seg.formula}$`);
      if (placeFormula) {
        const r = placeFormula(seg.formula, cursorX, yTopCm, sizeCm, bold, color);
        for (const it of r.items) {
          items.push(it);
          if (it.t === "text") { yTopMin = Math.min(yTopMin, it.y - it.size * ASCENT); yBotMax = Math.max(yBotMax, it.y + it.size * (1 - ASCENT)); }
        }
        cursorX += r.width;
      } else {
        // フォールバック: 数式ソースを簡易整形してイタリック表示
        const txt = seg.formula.replace(/\\[a-zA-Z]+/g, (m) => m.slice(1)).replace(/[{}]/g, "");
        const w = measure(txt, sizeCm, bold);
        items.push({ t: "text", x: cursorX, y: baseY, size: sizeCm, text: txt, bold, color, italic: true, _w: w });
        cursorX += w;
      }
      continue;
    }
    const text = typeof seg === "string" ? seg : String(seg);
    if (!text) continue;
    labelParts.push(bold ? `**${text}**` : text);
    // 1文字 = 1 item (= 文字編集モードで1要素)。個別に色/太字/サイズ/フォント/位置を指定できる。
    // pptx 側では未変更の連続文字を1テキストボックスに再結合する (ネイティブ編集性を維持)。
    for (const ch of text) {
      const cw = measure(ch, sizeCm, bold);
      items.push({ t: "text", x: cursorX, y: baseY, size: sizeCm, text: ch, bold, color, italic: false, _w: cw });
      cursorX += cw + CHAR_GAP;
    }
  }

  return {
    items,
    x_cm: xCm, y_cm: yTopMin,
    w_cm: Math.max(0, cursorX - xCm),
    h_cm: Math.max(sizeCm, yBotMax - yTopMin),
    label: labelParts.join(""),
  };
}

// ---- 表 (フォントセル + 罫線)。セルは layoutLine を流用するので数式・カーブ矢印も効く ----
function shiftItems(items, dx, dy) {
  for (const it of items) {
    if (it.t === "text") { it.x += dx; it.y += dy; }
    else if (it.t === "line") { it.x1 += dx; it.y1 += dy; it.x2 += dx; it.y2 += dy; }
    else if (it.t === "poly") it.pts = it.pts.map(([x, y]) => [x + dx, y + dy]);
    else if (it.t === "disc") { it.cx += dx; it.cy += dy; }
  }
  return items;
}
function layoutTable(table, xCm, yTopCm, sizeCm, opts) {
  const cellSize = sizeCm * 0.82;
  const pad = cellSize * 0.35;
  const rowsAll = [table.header, ...table.rows];
  const nrows = rowsAll.length;
  let ncols = 0;
  for (const r of rowsAll) ncols = Math.max(ncols, r.length);
  if (!nrows || !ncols) return { items: [], x_cm: xCm, y_cm: yTopCm, w_cm: 0, h_cm: 0, label: "[table]" };

  // 各セルを原点で配置
  const cellBlk = {};
  const colW = new Array(ncols).fill(0);
  for (let r = 0; r < nrows; r++) {
    for (let c = 0; c < ncols; c++) {
      const cell = c < rowsAll[r].length ? rowsAll[r][c] : [];
      const blk = layoutLine(cell, 0, 0, cellSize, opts);
      cellBlk[`${r},${c}`] = blk;
      colW[c] = Math.max(colW[c], blk.w_cm);
    }
  }
  for (let c = 0; c < ncols; c++) colW[c] += 2 * pad;
  const rowH = cellSize * 1.7;
  const totalW = colW.reduce((a, b) => a + b, 0);
  const totalH = rowH * nrows;
  const sum = (arr, k) => arr.slice(0, k).reduce((a, b) => a + b, 0);
  const items = [];
  const lw = sizeCm * 0.03;

  // 横罫線
  for (let r = 0; r <= nrows; r++) {
    const yy = yTopCm + r * rowH;
    items.push({ t: "line", x1: xCm, y1: yy, x2: xCm + totalW, y2: yy, w: lw });
  }
  // 縦罫線 (1列目の右は増減表慣習で二重線)
  const dblGap = cellSize * 0.12;
  for (let c = 0; c <= ncols; c++) {
    const xx = xCm + sum(colW, c);
    items.push({ t: "line", x1: xx, y1: yTopCm, x2: xx, y2: yTopCm + totalH, w: lw });
    if (c === 1) items.push({ t: "line", x1: xx + dblGap, y1: yTopCm, x2: xx + dblGap, y2: yTopCm + totalH, w: lw });
  }
  // セル内容を中央寄せで配置
  for (let r = 0; r < nrows; r++) {
    for (let c = 0; c < ncols; c++) {
      const blk = cellBlk[`${r},${c}`];
      if (!blk.items.length) continue;
      const cellX = xCm + sum(colW, c);
      const cellY = yTopCm + r * rowH;
      const dx = cellX + (colW[c] - blk.w_cm) / 2 - blk.x_cm;
      const dy = cellY + (rowH - cellSize) / 2;
      shiftItems(blk.items, dx, dy);
      items.push(...blk.items);
    }
  }
  return { items, x_cm: xCm, y_cm: yTopCm, w_cm: totalW, h_cm: totalH, label: "[table]" };
}

// RenderItem 1個の bbox [xmin,ymin,xmax,ymax] (cm)
export function itemBbox(it) {
  if (it.t === "text") { const w = it._w != null ? it._w : 0; return [it.x, it.y - it.size * ASCENT, it.x + w, it.y + it.size * (1 - ASCENT)]; }
  if (it.t === "line") return [Math.min(it.x1, it.x2), Math.min(it.y1, it.y2), Math.max(it.x1, it.x2), Math.max(it.y1, it.y2)];
  if (it.t === "poly") { const xs = it.pts.map((p) => p[0]), ys = it.pts.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
  if (it.t === "disc") return [it.cx - it.r, it.cy - it.r, it.cx + it.r, it.cy + it.r];
  return [0, 0, 0, 0];
}
// items を「要素」化 (文字編集モードで個別ドラッグ/書式する単位)。1 item = 1 element。
function computeElements(items) {
  return (items || []).map((it, i) => {
    const [x0, y0, x1, y1] = itemBbox(it);
    return { start: i, end: i + 1, x_cm: x0, y_cm: y0, w_cm: x1 - x0, h_cm: y1 - y0 };
  });
}

// ---- 1スライドの縦フロー (flow.js の layoutFlow に対応するフォント版) ----
export function createTextLayout(opts) {
  opts = opts || {};
  const measure = opts.measure || createMeasure(opts.fontFamily);
  const placeFormula = opts.placeFormula || null;
  const styles = opts.styles || buildStyles();

  function lineOpts(extra) { return { styles, measure, placeFormula, ...extra }; }

  function renderItem(item, xCm, yTopCm, sizes) {
    if (item.type === "bullet") return layoutLine(item.segments, xCm, yTopCm, sizes.body, lineOpts({ includeBullet: true }));
    if (item.type === "paragraph") return layoutLine(item.segments, xCm, yTopCm, sizes.body, lineOpts());
    if (item.type === "subheading") return layoutLine(item.segments, xCm, yTopCm, sizes.subheading, lineOpts());
    if (item.type === "note") {
      const blk = layoutLine(item.segments, xCm, yTopCm, sizes.note, lineOpts({ bulletColor: NOTE_COLOR }));
      for (const it of blk.items) if (it.t === "text" && it.color == null) it.color = NOTE_COLOR;
      return blk;
    }
    if (item.type === "blockmath") {
      const blk = layoutLine([{ kind: "math", formula: item.formula }], xCm, yTopCm, sizes.body, lineOpts());
      const center = (opts.slideWCm || 33.867) / 2;
      const dx = center - (blk.x_cm + blk.w_cm / 2);
      shiftBlock(blk, dx, 0);
      return blk;
    }
    if (item.type === "table") return layoutTable(item, xCm, yTopCm, sizes.body, lineOpts());
    return { items: [], x_cm: xCm, y_cm: yTopCm, w_cm: 0, h_cm: 0, label: "" };
  }

  function layoutSlide(heading, content, sizes) {
    const [hx, hy] = opts.headingOrigin || [1.5, 1.0];
    const [bx, by] = opts.bodyOrigin || [2.0, 4.2];
    const slideH = opts.slideHCm || 19.05;
    const finalize = (overflow) => { for (const b of blocks) b.elements = computeElements(b.items); return { blocks, overflow }; };
    const blocks = [];
    blocks.push(layoutLine(heading, hx, hy, sizes.heading, lineOpts()));
    if (!content || !content.length) return finalize(false);

    const availableH = Math.max(1.0, slideH - by - 0.8);
    const minGap = sizes.body * 0.45;
    const measured = content.map((it) => renderItem(it, bx, 0, sizes));
    const heights = measured.map((b) => b.h_cm);
    const needed = heights.reduce((a, b) => a + b, 0) + minGap * Math.max(0, content.length - 1);
    const overflow = needed > availableH;
    let gap = minGap;
    if (content.length > 1 && !overflow) { const extra = availableH - needed; if (extra > 0) gap = Math.max(minGap, extra / (content.length - 1)); }

    let cursorY = by;
    for (let k = 0; k < content.length; k++) {
      const blk = renderItem(content[k], bx, cursorY, sizes);
      blocks.push(blk);
      cursorY += heights[k] + gap;
    }
    return finalize(overflow);
  }

  return { layoutSlide, layoutLine: (seg, x, y, s, e) => layoutLine(seg, x, y, s, lineOpts(e)) };
}

function shiftBlock(blk, dx, dy) {
  for (const it of blk.items) {
    if (it.t === "text") { it.x += dx; it.y += dy; }
    else if (it.t === "line") { it.x1 += dx; it.y1 += dy; it.x2 += dx; it.y2 += dy; }
    else if (it.t === "poly") { it.pts = it.pts.map(([x, y]) => [x + dx, y + dy]); }
    else if (it.t === "disc") { it.cx += dx; it.cy += dy; }
  }
  blk.x_cm += dx; blk.y_cm += dy;
}
