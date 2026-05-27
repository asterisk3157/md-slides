// 縦フローレイアウト + 表 (Python handwriting_pptx/layout.py の layout_flow/_render_* の JS 版)。
import { layoutTextLine } from "./layout.js";

function shiftBlock(blk, dx, dy) {
  const placed = blk.placed.map((s) => ({
    points_cm: s.points_cm.map(([px, py]) => [px + dx, py + dy]),
    pressures: s.pressures, bold: s.bold, color: s.color,
  }));
  const elements = (blk.elements || []).map((el) => ({
    start: el.start, end: el.end, x_cm: el.x_cm + dx, y_cm: el.y_cm + dy, w_cm: el.w_cm, h_cm: el.h_cm,
  }));
  return { placed, elements, x_cm: blk.x_cm + dx, y_cm: blk.y_cm + dy, w_cm: blk.w_cm, h_cm: blk.h_cm, label: blk.label };
}

function renderTable(table, xCm, yCm, size, dict, ctx) {
  const cellSize = size * 0.78;
  const pad = cellSize * 0.30;
  const allRows = [table.header, ...table.rows];
  const nrows = allRows.length;
  let ncols = 0;
  for (const r of allRows) ncols = Math.max(ncols, r.length);
  if (nrows === 0 || ncols === 0) return { placed: [], x_cm: xCm, y_cm: yCm, w_cm: 0, h_cm: 0, label: "[table]" };

  const cellBlocks = {};
  const colW = new Array(ncols).fill(0.0);
  for (let r = 0; r < nrows; r++) {
    for (let c = 0; c < ncols; c++) {
      const cell = c < allRows[r].length ? allRows[r][c] : [];
      const blk = layoutTextLine(cell, dict, 0.0, 0.0, cellSize, { includeBullet: false, styles: ctx.styles, M: ctx.M, placeFormula: ctx.placeFormula });
      cellBlocks[`${r},${c}`] = blk;
      colW[c] = Math.max(colW[c], blk.w_cm);
    }
  }
  for (let c = 0; c < ncols; c++) colW[c] += 2 * pad;
  const rowH = cellSize * 1.7;
  const totalW = colW.reduce((a, b) => a + b, 0);
  const totalH = rowH * nrows;
  const placed = [];
  const sum = (arr, k) => arr.slice(0, k).reduce((a, b) => a + b, 0);

  for (let r = 0; r <= nrows; r++) {
    const yy = yCm + r * rowH;
    placed.push({ points_cm: [[xCm, yy], [xCm + totalW, yy]], pressures: [0.5, 0.5], bold: false, color: null });
  }
  const dblGap = cellSize * 0.14;
  for (let c = 0; c <= ncols; c++) {
    const xx = xCm + sum(colW, c);
    placed.push({ points_cm: [[xx, yCm], [xx, yCm + totalH]], pressures: [0.5, 0.5], bold: false, color: null });
    if (c === 1) placed.push({ points_cm: [[xx + dblGap, yCm], [xx + dblGap, yCm + totalH]], pressures: [0.5, 0.5], bold: false, color: null });
  }
  for (let r = 0; r < nrows; r++) {
    for (let c = 0; c < ncols; c++) {
      const blk = cellBlocks[`${r},${c}`];
      if (!blk.placed.length) continue;
      const cellX = xCm + sum(colW, c);
      const cellY = yCm + r * rowH;
      const dx = cellX + (colW[c] - blk.w_cm) / 2.0 - blk.x_cm;
      const dy = cellY + (rowH - cellSize) / 2.0;
      for (const s of blk.placed) {
        placed.push({ points_cm: s.points_cm.map(([px, py]) => [px + dx, py + dy]), pressures: s.pressures, bold: s.bold, color: s.color });
      }
    }
  }
  return { placed, elements: [], x_cm: xCm, y_cm: yCm, w_cm: totalW, h_cm: totalH, label: "[table]" };
}

const NOTE_COLOR = "#808080"; // メモ(note)ロールの既定色 (本文流れ・小さめ・グレー)

// 役割別サイズは ctx (bodySize / subheadingSize / noteSize) から取得する。
function renderItem(item, xCm, yCm, dict, ctx) {
  const opt = { styles: ctx.styles, M: ctx.M, placeFormula: ctx.placeFormula };
  const size = ctx.bodySize;
  if (item.type === "bullet") {
    const blk = layoutTextLine(item.segments, dict, xCm, yCm, size, { ...opt, includeBullet: true });
    return [blk, blk.h_cm];
  }
  if (item.type === "paragraph") {
    const blk = layoutTextLine(item.segments, dict, xCm, yCm, size, { ...opt, includeBullet: false });
    return [blk, blk.h_cm];
  }
  if (item.type === "note") {
    // メモ: 本文流れに小さめ＋グレー。明示 span 色は尊重し、無色のみグレー化。
    const blk = layoutTextLine(item.segments, dict, xCm, yCm, ctx.noteSize, { ...opt, includeBullet: false, useMetrics: true });
    for (const s of blk.placed) if (s.color == null) s.color = NOTE_COLOR;
    return [blk, blk.h_cm];
  }
  if (item.type === "subheading") {
    // 小見出しも本文同様に CHAR_METRICS を適用 (・ や句読点などの記号を縮小)
    const blk = layoutTextLine(item.segments, dict, xCm, yCm, ctx.subheadingSize, { ...opt, includeBullet: false, useMetrics: true });
    return [blk, blk.h_cm];
  }
  if (item.type === "blockmath") {
    let blk = layoutTextLine([{ kind: "math", formula: item.formula }], dict, xCm, yCm, size, { ...opt, includeBullet: false });
    const centerTarget = ctx.slideW / 2.0;
    const curCenter = blk.x_cm + blk.w_cm / 2.0;
    blk = shiftBlock(blk, centerTarget - curCenter, 0.0);
    return [blk, blk.h_cm];
  }
  if (item.type === "table") {
    const blk = renderTable(item, xCm, yCm, size, dict, ctx);
    return [blk, blk.h_cm];
  }
  return [{ placed: [], x_cm: xCm, y_cm: yCm, w_cm: 0, h_cm: 0, label: "" }, 0.0];
}

export function createFlow(M, placeFormula) {
  function layoutFlow(heading, content, dict, opts) {
    opts = opts || {};
    const headingSize = opts.headingSizeCm !== undefined ? opts.headingSizeCm : 1.8;
    const bodySize = opts.bodySizeCm !== undefined ? opts.bodySizeCm : 1.0;
    const subheadingSize = opts.subheadingSizeCm !== undefined ? opts.subheadingSizeCm : bodySize * 1.12;
    const noteSize = opts.noteSizeCm !== undefined ? opts.noteSizeCm : bodySize * 0.62;
    const [hx, hy] = opts.headingOrigin || [1.5, 1.0];
    const [bx, by] = opts.bodyOrigin || [2.0, 4.2];
    const styles = opts.styles || null;
    const slideW = opts.slideWCm !== undefined ? opts.slideWCm : 33.867;
    const slideH = opts.slideHCm !== undefined ? opts.slideHCm : 19.05;
    const ctx = { styles, M, placeFormula, slideW, bodySize, subheadingSize, noteSize };

    const blocks = [];
    blocks.push(layoutTextLine(heading, dict, hx, hy, headingSize, { includeBullet: false, useMetrics: true, styles, M, placeFormula }));
    if (!content || !content.length) return { blocks, overflow: false };

    const n = content.length;
    const availableH = Math.max(1.0, slideH - by - 0.8);
    const minGap = bodySize * 0.45;

    // 固定サイズ方式: フォントは自動縮小しない (役割別サイズをそのまま使う)。
    // 高さを 1 度測り、入り切らなければ overflow=true (プレビューで赤警告)。
    const heights = content.map((it) => renderItem(it, bx, 0.0, dict, ctx)[1]);
    const needed = heights.reduce((a, b) => a + b, 0) + minGap * Math.max(0, n - 1);
    const overflow = needed > availableH;
    // gap: 入り切る場合のみ余白を均等分配して縦に散らす (サイズは変えない)。
    let gap = minGap;
    if (n > 1 && !overflow) { const extra = availableH - needed; if (extra > 0) gap = Math.max(minGap, extra / (n - 1)); }

    let cursorY = by;
    for (let k = 0; k < content.length; k++) {
      const [blk] = renderItem(content[k], bx, cursorY, dict, ctx);
      blocks.push(blk);
      cursorY += heights[k] + gap;
    }
    return { blocks, overflow };
  }
  return { layoutFlow };
}
