// 数式組版 (Python handwriting_pptx/formula.py の JS 版)。
// createFormula(M) で生成。内部関数は M(metrics) を閉包で共有し、dict は引数で渡す。

import { strokeToPlaced } from "./layout.js";
import { fallbackUnknownGlyph } from "./dict.js";

const LATEX_MAP = {
  int: "∫", sum: "∑", sqrt: "√", pi: "π", theta: "θ", alpha: "α", beta: "β",
  gamma: "γ", lambda: "λ", mu: "μ", sigma: "σ", phi: "φ", omega: "ω", infty: "∞",
  leq: "≦", geq: "≧", neq: "≠", approx: "≈", pm: "±", times: "×", div: "÷",
  sim: "〜", equiv: "≡", propto: "∝",
  to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftrightarrow: "⇔", cdot: "・",
  cdots: "⋯", ldots: "…", dots: "…",
  nearrow: "↗", searrow: "↘", nwarrow: "↖", swarrow: "↙",
  therefore: "∴", because: "∵", qed: "□", square: "□", blacksquare: "∎", Box: "□",
};

const FUNCTION_NAMES = new Set([
  "sin", "cos", "tan", "log", "ln", "exp", "lim",
  "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
]);

const PRIME_CHARS = new Set(["'", '"', "’", "”", "′", "″"]);

// 増減表(2回微分)用のカーブ矢印。手書き登録不要の手続き描画。
// 増加/減少 × 下に凸(∪)/上に凸(∩) の4種。
const CURVE_KINDS = {
  incurveup: "incUp", incurvedown: "incDown",
  decurveup: "decUp", decurvedown: "decDown",
};
const CURVE_W = 0.85, CURVE_H = 0.90;

// 定数 (formula.py と一致)
const SUB_SUP_SCALE = 0.32;
const SUP_CENTER_Y = 0.05;
const SUB_CENTER_Y = 0.95;
const SUB_SUP_X_OFFSET = 0.08;
const ARG_SCALE = 1.0;
const BODY_LEFT_SHIFT = 0.90;
const SQRT_BODY_LEFT_SHIFT = 0.50;
const FN_CHAR_ADVANCE = 0.50;
const FN_TRAIL_GAP = 0.05;    // 関数名の実インク右端と引数の隙間 (font_size 比)
const LIM_SUB_SCALE = 0.50;
const LIM_SUB_VGAP = 0.0;     // \lim の下付きを本体下端の直下に (負にすると文字に重なる)
const VEC_GAP = 0.16;
const VEC_HEAD_LEN = 0.18;
const VEC_HEAD_HALFWIDTH = 0.07;
const VEC_MARGIN = 0.05;
const SYMBOL_VCENTER_RATIO = 0.6;
const FRAC_SCALE = 0.65;
const FRAC_BAR_MARGIN = 0.10;
const FRAC_VGAP = 0.22;

function Expr(o) {
  return {
    base: o.base !== undefined ? o.base : "",
    children: o.children || null, sub: o.sub || null, sup: o.sup || null,
    arg: o.arg || null, frac: o.frac || null, fn_name: o.fn_name || null, vec: o.vec || null,
    curve: o.curve || null,
  };
}

// ---------- パーサ ----------
class Parser {
  constructor(src) { this.s = src; this.i = 0; }
  peek() { return this.i < this.s.length ? this.s[this.i] : ""; }
  consume() { const c = this.peek(); this.i += 1; return c; }

  parseSequence(endChars = "") {
    const items = [];
    while (this.i < this.s.length) {
      const c = this.peek();
      if (c && endChars && endChars.includes(c)) break;
      const atom = this.parseAtom();
      if (atom === null) { this.consume(); continue; }
      while (true) {
        const p = this.peek();
        if (!p || !"^_".includes(p)) break;
        const op = this.consume();
        const mod = this.parseModifierArg();
        if (op === "^") atom.sup = mod; else atom.sub = mod;
      }
      items.push(atom);
    }
    return items;
  }

  parseAtom() {
    const c = this.peek();
    if (!c) return null;
    if (c === "{") {
      this.consume();
      const children = this.parseSequence("}");
      if (this.peek() === "}") this.consume();
      return Expr({ base: "", children });
    }
    if (c === "\\") {
      this.consume();
      const m = /^[a-zA-Z]+/.exec(this.s.slice(this.i));
      if (m) {
        const name = m[0];
        this.i += name.length;
        if (name === "frac") {
          const num = this.parseModifierArg();
          const denom = this.parseModifierArg();
          return Expr({ base: "", frac: [num, denom] });
        }
        if (name === "sqrt") {
          let index = null;
          if (this.peek() === "[") {
            this.consume();
            index = this.parseSequence("]");
            if (this.peek() === "]") this.consume();
          }
          const radicand = this.parseModifierArg();
          const expr = Expr({ base: "√", arg: radicand });
          if (index !== null) expr.sup = index;
          return expr;
        }
        if (name === "vec") return Expr({ base: "", vec: this.parseModifierArg() });
        if (CURVE_KINDS[name]) return Expr({ base: "", curve: CURVE_KINDS[name] });
        if (FUNCTION_NAMES.has(name)) return Expr({ base: "", fn_name: name });
        const sym = LATEX_MAP[name] || "";
        if (sym) return Expr({ base: sym });
        return Expr({ base: "" });
      }
      return null;
    }
    if (c === " " || c === "\t" || c === "\n") { this.consume(); return Expr({ base: " " }); }
    return Expr({ base: this.consume() });
  }

  parseModifierArg() {
    const c = this.peek();
    if (c === "{") {
      this.consume();
      const items = this.parseSequence("}");
      if (this.peek() === "}") this.consume();
      return items;
    }
    const atom = this.parseAtom();
    return atom ? [atom] : [];
  }
}

function mergePrimesIntoSup(exprs) {
  const out = [];
  let i = 0;
  const n = exprs.length;
  while (i < n) {
    const e = exprs[i];
    if (e.base && e.base.length === 1 && /[a-zA-Z]/.test(e.base)) {
      const primes = [];
      let j = i + 1;
      while (j < n && PRIME_CHARS.has(exprs[j].base) && exprs[j].sub === null && exprs[j].sup === null) {
        primes.push(exprs[j]); j += 1;
      }
      if (primes.length) {
        const existing = e.sup || [];
        e.sup = primes.concat(existing);
        out.push(e);
        i = j;
        continue;
      }
    }
    out.push(e);
    i += 1;
  }
  return out;
}

export function parseFormula(src) {
  return mergePrimesIntoSup(new Parser(src).parseSequence());
}

// placed stroke を絶対座標から直接作る
function mkPlaced(points_cm, pressures) {
  return { points_cm, pressures: pressures || null, bold: false, color: null };
}

export function createFormula(M) {
  function formulaMetrics(ch) { return M.formulaMetrics(ch); }
  function anchorNudge(ch, t) { return M.anchorNudge(ch, t); }

  function strokesBbox(strokes) {
    const xs = [], ys = [];
    for (const s of strokes) for (const [x, y] of s.points_cm) { xs.push(x); ys.push(y); }
    if (!xs.length) return [0, 0, 0, 0];
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  function placeAtom(e, x, y, size, dict) {
    const placed = [];
    if (e.base === " ") return [placed, size * 0.20, { char: " ", strokes: [], anchors: [], coord_space: "bbox" }];
    if (e.base === "　") return [placed, size * 0.45, { char: " ", strokes: [], anchors: [], coord_space: "bbox" }];
    if (e.base === "") return [placed, 0.0, { char: "", strokes: [], anchors: [], coord_space: "bbox" }];

    let g = dict.glyph(e.base);
    if (g === null) g = fallbackUnknownGlyph(e.base);
    // em 字を数式で使う場合の扱い:
    //  - 英字 (A-Za-z): 大文字小文字のサイズを揃えるため、ストローク高さを size に正規化。
    //  - 記号 (+, =, < 等): 描いた占有比率・位置のまま (size基準・cap=y/baseline=y+size)。
    //    → + や = の大きさ・上下位置がそのまま反映される。
    if (g.coord_space === "em") {
      const xs = [], ys = [];
      for (const s of g.strokes) for (const p of s.points) { xs.push(p[0]); ys.push(p[1]); }
      if (!xs.length) { g._placed_size = size; g._placed_y_offset = 0.0; return [placed, size * 0.3, g]; }
      const xmin = Math.min(...xs), xmax = Math.max(...xs);
      if (/[A-Za-z]/.test(e.base)) {
        const ymin = Math.min(...ys), ymax = Math.max(...ys);
        const sc = size / Math.max(ymax - ymin, 1e-6);
        const xOff = x - xmin * sc, yOff = y - ymin * sc;
        for (const s of g.strokes) placed.push(strokeToPlaced(s, xOff, yOff, sc, null, false, null));
        g._placed_size = size; g._placed_y_offset = 0.0;
        return [placed, (xmax - xmin) * sc + size * 0.05, g];
      }
      const xOff = x - xmin * size;
      for (const s of g.strokes) placed.push(strokeToPlaced(s, xOff, y, size, null, false, null));
      g._placed_size = size; g._placed_y_offset = 0.0;
      return [placed, (xmax - xmin) * size + size * 0.05, g];
    }
    const [relSize, valign, advFactor] = formulaMetrics(e.base);
    const glyphSize = size * relSize;
    let yOffset, advance;

    if (g.coord_space === "canvas") {
      const strokePts = [];
      for (const s of g.strokes) for (const p of s.points) strokePts.push(p);
      if (!strokePts.length) {
        advance = glyphSize; g._placed_size = glyphSize; g._placed_y_offset = 0.0;
        return [placed, advance, g];
      }
      const sxMin = Math.min(...strokePts.map((p) => p[0]));
      const sxMax = Math.max(...strokePts.map((p) => p[0]));
      const syMin = Math.min(...strokePts.map((p) => p[1]));
      const syMax = Math.max(...strokePts.map((p) => p[1]));
      const bbH = Math.max(syMax - syMin, 1e-6);
      const scale = (size * relSize) / bbH;
      const overflow = Math.max(0.0, (relSize - 1.0) * size);
      const vshift = overflow * SYMBOL_VCENTER_RATIO;
      const xOff = x - sxMin * scale;
      const yOff = y - syMin * scale - vshift;
      for (const s of g.strokes) placed.push(strokeToPlaced(s, xOff, yOff, scale, null, false, null));
      advance = advFactor !== null ? size * advFactor : (sxMax - sxMin) * scale + size * 0.05;
      g._placed_scale = scale; g._placed_canvas_x_off = xOff; g._placed_canvas_y_off = yOff;
      yOffset = yOff;
    } else {
      if (valign === "middle") yOffset = (size - glyphSize) / 2;
      else if (valign === "bottom") yOffset = size - glyphSize;
      else yOffset = 0.0;
      advance = advFactor !== null ? size * advFactor : glyphSize + size * 0.03;
      let xOffset = 0.0;
      if (advFactor !== null && g.strokes.length) {
        const nxs = [];
        for (const s of g.strokes) for (const p of s.points) nxs.push(p[0]);
        if (nxs.length) {
          const normCx = (Math.min(...nxs) + Math.max(...nxs)) / 2;
          xOffset = advance / 2 - normCx * glyphSize;
        }
      }
      for (const s of g.strokes) placed.push(strokeToPlaced(s, x + xOffset, y + yOffset, glyphSize, null, false, null));
    }
    g._placed_size = glyphSize;
    g._placed_y_offset = yOffset;
    return [placed, advance, g];
  }

  function anchorWorld(g, type, baseX, baseY) {
    // metrics によるアンカー位置上書き (登録時の sub/sup 逆転などをデータで修正)
    const ov = M.anchorPos(g.char, type);
    if (g.coord_space === "canvas") {
      const scale = g._placed_scale !== undefined ? g._placed_scale : 0.0;
      const xOff = g._placed_canvas_x_off !== undefined ? g._placed_canvas_x_off : baseX;
      const yOff = g._placed_canvas_y_off !== undefined ? g._placed_canvas_y_off : baseY;
      if (ov) return [xOff + ov[0] * scale, yOff + ov[1] * scale];
      for (const a of g.anchors) if (a.type === type) return [xOff + a.x * scale, yOff + a.y * scale];
      return null;
    }
    const glyphSize = g._placed_size !== undefined ? g._placed_size : 0.0;
    const yOff = g._placed_y_offset !== undefined ? g._placed_y_offset : 0.0;
    if (ov) return [baseX + ov[0] * glyphSize, baseY + yOff + ov[1] * glyphSize];
    for (const a of g.anchors) if (a.type === type) return [baseX + a.x * glyphSize, baseY + yOff + a.y * glyphSize];
    return null;
  }

  // leftAlign=true のとき水平中央揃えでなく「左端を centerX に合わせる」(複数文字の指数/添字用)。
  function placeCentered(exprs, centerX, centerY, size, dict, leftAlign) {
    let cursor = 0.0;
    const tmp = [];
    for (const e of exprs) { const [ps, w] = placeExpr(e, cursor, 0.0, size, dict); tmp.push(...ps); cursor += w; }
    const [xMin, yMin, xMax, yMax] = strokesBbox(tmp);
    const dx = leftAlign ? (centerX - xMin) : (centerX - (xMin + xMax) / 2);
    const dy = centerY - (yMin + yMax) / 2;
    const shifted = tmp.map((s) => ({ points_cm: s.points_cm.map(([px, py]) => [px + dx, py + dy]), pressures: s.pressures ? [...s.pressures] : [], bold: s.bold, color: s.color }));
    return [shifted, [xMin + dx, yMin + dy, xMax + dx, yMax + dy]];
  }

  function shiftStrokes(strokes, dx, dy) {
    return strokes.map((s) => ({ points_cm: s.points_cm.map(([px, py]) => [px + dx, py + dy]), pressures: s.pressures ? [...s.pressures] : [], bold: s.bold, color: s.color }));
  }

  function layoutSequenceOrigin(exprs, size, dict) {
    let cursor = 0.0;
    const placed = [];
    for (const e of exprs) { const [ps, w] = placeExpr(e, cursor, 0.0, size, dict); placed.push(...ps); cursor += w; }
    let width = cursor;
    if (placed.length) {
      const xs = []; for (const s of placed) for (const p of s.points_cm) xs.push(p[0]);
      width = xs.length ? Math.max(...xs) - Math.min(...xs) : cursor;
    }
    return [placed, Math.max(width, cursor), 0.0];
  }

  function makeVecArrow(leftX, rightX, yTop, size) {
    const margin = size * VEC_MARGIN;
    let lineLeft = leftX + margin, lineRight = rightX - margin;
    if (lineRight <= lineLeft) { lineRight = leftX + Math.max(size * 0.2, rightX - leftX); lineLeft = leftX; }
    const headLen = size * VEC_HEAD_LEN, headHw = size * VEC_HEAD_HALFWIDTH;
    const pts = [[lineLeft, yTop], [lineRight, yTop], [lineRight - headLen, yTop - headHw], [lineRight, yTop], [lineRight - headLen, yTop + headHw]];
    return mkPlaced(pts, pts.map(() => 0.35));
  }

  // 2次ベジエを n 分割してポリライン化 (Python と同一式)
  function curveSample(P0, P1, P2, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push([u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0],
                u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1]]);
    }
    return pts;
  }

  // 増減表カーブ矢印 (手続き描画)。kind: incUp/incDown/decUp/decDown
  function makeCurveArrow(kind, x, y, size) {
    const w = size * CURVE_W, h = size * CURVE_H;
    const L = x + 0.12 * w, Rt = x + 0.88 * w, T = y + 0.12 * h, B = y + 0.88 * h;
    let P0, P1, P2;
    if (kind === "incUp") { P0 = [L, B]; P2 = [Rt, T]; P1 = [Rt, B]; }       // 増加・下に凸 ∪
    else if (kind === "incDown") { P0 = [L, B]; P2 = [Rt, T]; P1 = [L, T]; } // 増加・上に凸 ∩
    else if (kind === "decUp") { P0 = [L, T]; P2 = [Rt, B]; P1 = [L, B]; }   // 減少・下に凸 ∪
    else { P0 = [L, T]; P2 = [Rt, B]; P1 = [Rt, T]; }                        // 減少・上に凸 ∩
    const arc = curveSample(P0, P1, P2, 14);
    const prev = arc[arc.length - 2], end = P2;
    let dx = end[0] - prev[0], dy = end[1] - prev[1];
    const len = Math.sqrt(dx * dx + dy * dy) || 1; dx /= len; dy /= len;
    const hl = size * 0.16, hw = size * 0.10;
    const bx = end[0] - dx * hl, by = end[1] - dy * hl;
    const nx = -dy, ny = dx;
    const barb1 = [bx + nx * hw, by + ny * hw];
    const barb2 = [bx - nx * hw, by - ny * hw];
    const pts = arc.concat([barb1, [end[0], end[1]], barb2]);
    return mkPlaced(pts, pts.map(() => 0.4));
  }

  function placeCurve(kind, x, y, size) {
    const s = makeCurveArrow(kind, x, y, size);
    return [[s], size * CURVE_W + size * 0.05, [{ start: 0, end: 1 }]];
  }

  function placeVector(e, x, y, size, dict) {
    const placed = [];
    let cursor = x;
    for (const child of e.vec || []) { const [ps, w] = placeExpr(child, cursor, y, size, dict); placed.push(...ps); cursor += w; }
    if (!placed.length) return [placed, cursor - x, []];
    const contentEnd = placed.length; // 矢印より前 = ベクトル本体
    const xs = [], ys = [];
    for (const s of placed) for (const p of s.points_cm) { xs.push(p[0]); ys.push(p[1]); }
    const arrowY = Math.min(...ys) - size * VEC_GAP;
    placed.push(makeVecArrow(Math.min(...xs), Math.max(...xs), arrowY, size));
    const parts = [];
    if (contentEnd > 0) parts.push({ start: 0, end: contentEnd }); // 本体
    parts.push({ start: contentEnd, end: placed.length });          // 矢印
    return [placed, cursor - x, parts];
  }

  function placeFunction(e, x, y, size, dict) {
    const placed = [];
    const name = e.fn_name || "";
    if (name && dict.has(name)) {
      return placeExpr(Expr({ base: name, sub: e.sub, sup: e.sup, arg: e.arg }), x, y, size, dict);
    }
    let cursor = x;
    const glyphSize = size;
    const parts = [];
    const nameStart = placed.length; // = 0
    for (const ch of name) {
      let g = dict.glyph(ch);
      if (g === null) g = fallbackUnknownGlyph(ch);
      const advance = size * FN_CHAR_ADVANCE;
      if (g.strokes.length) {
        const nxs = []; for (const s of g.strokes) for (const p of s.points) nxs.push(p[0]);
        let xOffset = 0.0;
        if (nxs.length) { const normCx = (Math.min(...nxs) + Math.max(...nxs)) / 2; xOffset = advance / 2 - normCx * glyphSize; }
        for (const s of g.strokes) placed.push(strokeToPlaced(s, cursor + xOffset, y, glyphSize, null, false, null));
      }
      cursor += advance;
    }
    // 固定advanceは視覚幅を過小評価する(n,m 等が広く描かれる)。実インク右端を基準に
    // 引数/添字を置き、引数が名前末尾に重ならないようにする。
    let nameInkRight = cursor;
    for (let k = nameStart; k < placed.length; k++) for (const p of placed[k].points_cm) if (p[0] > nameInkRight) nameInkRight = p[0];
    cursor = nameInkRight + size * FN_TRAIL_GAP;
    const nameRight = nameInkRight;
    const nameCx = (x + nameRight) / 2;
    if (placed.length > nameStart) parts.push({ start: nameStart, end: placed.length }); // 関数名

    if (e.sup) {
      const supStart = placed.length;
      const supSize = size * SUB_SUP_SCALE;
      const [sp, sb] = placeCentered(e.sup, nameRight + size * SUB_SUP_X_OFFSET, y + size * SUP_CENTER_Y, supSize, dict, e.sup.length > 1);
      placed.push(...sp); cursor = Math.max(cursor, sb[2] + size * 0.03);
      if (placed.length > supStart) parts.push({ start: supStart, end: placed.length });
    }
    if (e.sub) {
      const subStart = placed.length;
      if (name === "lim") {
        const limSubSize = size * LIM_SUB_SCALE;
        const [subPlaced, subW] = layoutSequenceOrigin(e.sub, limSubSize, dict);
        const targetY = y + size + size * LIM_SUB_VGAP;
        const targetX = nameCx - subW / 2;
        if (subPlaced.length) {
          const sxMin = Math.min(...subPlaced.flatMap((s) => s.points_cm.map((p) => p[0])));
          const syMin = Math.min(...subPlaced.flatMap((s) => s.points_cm.map((p) => p[1])));
          placed.push(...shiftStrokes(subPlaced, targetX - sxMin, targetY - syMin));
          // 下付き(x→0等)は真下に置くだけ。後続(被作用関数)は名前幅基準で続けて
          // 左に詰める (下付きが幅広でも右に押し出さない。下に潜り込んでOK)。
        }
      } else {
        const subSize = size * SUB_SUP_SCALE;
        const [sp, sb] = placeCentered(e.sub, nameRight + size * SUB_SUP_X_OFFSET, y + size * SUB_CENTER_Y, subSize, dict, e.sub.length > 1);
        placed.push(...sp); cursor = Math.max(cursor, sb[2] + size * 0.03);
      }
      if (placed.length > subStart) parts.push({ start: subStart, end: placed.length });
    }
    return [placed, cursor - x, parts];
  }

  function placeFraction(num, denom, x, y, size, dict) {
    const fracSize = size * FRAC_SCALE;
    const [numPlaced, numW] = layoutSequenceOrigin(num, fracSize, dict);
    const [denomPlaced, denomW] = layoutSequenceOrigin(denom, fracSize, dict);
    let barW = Math.max(numW, denomW) * (1.0 + FRAC_BAR_MARGIN * 2);
    barW = Math.max(barW, fracSize * 0.3);
    const barY = y + size * 0.5;
    const barLeftX = x, barRightX = barLeftX + barW;

    const barCx = barLeftX + barW / 2; // バー中心。num/denom の実インク中心をここに合わせる
    const numTargetY = barY - fracSize - size * FRAC_VGAP;
    let numShifted = [];
    if (numPlaced.length) {
      const nxs = numPlaced.flatMap((s) => s.points_cm.map((p) => p[0]));
      const nyMin = Math.min(...numPlaced.flatMap((s) => s.points_cm.map((p) => p[1])));
      const numCx = (Math.min(...nxs) + Math.max(...nxs)) / 2;
      numShifted = shiftStrokes(numPlaced, barCx - numCx, numTargetY - nyMin);
    }
    const denomTargetY = barY + size * FRAC_VGAP;
    let denomShifted = [];
    if (denomPlaced.length) {
      const dxs = denomPlaced.flatMap((s) => s.points_cm.map((p) => p[0]));
      const dyMin = Math.min(...denomPlaced.flatMap((s) => s.points_cm.map((p) => p[1])));
      const denomCx = (Math.min(...dxs) + Math.max(...dxs)) / 2;
      denomShifted = shiftStrokes(denomPlaced, barCx - denomCx, denomTargetY - dyMin);
    }
    const bar = mkPlaced([[barLeftX, barY], [barRightX, barY]], [0.35, 0.35]);
    const all = numShifted.concat([bar], denomShifted);
    // parts: 分子 / バー / 分母 をそれぞれ個別編集対象に
    const parts = [];
    const numN = numShifted.length;
    if (numN > 0) parts.push({ start: 0, end: numN });          // 分子
    parts.push({ start: numN, end: numN + 1 });                  // 分数バー
    if (denomShifted.length > 0) parts.push({ start: numN + 1, end: all.length }); // 分母
    return [all, barW + size * 0.05, parts];
  }

  function placeExpr(e, x, y, size, dict) {
    const placed = [];
    if (e.frac !== null) return placeFraction(e.frac[0], e.frac[1], x, y, size, dict);
    if (e.fn_name !== null) return placeFunction(e, x, y, size, dict);
    if (e.vec !== null) return placeVector(e, x, y, size, dict);
    if (e.curve !== null) return placeCurve(e.curve, x, y, size);

    if (e.base === "" && e.children !== null) {
      const parts = [];
      let cursor = x;
      const contentStart = placed.length; // = 0
      for (const child of e.children) { const [ps, w] = placeExpr(child, cursor, y, size, dict); placed.push(...ps); cursor += w; }
      if (placed.length > contentStart) parts.push({ start: contentStart, end: placed.length }); // 本体
      let advance = cursor - x;
      const right = cursor;
      if (e.sup) {
        const supStart = placed.length;
        const supSize = size * SUB_SUP_SCALE;
        const [sp] = placeCentered(e.sup, right, y + supSize / 2, supSize, dict, e.sup.length > 1);
        placed.push(...sp); const bb = strokesBbox(sp); advance = Math.max(advance, bb[2] - x);
        if (placed.length > supStart) parts.push({ start: supStart, end: placed.length });
      }
      if (e.sub) {
        const subStart = placed.length;
        const subSize = size * SUB_SUP_SCALE;
        const [sp] = placeCentered(e.sub, right, y + size - subSize / 2, subSize, dict, e.sub.length > 1);
        placed.push(...sp); const bb = strokesBbox(sp); advance = Math.max(advance, bb[2] - x);
        if (placed.length > subStart) parts.push({ start: subStart, end: placed.length });
      }
      return [placed, advance, parts];
    }

    const parts = [];
    const baseStart = placed.length; // = 0
    const [basePs, baseAdv, g] = placeAtom(e, x, y, size, dict);
    placed.push(...basePs);
    const baseEnd = placed.length;
    if (baseEnd > baseStart) parts.push({ start: baseStart, end: baseEnd }); // 基底文字 (√,∫,∑,通常文字 等)
    let rightAfterBase = x + baseAdv;
    let sqrtHandled = false;
    let argRangeStart = -1;

    if (e.base === "√" && e.arg !== null && basePs.length) {
      const lastIdx = placed.length - 1;
      const last = placed[lastIdx];
      let barYWorld;
      if (last.points_cm.length) barYWorld = last.points_cm[last.points_cm.length - 1][1];
      else { const ba = anchorWorld(g, "body", x, y); barYWorld = ba ? ba[1] : y; }
      const bodyAnchor = anchorWorld(g, "body", x, y);
      const bx = bodyAnchor ? bodyAnchor[0] - size * SQRT_BODY_LEFT_SHIFT : rightAfterBase;
      const radPlaced = [];
      let radCursorX = bx;
      for (const child of e.arg) { const [ps, w] = placeExpr(child, radCursorX, y, size, dict); radPlaced.push(...ps); radCursorX += w; }
      let radRight;
      if (radPlaced.length) radRight = Math.max(...radPlaced.flatMap((s) => s.points_cm.map((p) => p[0]))) + size * 0.05;
      else radRight = radCursorX + size * 0.05;
      if (last.points_cm.length) {
        const newPts = last.points_cm.concat([[radRight, barYWorld]]);
        let basePres = last.pressures && last.pressures.length ? [...last.pressures] : last.points_cm.map(() => 0.5);
        const newPres = basePres.slice(0, -1).concat([0.30, 0.30]);
        placed[lastIdx] = { points_cm: newPts, pressures: newPres, bold: false, color: null };
      }
      argRangeStart = placed.length;
      placed.push(...radPlaced);
      if (placed.length > argRangeStart) parts.push({ start: argRangeStart, end: placed.length }); // √ の中身
      rightAfterBase = Math.max(rightAfterBase, radRight);
      sqrtHandled = true;
    }

    if (e.sub) {
      const subStart = placed.length;
      const subSize = size * SUB_SUP_SCALE;
      const anchor = anchorWorld(g, "sub", x, y);
      let cx, cy;
      if (anchor === null) { cx = rightAfterBase + size * SUB_SUP_X_OFFSET; cy = y + size * SUB_CENTER_Y; }
      else { [cx, cy] = anchor; }
      const [ndx, ndy] = anchorNudge(e.base, "sub");
      cx += ndx * size; cy += ndy * size;
      // 複数文字の添字 (通常文字基底・アンカー無し) は左揃え。∫/∑ の下限(アンカー有)は中央のまま。
      const [sp, sb] = placeCentered(e.sub, cx, cy, subSize, dict, anchor === null && e.sub.length > 1);
      placed.push(...sp);
      if (anchor === null) rightAfterBase = Math.max(rightAfterBase, sb[2] + size * 0.03);
      if (placed.length > subStart) parts.push({ start: subStart, end: placed.length }); // 下添字 (下限など)
    }

    if (e.sup) {
      const supStart = placed.length;
      const supSize = size * SUB_SUP_SCALE;
      const anchor = anchorWorld(g, "sup", x, y);
      let cx, cy;
      if (anchor === null) { cx = rightAfterBase + size * SUB_SUP_X_OFFSET; cy = y + size * SUP_CENTER_Y; }
      else { [cx, cy] = anchor; }
      const [ndx, ndy] = anchorNudge(e.base, "sup");
      cx += ndx * size; cy += ndy * size;
      // 複数文字の指数 (n-1 等・アンカー無し) は左揃え。∫/∑ の上限(アンカー有)は中央のまま。
      const [sp, sb] = placeCentered(e.sup, cx, cy, supSize, dict, anchor === null && e.sup.length > 1);
      placed.push(...sp);
      if (anchor === null) rightAfterBase = Math.max(rightAfterBase, sb[2] + size * 0.03);
      if (placed.length > supStart) parts.push({ start: supStart, end: placed.length }); // 上添字 (上限など)
    }

    if (!sqrtHandled) {
      const bodyAnchor = anchorWorld(g, "body", x, y);
      if (bodyAnchor !== null) {
        const [bndx] = anchorNudge(e.base, "body"); // body 起点の水平微調整 (記号別)
        rightAfterBase = Math.max(x, bodyAnchor[0] - size * BODY_LEFT_SHIFT + bndx * size);
      }
    }

    if (e.arg && !sqrtHandled) {
      const anchor = anchorWorld(g, "body", x, y);
      if (anchor !== null) {
        const argStart = placed.length;
        let [axCursor, ay] = anchor;
        for (const child of e.arg) { const [ps, w] = placeExpr(child, axCursor, ay - size / 2, size * ARG_SCALE, dict); placed.push(...ps); axCursor += w; }
        rightAfterBase = Math.max(rightAfterBase, axCursor);
        if (placed.length > argStart) parts.push({ start: argStart, end: placed.length }); // 本体 (被積分関数など)
      }
    }

    return [placed, rightAfterBase - x, parts];
  }

  // parts: 数式内の各サブ要素のストローク範囲 [{start,end}] (placed に対する index)。
  // 文字単位編集で「分子/分母/上限/下限/本体」などを個別に動かすために layout 側で使う。
  function placeFormula(src, xCm, yCm, sizeCm, dict) {
    const exprs = parseFormula(src);
    let cursor = xCm;
    const placed = [];
    const parts = [];
    for (const e of exprs) {
      const before = placed.length;
      const [ps, w, eparts] = placeExpr(e, cursor, yCm, sizeCm, dict);
      placed.push(...ps);
      const after = placed.length;
      if (eparts && eparts.length) {
        for (const p of eparts) parts.push({ start: p.start + before, end: p.end + before });
      } else if (after > before) {
        parts.push({ start: before, end: after }); // サブ構造なし = まるごと1要素
      }
      cursor += w;
    }
    return [placed, cursor - xCm, parts];
  }

  return { parseFormula, placeFormula, placeExpr };
}
