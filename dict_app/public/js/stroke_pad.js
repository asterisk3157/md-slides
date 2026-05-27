// 共通の手書きパッドコンポーネント
// char.html と bulk.html の両方から使う。
//
// 使い方:
//   const pad = new StrokePad(canvasEl, { lineWidth: 3 });
//   pad.setGhost("あ");        // 背景に薄く文字ガイドを表示（HTML側 .ghost を制御）
//   pad.clear();
//   pad.undo();
//   await pad.preview();       // 描画順アニメ再生 (200ms/stroke)
//   const norm = pad.exportNormalized();  // {strokes, bbox, advance} を返す
//   pad.getStrokes();          // 生のCSS座標ストローク配列

// アンカーの種類 → 表示色 とラベル
const ANCHOR_TYPES = {
  sub:  { color: "#2563eb", label: "下" },   // 下添字
  sup:  { color: "#dc2626", label: "上" },   // 上添字
  body: { color: "#16a34a", label: "本" },   // 本体（被積分関数等の開始位置）
};

// テキスト字 (em座標) 登録用の基準線。canvas 高さに対する比。em = baseline - cap。
// 描いた占有比率・ベースラインがそのまま出力に反映される (大文字小文字/記号も自動)。
const BASELINE_GRID = { cap: 0.20, xh: 0.45, base: 0.75, desc: 0.92 };

class StrokePad {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.lineWidth = opts.lineWidth ?? 3;
    this.strokeColor = opts.strokeColor ?? "#000";
    this.strokes = [];       // [{points:[[x,y],...], pressures:[...]}, ...]
    this._current = null;
    this._drawing = false;
    this._ghostEl = opts.ghostEl ?? null;
    this._anchors = [];      // [{type, x, y}, ...]  (CSS座標)
    this._anchorMode = null; // null | "sub" | "sup" | "body"
    this._onAnchorChange = opts.onAnchorChange ?? null;
    this._guide = null;      // null | { description, regions: [...] } 正規化座標
    this._baselineGrid = false; // テキスト字を em 座標で登録するモード (基準線表示)

    this._setupCanvas();
    window.addEventListener("resize", () => this._setupCanvas());

    // ★ display:none → 表示など、canvas のCSSサイズ変化を自動追従
    // 描画中は setupCanvas を呼ばない (clearRect で入力が消えるのを避ける)
    if (typeof ResizeObserver !== "undefined") {
      let raf = null;
      this._ro = new ResizeObserver(() => {
        if (this._drawing) return;
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          raf = null;
          if (!this._drawing) this._setupCanvas();
        });
      });
      this._ro.observe(canvas);
    }

    canvas.addEventListener("pointerdown", (e) => this._onDown(e), { passive: false });
    canvas.addEventListener("pointermove", (e) => this._onMove(e), { passive: false });
    canvas.addEventListener("pointerup",   (e) => this._onUp(e), { passive: false });
    canvas.addEventListener("pointercancel", (e) => this._onUp(e), { passive: false });
    canvas.addEventListener("pointerleave", (e) => this._onUp(e), { passive: false });
    // Safari の double-tap や text selection を確実に潰すため、touch 系も止める
    const swallow = (e) => e.preventDefault();
    canvas.addEventListener("touchstart", swallow, { passive: false });
    canvas.addEventListener("touchend",   swallow, { passive: false });
    canvas.addEventListener("touchmove",  swallow, { passive: false });
    canvas.addEventListener("gesturestart", swallow, { passive: false });
    canvas.addEventListener("dblclick",     swallow, { passive: false });
    canvas.addEventListener("contextmenu",  swallow);
  }

  setGhost(text) {
    if (this._ghostEl) this._ghostEl.textContent = text || "";
  }

  _setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width || 400;
    const cssH = rect.height || 400;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._redraw();
  }

  _cssSize() {
    const rect = this.canvas.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }

  _pointFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      p: typeof e.pressure === "number" && e.pressure > 0 ? e.pressure : 0.5,
    };
  }

  _onDown(e) {
    e.preventDefault();
    const pt = this._pointFromEvent(e);

    // 前回のストロークがまだ閉じられていない場合 (pointercancel 等で残っている)
    // → flush して新しいストロークを開始できる状態に
    if (this._drawing && this._current) {
      if (this._current.points.length >= 1) {
        this.strokes.push(this._current);
      }
      this._current = null;
      this._drawing = false;
    }

    // アンカーモード中はクリックでアンカー追加
    if (this._anchorMode) {
      this._addAnchor(this._anchorMode, pt.x, pt.y);
      this._anchorMode = null;   // 単発モード
      if (this._onAnchorChange) this._onAnchorChange(this._anchors);
      return;
    }
    // 既存アンカーの近接クリックで削除（半径20px以内）
    const hitIdx = this._anchors.findIndex(
      (a) => Math.hypot(a.x - pt.x, a.y - pt.y) < 20
    );
    if (hitIdx >= 0) {
      this._anchors.splice(hitIdx, 1);
      this._redraw();
      if (this._onAnchorChange) this._onAnchorChange(this._anchors);
      return;
    }

    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
    this._drawing = true;
    this._current = { points: [[pt.x, pt.y]], pressures: [pt.p] };
  }

  _onMove(e) {
    if (!this._drawing || !this._current) return;
    e.preventDefault();
    const pt = this._pointFromEvent(e);
    const last = this._current.points[this._current.points.length - 1];
    const dx = pt.x - last[0];
    const dy = pt.y - last[1];
    // 0.25px 未満のみスキップ (取りこぼし回避のため閾値を緩く)
    if (dx * dx + dy * dy < 0.0625) return;
    this._current.points.push([pt.x, pt.y]);
    this._current.pressures.push(pt.p);

    this._setStrokeStyle();
    this.ctx.beginPath();
    this.ctx.moveTo(last[0], last[1]);
    this.ctx.lineTo(pt.x, pt.y);
    this.ctx.stroke();
  }

  _addAnchor(type, x, y) {
    // 同じtypeのアンカーは1つだけ（複数置きたければここを変える）
    this._anchors = this._anchors.filter((a) => a.type !== type);
    this._anchors.push({ type, x, y });
    this._redraw();
  }

  _drawAnchors() {
    for (const a of this._anchors) {
      const info = ANCHOR_TYPES[a.type] || { color: "#666", label: a.type[0] };
      // 中抜き○
      this.ctx.strokeStyle = info.color;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(a.x, a.y, 8, 0, Math.PI * 2);
      this.ctx.stroke();
      // 中央点
      this.ctx.fillStyle = info.color;
      this.ctx.beginPath();
      this.ctx.arc(a.x, a.y, 2, 0, Math.PI * 2);
      this.ctx.fill();
      // ラベル
      this.ctx.font = "10px -apple-system, sans-serif";
      this.ctx.fillStyle = info.color;
      this.ctx.textAlign = "left";
      this.ctx.textBaseline = "top";
      this.ctx.fillText(info.label, a.x + 10, a.y - 4);
    }
  }

  _onUp(e) {
    if (!this._drawing) return;
    this._drawing = false;
    // ポインタキャプチャを明示的に解放 (次のストロークが受け付けられないバグ防止)
    if (e && e.pointerId !== undefined) {
      try {
        if (this.canvas.hasPointerCapture && this.canvas.hasPointerCapture(e.pointerId)) {
          this.canvas.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
    }
    // 1点ストロークも許可（「・」等の点字用）
    if (this._current && this._current.points.length >= 1) {
      this.strokes.push(this._current);
      if (this._current.points.length === 1) this._redraw();
    }
    this._current = null;
  }

  _setStrokeStyle() {
    this.ctx.lineWidth = this.lineWidth;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.strokeStyle = this.strokeColor;
  }

  _clearCanvas() {
    const { w, h } = this._cssSize();
    this.ctx.clearRect(0, 0, w, h);
  }

  _redraw() {
    this._clearCanvas();
    this._drawGuide();           // ガイドを最下層に
    this._drawBaselineGrid();    // テキスト字の基準線
    this._setStrokeStyle();
    for (const s of this.strokes) this._drawStroke(s);
    this._drawAnchors();
  }

  setBaselineGrid(on) {
    this._baselineGrid = !!on;
    // テキスト字モードでは漢字練習帳の方眼(25/50/75%)を消し、基準線だけ表示して
    // 「マス目と基準線がズレて見える」のを防ぐ。
    if (this.canvas) this.canvas.classList.toggle("baseline-mode", !!on);
    this._redraw();
  }

  _drawBaselineGrid() {
    if (!this._baselineGrid) return;
    const { w, h } = this._cssSize();
    this.ctx.save();
    this.ctx.lineWidth = 1;
    this.ctx.font = "10px -apple-system, sans-serif";
    this.ctx.textBaseline = "bottom";
    const lines = [
      { y: BASELINE_GRID.cap,  label: "大文字・上端",      color: "rgba(150,150,150,0.6)", dash: [4, 4] },
      { y: BASELINE_GRID.xh,   label: "小文字 (x-height)", color: "rgba(37,99,235,0.45)", dash: [4, 4] },
      { y: BASELINE_GRID.base, label: "ベースライン",      color: "rgba(220,38,38,0.7)",  dash: [] },
      { y: BASELINE_GRID.desc, label: "下端 (g p y)",      color: "rgba(150,150,150,0.5)", dash: [4, 4] },
    ];
    for (const ln of lines) {
      this.ctx.setLineDash(ln.dash);
      this.ctx.strokeStyle = ln.color;
      this.ctx.beginPath();
      this.ctx.moveTo(0, ln.y * h);
      this.ctx.lineTo(w, ln.y * h);
      this.ctx.stroke();
      this.ctx.fillStyle = ln.color;
      this.ctx.fillText(ln.label, 4, ln.y * h - 2);
    }
    this.ctx.restore();
  }

  _drawGuide() {
    if (!this._guide || !this._guide.regions) return;
    const { w, h } = this._cssSize();
    this.ctx.save();
    this.ctx.setLineDash([6, 4]);
    this.ctx.lineWidth = 1.2;
    this.ctx.font = "11px -apple-system, sans-serif";
    this.ctx.textBaseline = "top";
    for (const r of this._guide.regions) {
      // 種別ごとに色
      const color =
        r.kind === "body" ? "rgba(120,120,120,0.8)" :
        r.kind === "sub"  ? "rgba(37,99,235,0.6)" :
        r.kind === "sup"  ? "rgba(220,38,38,0.6)" :
        r.kind === "arg"  ? "rgba(22,163,74,0.5)" :
                            "rgba(120,120,120,0.6)";
      this.ctx.strokeStyle = color;
      this.ctx.fillStyle = color;
      if (Array.isArray(r.points)) {
        // 多角形 (例: 平行四辺形で斜め本体ガイド)
        const pts = r.points.map(([px, py]) => [px * w, py * h]);
        this.ctx.beginPath();
        this.ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) this.ctx.lineTo(pts[i][0], pts[i][1]);
        this.ctx.closePath();
        this.ctx.stroke();
        if (r.label) {
          // ラベル位置: 重心
          const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
          const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
          this.ctx.fillText(r.label, cx - 20, cy - 6);
        }
      } else if (typeof r.x === "number" && typeof r.w === "number") {
        // 矩形
        const x = r.x * w, y = r.y * h, rw = r.w * w, rh = r.h * h;
        this.ctx.strokeRect(x, y, rw, rh);
        if (r.label) {
          this.ctx.fillText(r.label, x + 4, y + 4);
        }
      } else if (typeof r.cx === "number") {
        // 円
        const cx = r.cx * w, cy = r.cy * h, rad = (r.r || 0.05) * Math.min(w, h);
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        this.ctx.stroke();
        if (r.label) {
          this.ctx.fillText(r.label, cx + rad + 4, cy - 6);
        }
      }
    }
    this.ctx.restore();
  }

  setGuide(template) {
    this._guide = template || null;
    this._redraw();
  }

  _drawStroke(s) {
    if (s.points.length < 1) return;
    if (s.points.length === 1) {
      // 1点ストローク（「・」等）: 小さな塗り円で描画
      const [x, y] = s.points[0];
      this.ctx.beginPath();
      this.ctx.arc(x, y, this.lineWidth, 0, Math.PI * 2);
      this.ctx.fillStyle = this.strokeColor;
      this.ctx.fill();
      return;
    }
    this.ctx.beginPath();
    this.ctx.moveTo(s.points[0][0], s.points[0][1]);
    for (let i = 1; i < s.points.length; i++) {
      this.ctx.lineTo(s.points[i][0], s.points[i][1]);
    }
    this.ctx.stroke();
  }

  // ===== Public API =====
  clear() {
    this.strokes = [];
    this._anchors = [];
    this._redraw();
    if (this._onAnchorChange) this._onAnchorChange(this._anchors);
  }

  undo() {
    this.strokes.pop();
    this._redraw();
  }

  // アンカー追加モードを開始（次のクリックでアンカーが置かれる）
  setAnchorMode(type) {
    this._anchorMode = type;
    // canvas のカーソルを変える視覚フィードバック
    this.canvas.style.cursor = type ? "crosshair" : "";
  }
  getAnchorMode() { return this._anchorMode; }
  getAnchors() { return this._anchors.slice(); }
  clearAnchors() {
    this._anchors = [];
    this._redraw();
    if (this._onAnchorChange) this._onAnchorChange(this._anchors);
  }
  removeAnchor(type) {
    this._anchors = this._anchors.filter((a) => a.type !== type);
    this._redraw();
    if (this._onAnchorChange) this._onAnchorChange(this._anchors);
  }

  async preview(ms = 200) {
    if (this.strokes.length === 0) return;
    this._clearCanvas();
    this._setStrokeStyle();
    for (const s of this.strokes) {
      this._drawStroke(s);
      await new Promise((r) => setTimeout(r, ms));
    }
  }

  getStrokes() {
    return this.strokes;
  }

  // 正規化エクスポート。2つのモード:
  // (1) bbox 空間 (デフォルト): ストロークを stroke bbox にフィットさせ [0,1]^2 に
  //     正規化。コンパクトで多くの文字に適切。
  // (2) canvas 空間: ガイドテンプレがあるとき。ストロークを canvas 全体に対する
  //     比 [0,1]^2 (= 書いた位置・サイズを保持) で保存。アンカーもガイドの
  //     canvas 座標をそのまま保存。配置時に「数式記号セル」の絶対サイズで
  //     スケールされ、書いた縦横比・大きさが反映される。
  exportNormalized() {
    if (this.strokes.length === 0) return null;
    const useCanvasSpace = !!(this._guide && this._guide.regions);
    const { w: cssW, h: cssH } = this._cssSize();

    // em 空間 (基準線グリッドで描いたテキスト字): cap線=y0, baseline=y1。
    // 描いた占有比率・位置をそのまま保存 → 大文字小文字/記号の大小が自動で出る。
    if (this._baselineGrid && !useCanvasSpace) {
      const capPx = BASELINE_GRID.cap * cssH;
      const emPx = (BASELINE_GRID.base - BASELINE_GRID.cap) * cssH; // 1em のCSSピクセル数
      const toEm = ([x, y]) => [x / emPx, (y - capPx) / emPx];      // x,y 同一スケール=アスペクト保持
      const norm = this.strokes.map((s) => ({
        points: s.points.map(toEm),
        pressures: s.pressures.slice(),
      }));
      let exMin = Infinity, exMax = -Infinity;
      for (const s of norm) for (const p of s.points) { if (p[0] < exMin) exMin = p[0]; if (p[0] > exMax) exMax = p[0]; }
      const advance = isFinite(exMin) ? (exMax - exMin) : 0.5;
      return { strokes: norm, bbox: [0, 0, 1, 1], advance, coord_space: "em" };
    }

    if (useCanvasSpace) {
      // canvas 空間: CSS座標 / canvasサイズ → [0,1]
      const toN = ([x, y]) => [x / cssW, y / cssH];
      const norm = this.strokes.map((s) => ({
        points: s.points.map((p) => toN(p)),
        pressures: s.pressures.slice(),
      }));
      // 手動アンカー (CSS座標) → canvas 空間
      let anchorsNorm = this._anchors.map((a) => {
        const [nx, ny] = toN([a.x, a.y]);
        return { type: a.type, x: nx, y: ny };
      });
      // 手動なし → ガイドから自動生成 (ガイドは既に canvas [0,1] 座標)
      if (anchorsNorm.length === 0) {
        const autoAnchors = [];
        for (const r of this._guide.regions) {
          if (r.kind === "body") continue;
          let centerX, centerY;
          if (Array.isArray(r.points)) {
            centerX = r.points.reduce((a, p) => a + p[0], 0) / r.points.length;
            centerY = r.points.reduce((a, p) => a + p[1], 0) / r.points.length;
          } else if (typeof r.cx === "number") {
            centerX = r.cx; centerY = r.cy;
          } else if (typeof r.x === "number") {
            centerX = r.x + r.w / 2; centerY = r.y + r.h / 2;
          } else continue;
          const type = (r.kind === "arg") ? "body" : r.kind;
          autoAnchors.push({ type, x: centerX, y: centerY });
        }
        anchorsNorm = autoAnchors;
      }
      // canvas 空間時のbbox = canvas全体
      const out = {
        strokes: norm,
        bbox: [0, 0, 1, 1],
        advance: 1.0,
        coord_space: "canvas",
      };
      if (anchorsNorm.length) out.anchors = anchorsNorm;
      return out;
    }

    // bbox 空間 (デフォルト)
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
    for (const s of this.strokes) {
      for (const [x, y] of s.points) {
        if (x < xMin) xMin = x;
        if (y < yMin) yMin = y;
        if (x > xMax) xMax = x;
        if (y > yMax) yMax = y;
      }
    }
    if (!isFinite(xMin)) return null;
    const w = Math.max(xMax - xMin, 1e-6);
    const h = Math.max(yMax - yMin, 1e-6);
    const side = Math.max(w, h);
    const padX = (side - w) / 2;
    const padY = (side - h) / 2;
    const toN = ([x, y]) => [(x - xMin + padX) / side, (y - yMin + padY) / side];

    const norm = this.strokes.map((s) => ({
      points: s.points.map((p) => toN(p)),
      pressures: s.pressures.slice(),
    }));
    let anchorsNorm = this._anchors.map((a) => {
      const [nx, ny] = toN([a.x, a.y]);
      return { type: a.type, x: nx, y: ny };
    });
    const out = { strokes: norm, bbox: [0, 0, 1, 1], advance: 1.0 };
    if (anchorsNorm.length) out.anchors = anchorsNorm;
    return out;
  }
}

// グローバル公開（モジュール化していない都合上）
window.StrokePad = StrokePad;

// URLパスセグメントとして安全に文字をエンコードする
// 生の文字や %エスケープだとパス正規化や Cloudflare の挙動でトラブるので、
// 「Unicodeコードポイントの16進」を ID として使う。'.' → '2e', 'あ' → '3042', '・' → '30fb'。
// 複数文字 (関数名 "sin" 等の単語グリフ) は各コードポイントを '-' で連結: "sin" → "73-69-6e"。
// サロゲートペアにも対応するため Array.from + codePointAt を使う。
window.pathEncodeChar = function (ch) {
  return Array.from(ch)
    .map((c) => c.codePointAt(0).toString(16))
    .join("-");
};
