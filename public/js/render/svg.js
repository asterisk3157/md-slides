// placed strokes → SVG (Python handwriting_pptx/svg_preview.py の JS 版)。

function strokeToPolyline(s, pxPerCm, defaultColor, baseWidthCm, boldMult) {
  if (!s.points_cm.length) return "";
  const pts = s.points_cm.map(([x, y]) => `${(x * pxPerCm).toFixed(1)},${(y * pxPerCm).toFixed(1)}`).join(" ");
  const color = s.color || defaultColor;
  const wCm = baseWidthCm * (s.bold ? boldMult : 1.0);
  const wPx = Math.max(1.0, wCm * pxPerCm);
  return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${wPx.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// override {dx,dy,s} を SVG transform に変換 (ブロック原点中心 scale + 平行移動)
export function overrideTransform(ov, oxCm, oyCm, pxPerCm) {
  const dx = (ov && ov.dx) || 0, dy = (ov && ov.dy) || 0, s = (ov && ov.s) || 1;
  if (dx === 0 && dy === 0 && s === 1) return "";
  const e = oxCm * pxPerCm * (1 - s) + dx * pxPerCm;
  const f = oyCm * pxPerCm * (1 - s) + dy * pxPerCm;
  return `translate(${e.toFixed(2)},${f.toFixed(2)}) scale(${s})`;
}

function hitRect(cls, xCm, yCm, wCm, hCm, px, padPx, minPx) {
  padPx = padPx || 0; minPx = minPx || 4;
  let x = xCm * px - padPx, y = yCm * px - padPx;
  let w = wCm * px + 2 * padPx, h = hCm * px + 2 * padPx;
  if (w < minPx) { x -= (minPx - w) / 2; w = minPx; }
  if (h < minPx) { y -= (minPx - h) / 2; h = minPx; }
  return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="transparent"/>`;
}

// 編集用: ブロックを <g class="blk"> で包み、ブロックhit矩形＋要素ごとの <g class="el"> ＋要素hit矩形を出す。
export function slideToSvgEditable(blocks, slideWCm, slideHCm, opts, slideOv) {
  opts = opts || {};
  const pxPerCm = opts.pxPerCm || 40.0;
  const defaultColor = opts.defaultColor || "#000000";
  const baseWidthCm = opts.brushWidthCm || 0.06;
  const boldMult = opts.boldMult || 1.45;
  const wPx = slideWCm * pxPerCm, hPx = slideHCm * pxPerCm;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" class="edit-svg" width="${wPx.toFixed(0)}" height="${hPx.toFixed(0)}" viewBox="0 0 ${wPx.toFixed(0)} ${hPx.toFixed(0)}" style="background:#fff;border:1px solid #ddd">`);
  // 編集補助グリッド (1cm方眼、極薄グレー)。pptx出力には含まれない (SVGプレビュー専用)。
  if (opts.grid !== false) {
    const step = pxPerCm; // 1cm
    const g = ['<g class="grid" pointer-events="none">'];
    for (let x = step; x < wPx; x += step) g.push(`<line x1="${x.toFixed(0)}" y1="0" x2="${x.toFixed(0)}" y2="${hPx.toFixed(0)}" stroke="#eee" stroke-width="1"/>`);
    for (let y = step; y < hPx; y += step) g.push(`<line x1="0" y1="${y.toFixed(0)}" x2="${wPx.toFixed(0)}" y2="${y.toFixed(0)}" stroke="#eee" stroke-width="1"/>`);
    g.push("</g>");
    parts.push(g.join(""));
  }
  // 色/太字 override を反映したストロークを返す (要素 > ブロック > 元の色 の優先)
  function withVis(st, eoColor, eoBold, blkColor, blkBold) {
    const c = eoColor != null ? eoColor : (blkColor != null ? blkColor : st.color);
    const b = eoBold != null ? eoBold : (blkBold != null ? blkBold : st.bold);
    if (c === st.color && b === st.bold) return st;
    return { points_cm: st.points_cm, pressures: st.pressures, color: c, bold: b };
  }
  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i];
    const ov = slideOv ? slideOv[i] : null;
    const blkColor = ov && ov.color != null ? ov.color : null;
    const blkBold = ov && ov.bold != null ? ov.bold : null;
    const tr = overrideTransform(ov, blk.x_cm, blk.y_cm, pxPerCm);
    parts.push(`<g class="blk" data-block="${i}"${tr ? ` transform="${tr}"` : ""}>`);
    // ブロック当たり判定 (矩形領域)
    parts.push(hitRect("bhit", blk.x_cm, blk.y_cm, blk.w_cm, blk.h_cm, pxPerCm));
    const els = blk.elements || [];
    const covered = new Set();
    const elOvs = (ov && ov.els) || {};
    for (let j = 0; j < els.length; j++) {
      const el = els[j];
      for (let k = el.start; k < el.end; k++) covered.add(k);
      const eo = elOvs[j] || {};
      const etr = overrideTransform(eo, el.x_cm, el.y_cm, pxPerCm);
      parts.push(`<g class="el" data-el="${j}"${etr ? ` transform="${etr}"` : ""}>`);
      // ehit は太字のはみ出し/細い数式要素も掴めるよう余白(3px)＋最小サイズ(12px)で矩形化
      parts.push(hitRect("ehit", el.x_cm, el.y_cm, el.w_cm, el.h_cm, pxPerCm, 3, 12));
      for (let k = el.start; k < el.end; k++) {
        // 色/太字: 要素 override > ブロック override > 元の色 (pptx側は overrides.js が焼き込む)
        const st = withVis(blk.placed[k], eo.color, eo.bold, blkColor, blkBold);
        const line = strokeToPolyline(st, pxPerCm, defaultColor, baseWidthCm, boldMult);
        if (line) parts.push(line);
      }
      parts.push("</g>");
    }
    // どの要素にも属さないストローク (表など) は直接描画 (ブロック色/太字を反映)
    for (let k = 0; k < blk.placed.length; k++) {
      if (covered.has(k)) continue;
      const st = withVis(blk.placed[k], null, null, blkColor, blkBold);
      const line = strokeToPolyline(st, pxPerCm, defaultColor, baseWidthCm, boldMult);
      if (line) parts.push(line);
    }
    parts.push("</g>");
  }
  parts.push("</svg>");
  return parts.join("");
}

function escXml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// テキストモード: 地の文をフォント <text> で描画 (配置は手書きレイアウトを流用)。
// 数式・表など (hasMath / runs 無し) は暫定でインク描画 (フォント数式はステージ3)。
export function slideToSvgText(blocks, slideWCm, slideHCm, opts) {
  opts = opts || {};
  const pxPerCm = opts.pxPerCm || 40.0;
  const defaultColor = opts.defaultColor || "#000000";
  const fontFamily = opts.fontFamily || "'Noto Sans JP', 'Yu Gothic', sans-serif";
  const baseWidthCm = opts.brushWidthCm || 0.06;
  const boldMult = opts.boldMult || 1.45;
  const wPx = slideWCm * pxPerCm, hPx = slideHCm * pxPerCm;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${wPx.toFixed(0)}" height="${hPx.toFixed(0)}" viewBox="0 0 ${wPx.toFixed(0)} ${hPx.toFixed(0)}" style="background:#fff;border:1px solid #ddd">`);
  for (const blk of blocks) {
    if (blk.hasMath || !blk.runs) {
      // 数式・表は暫定インク描画 (ステージ3でフォント化)
      for (const s of (blk.placed || [])) {
        const line = strokeToPolyline(s, pxPerCm, defaultColor, baseWidthCm, boldMult);
        if (line) parts.push(line);
      }
      continue;
    }
    const fpx = (blk.fontSizeCm || 1.0) * pxPerCm;
    let tx = blk.x_cm * pxPerCm;
    const topPx = blk.y_cm * pxPerCm;
    const baseline = topPx + fpx * 0.82;
    if (blk.includeBullet) {
      const cy = topPx + fpx * 0.5;
      parts.push(`<circle cx="${(tx + fpx * 0.16).toFixed(1)}" cy="${cy.toFixed(1)}" r="${(fpx * 0.10).toFixed(1)}" fill="${defaultColor}"/>`);
      tx += fpx * 0.55;
    }
    const tspans = (blk.runs || []).map((r) => {
      if (r.math || !r.text) return "";
      const fill = r.color || defaultColor;
      const fw = r.bold ? ' font-weight="bold"' : "";
      return `<tspan fill="${fill}"${fw}>${escXml(r.text)}</tspan>`;
    }).join("");
    parts.push(`<text x="${tx.toFixed(1)}" y="${baseline.toFixed(1)}" font-family="${escXml(fontFamily)}" font-size="${fpx.toFixed(1)}" fill="${defaultColor}">${tspans}</text>`);
  }
  parts.push("</svg>");
  return parts.join("");
}

// 1 つの RenderItem を SVG 文字列に。色/太字/フォントの override を反映。
function itemToSvg(it, px, defaultColor, fontFamily, ovColor, ovBold, ovFont) {
  if (it.t === "text") {
    if (!it.text) return "";
    const fill = ovColor != null ? ovColor : (it.color || defaultColor);
    const bold = ovBold != null ? ovBold : it.bold;
    const fw = bold ? ' font-weight="bold"' : "";
    const fs = it.italic ? ' font-style="italic"' : "";
    // ovFont はカンマ区切りスタックを許容 (例: "Yu Mincho, YuMincho, Noto Serif JP")。
    // 各名を引用符で囲み、最後に既定スタックを付ける → 閲覧者の OS に応じてフォールバック。
    const raw = ovFont || it.font;
    let fam = fontFamily;
    if (raw) {
      const names = raw.split(",").map((s) => s.trim()).filter(Boolean).map((n) => `'${n.replace(/'/g, "")}'`);
      fam = names.join(", ") + ", " + fontFamily;
    }
    return `<text x="${(it.x * px).toFixed(2)}" y="${(it.y * px).toFixed(2)}" font-family="${escXml(fam)}" font-size="${(it.size * px).toFixed(2)}"${fw}${fs} fill="${fill}">${escXml(it.text)}</text>`;
  }
  const color = ovColor != null ? ovColor : (it.color || defaultColor);
  if (it.t === "line") {
    const w = Math.max(1, (it.w || 0.05) * px);
    return `<line x1="${(it.x1 * px).toFixed(2)}" y1="${(it.y1 * px).toFixed(2)}" x2="${(it.x2 * px).toFixed(2)}" y2="${(it.y2 * px).toFixed(2)}" stroke="${color}" stroke-width="${w.toFixed(2)}" stroke-linecap="round"/>`;
  }
  if (it.t === "poly") {
    const w = Math.max(1, (it.w || 0.05) * px);
    const pts = it.pts.map(([x, y]) => `${(x * px).toFixed(1)},${(y * px).toFixed(1)}`).join(" ");
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${w.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (it.t === "disc") {
    return `<circle cx="${(it.cx * px).toFixed(2)}" cy="${(it.cy * px).toFixed(2)}" r="${Math.max(1, it.r * px).toFixed(2)}" fill="${color}"/>`;
  }
  return "";
}

// 描画アイテム (textlayout.js / formulafont.js の RenderItem) → SVG。テキストモードの主経路。
// 各ブロックを <g class="blk" data-block="i"> で包み、ブロック当たり判定(.bhit)＋override
// transform を出す → preview.js の選択/ドラッグ移動/リサイズ/書式ツールバーが効く。
export function slideItemsToSvg(blocks, slideWCm, slideHCm, opts, slideOv) {
  opts = opts || {};
  const px = opts.pxPerCm || 40.0;
  const defaultColor = opts.defaultColor || "#000000";
  const fontFamily = opts.fontFamily || "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', sans-serif";
  const wPx = slideWCm * px, hPx = slideHCm * px;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" class="edit-svg" width="${wPx.toFixed(0)}" height="${hPx.toFixed(0)}" viewBox="0 0 ${wPx.toFixed(0)} ${hPx.toFixed(0)}" style="background:#fff;border:1px solid #ddd">`);
  // 編集補助の点線グリッド (1cm方眼, 極薄)。pptx 出力には含まれない。
  if (opts.grid !== false) {
    const step = px;
    const g = ['<g class="grid" pointer-events="none">'];
    for (let x = step; x < wPx; x += step) g.push(`<line x1="${x.toFixed(0)}" y1="0" x2="${x.toFixed(0)}" y2="${hPx.toFixed(0)}" stroke="#e3e3e8" stroke-width="1" stroke-dasharray="1 4"/>`);
    for (let y = step; y < hPx; y += step) g.push(`<line x1="0" y1="${y.toFixed(0)}" x2="${wPx.toFixed(0)}" y2="${y.toFixed(0)}" stroke="#e3e3e8" stroke-width="1" stroke-dasharray="1 4"/>`);
    g.push("</g>");
    parts.push(g.join(""));
  }
  // サムネ用: 当たり判定/グループ無し、描画アイテムだけ (軽量・非インタラクティブ)
  if (opts.thumb) {
    for (const blk of blocks) for (const it of (blk.items || [])) {
      const s = itemToSvg(it, px, defaultColor, fontFamily, null, null, null);
      if (s) parts.push(s);
    }
    parts.push("</svg>");
    return parts.join("");
  }
  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i];
    const ov = slideOv ? slideOv[i] : null;
    const tr = overrideTransform(ov, blk.x_cm, blk.y_cm, px);
    const blkColor = ov && ov.color != null ? ov.color : null;
    const blkBold = ov && ov.bold != null ? ov.bold : null;
    const blkFont = ov && ov.font != null ? ov.font : null;
    const elOvs = (ov && ov.els) || {};
    parts.push(`<g class="blk" data-block="${i}"${tr ? ` transform="${tr}"` : ""}>`);
    parts.push(hitRect("bhit", blk.x_cm, blk.y_cm, blk.w_cm, blk.h_cm, px));
    const els = blk.elements;
    if (els && els.length) {
      // 要素ごとに <g class="el"> ＋当たり判定。文字編集モードで個別ドラッグ/書式できる。
      for (let j = 0; j < els.length; j++) {
        const el = els[j];
        const eo = elOvs[j] || {};
        const etr = overrideTransform(eo, el.x_cm, el.y_cm, px);
        parts.push(`<g class="el" data-el="${j}"${etr ? ` transform="${etr}"` : ""}>`);
        parts.push(hitRect("ehit", el.x_cm, el.y_cm, el.w_cm, el.h_cm, px, 3, 12));
        const it = blk.items[el.start];
        if (it) {
          const s = itemToSvg(it, px, defaultColor, fontFamily,
            eo.color != null ? eo.color : blkColor,
            eo.bold != null ? eo.bold : blkBold,
            eo.font != null ? eo.font : blkFont);
          if (s) parts.push(s);
        }
        parts.push("</g>");
      }
    } else {
      for (const it of (blk.items || [])) {
        const s = itemToSvg(it, px, defaultColor, fontFamily, blkColor, blkBold, blkFont);
        if (s) parts.push(s);
      }
    }
    parts.push("</g>");
  }
  parts.push("</svg>");
  return parts.join("");
}

// blocks: layoutFlow / layoutTextLine が返す Block の配列 (各 .placed を持つ)
export function slideToSvg(blocks, slideWCm, slideHCm, opts) {
  opts = opts || {};
  const pxPerCm = opts.pxPerCm || 40.0;
  const defaultColor = opts.defaultColor || "#000000";
  const baseWidthCm = opts.brushWidthCm || 0.06;
  const boldMult = opts.boldMult || 1.45;
  const wPx = slideWCm * pxPerCm, hPx = slideHCm * pxPerCm;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${wPx.toFixed(0)}" height="${hPx.toFixed(0)}" viewBox="0 0 ${wPx.toFixed(0)} ${hPx.toFixed(0)}" style="background:#fff;border:1px solid #ddd">`);
  for (const blk of blocks) for (const s of blk.placed) {
    const line = strokeToPolyline(s, pxPerCm, defaultColor, baseWidthCm, boldMult);
    if (line) parts.push(line);
  }
  parts.push("</svg>");
  return parts.join("");
}
