// フォント数式組版。手書き版 formula.js の parseFormula(LaTeX→Expr木, 辞書非依存)を
// 流用し、配置だけをフォントグリフ(text item)＋手続き線(line/poly item)に差し替える。
// 出力は textlayout.js と同じ RenderItem (cm座標, y下向き)。
//
// placeFormula(src, xCm, yTopCm, sizeCm, bold, color) -> { items, width }

import { parseFormula } from "./formula.js";
import { ASCENT } from "./textlayout.js";

// 構造定数 (フォント向けに調整。手書き版より添字を大きめに)
const SUP_SCALE = 0.62, SUB_SCALE = 0.62;
const SUP_SHIFT = 0.42;   // 上付きベースラインの持ち上げ (size比)
const SUB_SHIFT = 0.18;   // 下付きベースラインの下げ (size比)
const SUBSUP_GAP = 0.04;
const FRAC_SCALE = 0.82, FRAC_VGAP = 0.14, FRAC_BAR_MARGIN = 0.12;
const AXIS = 0.42;        // 数式軸 (分数バー等の中心) を yTop からの size比で
const LINE_W = 0.045;     // 分数バー/√線の太さ(cm基準は size*これ)
const BIG_OPS = new Set(["∫", "∮", "∑", "∏", "⋃", "⋂"]);
const UNDEROVER = new Set(["∑", "∏", "⋃", "⋂"]); // 上下に極限を積む演算子
const VEC_GAP = 0.16, VEC_HEAD = 0.16, VEC_HALF = 0.07;

const isVar = (s) => /^[A-Za-z]$/.test(s);
const PRIMES = new Set(["'", '"', "’", "”", "′", "″"]);
function isPrimeOnly(exprs) {
  return exprs.length > 0 && exprs.every((e) => e && typeof e.base === "string" && PRIMES.has(e.base) && !e.sub && !e.sup && !e.children && !e.frac && !e.fn_name);
}
function primeStr(exprs) {
  return exprs.map((e) => (e.base === "'" || e.base === "’") ? "′" : (e.base === '"' || e.base === "”") ? "″" : e.base).join("");
}

function bboxOf(items) {
  let xn = Infinity, yn = Infinity, xx = -Infinity, yx = -Infinity;
  for (const it of items) {
    if (it.t === "text") {
      const w = it._w != null ? it._w : 0;
      xn = Math.min(xn, it.x); xx = Math.max(xx, it.x + w);
      yn = Math.min(yn, it.y - it.size * ASCENT); yx = Math.max(yx, it.y + it.size * (1 - ASCENT));
    } else if (it.t === "line") {
      xn = Math.min(xn, it.x1, it.x2); xx = Math.max(xx, it.x1, it.x2);
      yn = Math.min(yn, it.y1, it.y2); yx = Math.max(yx, it.y1, it.y2);
    } else if (it.t === "poly") {
      for (const [x, y] of it.pts) { xn = Math.min(xn, x); xx = Math.max(xx, x); yn = Math.min(yn, y); yx = Math.max(yx, y); }
    }
  }
  if (!isFinite(xn)) return [0, 0, 0, 0];
  return [xn, yn, xx, yx];
}
function shift(items, dx, dy) {
  for (const it of items) {
    if (it.t === "text") { it.x += dx; it.y += dy; }
    else if (it.t === "line") { it.x1 += dx; it.y1 += dy; it.x2 += dx; it.y2 += dy; }
    else if (it.t === "poly") it.pts = it.pts.map(([x, y]) => [x + dx, y + dy]);
  }
  return items;
}

export function createFormulaFont(measure) {
  // measure(text, sizeCm, bold) -> width cm
  // chemUpright: \ce{} 由来の数式は元素記号などを立体(非斜体)で描く
  let chemUpright = false;
  function mkText(text, x, yBaseline, size, bold, color, italic) {
    const w = measure(text, size, bold);
    return { t: "text", x, y: yBaseline, size, text, bold: !!bold, color: color || null, italic: !!italic, _w: w };
  }

  // exprs 列を原点(0,yTop)から順に配置 → {items, width}
  function placeSeq(exprs, x, yTop, size, bold, color) {
    const items = [];
    let cur = x;
    for (const e of exprs) {
      const r = placeExpr(e, cur, yTop, size, bold, color);
      items.push(...r.items);
      cur += r.width;
    }
    return { items, width: cur - x };
  }

  // 中央揃え配置 (添字/上付きの複数文字, 分子分母の中央寄せに使う)
  function placeCenteredAt(exprs, cx, yTop, size, bold, color) {
    const r = placeSeq(exprs, 0, yTop, size, bold, color);
    const bb = bboxOf(r.items);
    const w = bb[2] - bb[0];
    shift(r.items, cx - (bb[0] + bb[2]) / 2, 0);
    return { items: r.items, width: w, bbox: bboxOf(r.items) };
  }

  function placeExpr(e, x, yTop, size, bold, color) {
    const baseline = yTop + size * ASCENT;
    const items = [];

    // 分数
    if (e.frac) {
      const fs = size * FRAC_SCALE;
      const num = placeSeq(e.frac[0], 0, 0, fs, bold, color);
      const den = placeSeq(e.frac[1], 0, 0, fs, bold, color);
      const nb = bboxOf(num.items), db = bboxOf(den.items);
      const nw = nb[2] - nb[0], dw = db[2] - db[0];
      let barW = Math.max(nw, dw) * (1 + FRAC_BAR_MARGIN * 2);
      barW = Math.max(barW, fs * 0.4);
      const barY = yTop + size * AXIS;
      const barCx = x + barW / 2;
      // 分子: バーの上
      shift(num.items, barCx - (nb[0] + nb[2]) / 2, (barY - size * FRAC_VGAP - (nb[3])) );
      // 分母: バーの下 (上端を barY+gap に)
      shift(den.items, barCx - (db[0] + db[2]) / 2, (barY + size * FRAC_VGAP - db[1]));
      items.push(...num.items, ...den.items);
      items.push({ t: "line", x1: x, y1: barY, x2: x + barW, y2: barY, w: size * LINE_W, color });
      return { items, width: barW + size * 0.06 };
    }

    // 関数名 (sin, cos, lim, ...)
    if (e.fn_name) {
      const name = e.fn_name;
      const t = mkText(name, x, baseline, size, bold, color, false);
      items.push(t);
      let right = x + t._w;
      if (name === "lim" && e.sub) {
        const sub = placeCenteredAt(e.sub, x + t._w / 2, 0, size * SUB_SCALE, bold, color);
        shift(sub.items, 0, (yTop + size * 1.02) - sub.bbox[1]);
        items.push(...sub.items);
        right = Math.max(right, x + t._w);
      } else {
        const ss = placeScripts(e, right, yTop, size, bold, color);
        items.push(...ss.items); right = Math.max(right, ss.right);
      }
      return { items, width: right - x + size * 0.06 };
    }

    // ベクトル
    if (e.vec) {
      const inner = placeSeq(e.vec, x, yTop, size, bold, color);
      items.push(...inner.items);
      const bb = bboxOf(inner.items);
      const arrowY = bb[1] - size * VEC_GAP;
      const x1 = bb[0], x2 = Math.max(bb[2], bb[0] + size * 0.3);
      const hl = size * VEC_HEAD, hw = size * VEC_HALF;
      items.push({ t: "poly", pts: [[x1, arrowY], [x2, arrowY], [x2 - hl, arrowY - hw], [x2, arrowY], [x2 - hl, arrowY + hw]], w: size * LINE_W, color });
      return { items, width: inner.width };
    }

    // 増減表カーブ矢印
    if (e.curve) {
      const r = placeCurve(e.curve, x, yTop, size, color);
      return { items: r.items, width: r.width };
    }

    // グループ {}
    if (e.base === "" && e.children) {
      const seq = placeSeq(e.children, x, yTop, size, bold, color);
      items.push(...seq.items);
      const ss = placeScripts(e, x + seq.width, yTop, size, bold, color);
      items.push(...ss.items);
      return { items, width: Math.max(x + seq.width, ss.right) - x };
    }

    if (e.base === "") {
      const ss = placeScripts(e, x, yTop, size, bold, color);
      return { items: ss.items, width: ss.right - x };
    }

    // √ (base="√", arg=被開方数): √記号(折れ線)＋上線(vinculum)＋中身
    if (e.base === "√") {
      const checkW = size * 0.42;
      const radX = x + checkW + size * 0.08;
      const rad = placeSeq(e.arg || [], radX, yTop, size, bold, color);
      const radRight = radX + rad.width + size * 0.10;
      const lineY = yTop - size * 0.02;          // 上線の高さ (字面上端の少し上)
      const botY = yTop + size * 0.62;            // チェックの谷
      items.push({ t: "poly", pts: [[x, yTop + size * 0.45], [x + checkW * 0.5, botY], [x + checkW, lineY], [radRight, lineY]], w: size * LINE_W, color });
      items.push(...rad.items);
      const ss = placeScripts(e, radRight, yTop, size, bold, color);
      items.push(...ss.items);
      return { items, width: Math.max(radRight, ss.right) - x + size * 0.04 };
    }

    // 大型演算子 (∫∑∏): 大きめ＋上下/側方に極限。重心は行の中央に置く。
    if (BIG_OPS.has(e.base)) {
      const integral = (e.base === "∫" || e.base === "∮");
      const opSize = size * (integral ? 1.55 : 1.4);
      const opTop = yTop + size * 0.5 - opSize * 0.5; // 行の中央に重心
      const t = mkText(e.base, x, opTop + opSize * ASCENT, opSize, bold, color, false);
      items.push(t);
      const opRight = x + t._w;
      if (UNDEROVER.has(e.base)) {
        // ∑∏: 上下に極限を中央寄せで積む
        const cx = x + t._w / 2;
        let right = opRight;
        if (e.sup) { const up = placeCenteredAt(e.sup, cx, 0, size * SUB_SCALE, bold, color); shift(up.items, 0, opTop - up.bbox[3] - size * 0.02); items.push(...up.items); right = Math.max(right, up.bbox[2]); }
        if (e.sub) { const dn = placeCenteredAt(e.sub, cx, 0, size * SUB_SCALE, bold, color); shift(dn.items, 0, (opTop + opSize) - dn.bbox[1] + size * 0.02); items.push(...dn.items); right = Math.max(right, dn.bbox[2]); }
        return { items, width: right - x + size * 0.08 };
      }
      // ∫: 上限=記号の右上, 下限=記号の右下
      const lx = opRight + size * 0.02, ssz = size * SUB_SCALE;
      let right = lx;
      if (e.sup) { const up = placeSeq(e.sup, lx, 0, ssz, bold, color); shift(up.items, 0, (opTop + opSize * 0.30) - ssz * ASCENT); items.push(...up.items); right = Math.max(right, lx + up.width); }
      if (e.sub) { const dn = placeSeq(e.sub, lx, 0, ssz, bold, color); shift(dn.items, 0, (opTop + opSize * 0.88) - ssz * ASCENT); items.push(...dn.items); right = Math.max(right, lx + dn.width); }
      return { items, width: right - x + size * 0.10 };
    }

    // 通常文字 (化学は元素記号など立体)
    const t = mkText(e.base, x, baseline, size, bold, color, isVar(e.base) && !chemUpright);
    items.push(t);
    const ss = placeScripts(e, x + t._w + size * SUBSUP_GAP, yTop, size, bold, color);
    items.push(...ss.items);
    return { items, width: Math.max(x + t._w, ss.right) - x };
  }

  // 添字・上付き (右側) を配置。e.sub/e.sup を scriptX から置く。
  function placeScripts(e, scriptX, yTop, size, bold, color) {
    const items = [];
    let right = scriptX;
    const baseline = yTop + size * ASCENT;
    if (e.sup && isPrimeOnly(e.sup)) {
      // プライム f′ は ′(U+2032) を本体サイズ・本体ベースラインで描く
      // (′ グリフ自体が右上に位置するため、小さく持ち上げると浮きすぎる)。
      const t = mkText(primeStr(e.sup), scriptX, baseline, size * 0.92, bold, color, false);
      items.push(t); right = Math.max(right, scriptX + t._w);
    } else if (e.sup) {
      // placeSeq は yTop=0 で置くので現ベースライン = supSize*ASCENT。
      // 目標ベースライン = base baseline - size*SUP_SHIFT へ平行移動。
      const r = placeSeq(e.sup, scriptX, 0, size * SUP_SCALE, bold, color);
      shift(r.items, 0, (baseline - size * SUP_SHIFT) - size * SUP_SCALE * ASCENT);
      items.push(...r.items);
      right = Math.max(right, scriptX + r.width);
    }
    if (e.sub) {
      const r = placeSeq(e.sub, scriptX, 0, size * SUB_SCALE, bold, color);
      shift(r.items, 0, (baseline + size * SUB_SHIFT) - size * SUB_SCALE * ASCENT);
      items.push(...r.items);
      right = Math.max(right, scriptX + r.width);
    }
    return { items, right };
  }

  // 増減表カーブ矢印 (2次ベジエ)。kind: incUp/incDown/decUp/decDown
  function curveSample(P0, P1, P2, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; pts.push([u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0], u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1]]); }
    return pts;
  }
  function placeCurve(kind, x, yTop, size, color) {
    const w = size * 0.85, h = size * 0.9;
    const L = x + 0.12 * w, Rt = x + 0.88 * w, T = yTop + 0.12 * h, B = yTop + 0.88 * h;
    let P0, P1, P2;
    if (kind === "incUp") { P0 = [L, B]; P2 = [Rt, T]; P1 = [Rt, B]; }
    else if (kind === "incDown") { P0 = [L, B]; P2 = [Rt, T]; P1 = [L, T]; }
    else if (kind === "decUp") { P0 = [L, T]; P2 = [Rt, B]; P1 = [L, B]; }
    else { P0 = [L, T]; P2 = [Rt, B]; P1 = [Rt, T]; }
    const arc = curveSample(P0, P1, P2, 14);
    const prev = arc[arc.length - 2], end = P2;
    let dx = end[0] - prev[0], dy = end[1] - prev[1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const hl = size * 0.16, hw = size * 0.10, bx = end[0] - dx * hl, by = end[1] - dy * hl, nx = -dy, ny = dx;
    const pts = arc.concat([[bx + nx * hw, by + ny * hw], [end[0], end[1]], [bx - nx * hw, by - ny * hw]]);
    return { items: [{ t: "poly", pts, w: size * LINE_W, color }], width: w + size * 0.05 };
  }

  function placeFormula(src, xCm, yTopCm, sizeCm, bold, color) {
    chemUpright = /\\ce\{/.test(src); // 化学式は立体で描く
    const exprs = parseFormula(src);
    const r = placeSeq(exprs, xCm, yTopCm, sizeCm, bold, color || null);
    return { items: r.items, width: r.width };
  }

  return { placeFormula };
}
