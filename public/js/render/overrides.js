// 空間オーバーライド適用 (ブロックの移動・リサイズ)。
// プレビューSVGと pptx 生成の両方で同じ適用をして「見たまま=出力」を保つ。
//
// override 形式: { dx: cm, dy: cm, s: scale(既定1) }
// 適用: 各ストローク点を「ブロック原点(block.x_cm,y_cm)中心に scale」してから (dx,dy) 平行移動。

function xform(pts, ox, oy, dx, dy, s) {
  return pts.map(([x, y]) => [ox + (x - ox) * s + dx, oy + (y - oy) * s + dy]);
}

export function applyBlockOverride(block, ov) {
  if (!ov) return block;
  const els = ov.els || null;
  const bdx = ov.dx || 0, bdy = ov.dy || 0, bs = ov.s || 1;
  const hasBlock = !(bdx === 0 && bdy === 0 && bs === 1);
  const hasBlockVis = ov.color != null || ov.bold != null; // ブロック全体の色/太字
  const hasEls = els && Object.keys(els).length > 0;
  if (!hasBlock && !hasBlockVis && !hasEls) return block;

  // points_cm をコピー
  let placed = block.placed.map((st) => ({
    points_cm: st.points_cm.map((p) => [p[0], p[1]]),
    pressures: st.pressures, bold: st.bold, color: st.color,
  }));

  // 0) ブロック全体の色/太字 (ベース)。要素 override が後で個別に上書きする。
  if (hasBlockVis) {
    for (const st of placed) {
      if (ov.color != null) st.color = ov.color;
      if (ov.bold != null) st.bold = ov.bold;
    }
  }

  // 1) 要素ごとの override (SVGの内側transform相当) を先に適用。
  //    位置/スケール(dx,dy,s) に加え、色(color)・太字(bold) も文字単位で上書きできる。
  if (hasEls && block.elements) {
    for (const [jStr, eo] of Object.entries(els)) {
      const j = parseInt(jStr, 10);
      const el = block.elements[j];
      if (!el) continue;
      const edx = eo.dx || 0, edy = eo.dy || 0, es = eo.s || 1;
      const geom = !(edx === 0 && edy === 0 && es === 1);
      const hasColor = eo.color != null, hasBold = eo.bold != null;
      if (!geom && !hasColor && !hasBold) continue;
      for (let i = el.start; i < el.end; i++) {
        if (geom) placed[i].points_cm = xform(placed[i].points_cm, el.x_cm, el.y_cm, edx, edy, es);
        if (hasColor) placed[i].color = eo.color;
        if (hasBold) placed[i].bold = eo.bold;
      }
    }
  }
  // 2) ブロック全体の override (外側transform相当) を全ストロークに適用
  if (hasBlock) {
    for (const st of placed) st.points_cm = xform(st.points_cm, block.x_cm, block.y_cm, bdx, bdy, bs);
  }
  // override適用後の実バウンディングボックスを再計算する。
  // pptx の <p:contentPart> は ink の bbox を <a:ext> に合わせてスケールするため、
  // 要素を大きく動かすと「宣言extが古いまま→inkが押し潰される」。実bboxに合わせて防ぐ。
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const st of placed) for (const [px, py] of st.points_cm) {
    if (px < xmin) xmin = px; if (py < ymin) ymin = py;
    if (px > xmax) xmax = px; if (py > ymax) ymax = py;
  }
  const hasInk = isFinite(xmin);
  return {
    placed,
    x_cm: hasInk ? xmin : block.x_cm + bdx,
    y_cm: hasInk ? ymin : block.y_cm + bdy,
    w_cm: hasInk ? (xmax - xmin) : block.w_cm * bs,
    h_cm: hasInk ? (ymax - ymin) : block.h_cm * bs,
    elements: block.elements, label: block.label,
  };
}

// 1 RenderItem を原点(ox,oy)中心に scale → (dx,dy) 平行移動 (破壊的)。
function xformItem(n, ox, oy, dx, dy, s) {
  const pt = (x, y) => [ox + (x - ox) * s + dx, oy + (y - oy) * s + dy];
  if (n.t === "text") { const [x, y] = pt(n.x, n.y); n.x = x; n.y = y; n.size = n.size * s; if (n._w != null) n._w = n._w * s; }
  else if (n.t === "line") { const [x1, y1] = pt(n.x1, n.y1); const [x2, y2] = pt(n.x2, n.y2); n.x1 = x1; n.y1 = y1; n.x2 = x2; n.y2 = y2; n.w = (n.w || 0.05) * s; }
  else if (n.t === "poly") { n.pts = n.pts.map(([x, y]) => pt(x, y)); n.w = (n.w || 0.05) * s; }
  else if (n.t === "disc") { const [cx, cy] = pt(n.cx, n.cy); n.cx = cx; n.cy = cy; n.r = n.r * s; }
}
const visItem = (it) => it.t === "text" || it.t === "line" || it.t === "poly" || it.t === "disc";

// テキストモード (RenderItem 配列) 版の override 適用。
// 要素override(els) を先に各 item へ、続いてブロックoverride を全 item へ。色/太字/フォントも焼く。
export function applyBlockOverrideItems(block, ov) {
  if (!ov) return block;
  const bdx = ov.dx || 0, bdy = ov.dy || 0, bs = ov.s || 1;
  const hasBlock = !(bdx === 0 && bdy === 0 && bs === 1);
  const hasBlockVis = ov.color != null || ov.bold != null || ov.font != null;
  const els = ov.els || null;
  const hasEls = els && Object.keys(els).length > 0;
  const hasAnim = ov.anim != null;
  if (!hasBlock && !hasBlockVis && !hasEls && !hasAnim) return block;
  if (!hasBlock && !hasBlockVis && !hasEls) return { ...block, anim: ov.anim }; // 登場方向のみ
  const elements = block.elements || [];
  const items = (block.items || []).map((it) => ({ ...it, pts: it.pts ? it.pts.map((p) => [...p]) : undefined }));

  // 0) ブロック全体の色/太字/フォント (ベース)。要素 override が後で個別上書き。
  if (hasBlockVis) for (const it of items) {
    if (ov.color != null && visItem(it)) it.color = ov.color;
    if (ov.bold != null && it.t === "text") it.bold = ov.bold;
    if (ov.font != null && it.t === "text") it.font = ov.font;
  }
  // 1) 要素ごとの override (位置/スケール/色/太字/フォント)
  if (hasEls) for (const [jStr, eo] of Object.entries(els)) {
    const el = elements[parseInt(jStr, 10)];
    if (!el) continue;
    const it = items[el.start];
    if (!it) continue;
    if (eo.color != null && visItem(it)) it.color = eo.color;
    if (eo.bold != null && it.t === "text") it.bold = eo.bold;
    if (eo.font != null && it.t === "text") it.font = eo.font;
    const edx = eo.dx || 0, edy = eo.dy || 0, es = eo.s || 1;
    if (!(edx === 0 && edy === 0 && es === 1)) xformItem(it, el.x_cm, el.y_cm, edx, edy, es);
  }
  // 2) ブロック全体の幾何 override を全 item へ
  if (hasBlock) for (const it of items) xformItem(it, block.x_cm, block.y_cm, bdx, bdy, bs);

  const out = { ...block, items, x_cm: block.x_cm + bdx, y_cm: block.y_cm + bdy, w_cm: block.w_cm * bs, h_cm: block.h_cm * bs };
  if (hasAnim) out.anim = ov.anim;
  return out;
}

// slideOv: { [blockIndex]: {dx,dy,s} }。ブロック配列に適用した新配列を返す。
// テキスト(items)/手書き(placed)を自動判別。
export function applySlideOverrides(blocks, slideOv) {
  if (!slideOv) return blocks;
  return blocks.map((b, i) => (b.items ? applyBlockOverrideItems(b, slideOv[i]) : applyBlockOverride(b, slideOv[i])));
}
