// テキストプレビュー＋エディタ: MD → スライド → ブロック移動/リサイズ(overrides) → pptx。
import { createRenderer } from "/js/render/index.js";
import { buildPptx } from "/js/render/pptxbuild.js";
import { buildPptxText } from "/js/render/pptxtext.js";
import { slideToSvgEditable, slideToSvgText, slideItemsToSvg, overrideTransform } from "/js/render/svg.js";
import { applySlideOverrides } from "/js/render/overrides.js";
import { qrToSvg } from "/js/qr.js";

const PX = 40; // px / cm (プレビュー解像度)

const mdEl = document.getElementById("md");
const slidesEl = document.getElementById("slides");
const statusEl = document.getElementById("status");
const missingBar = document.getElementById("missingBar");
const qrOverlay = document.getElementById("qrOverlay");
let lastMissing = [];      // 未登録文字 (描画で□になったもの)
let lastMissingWords = []; // 未登録の関数名(単語: sin/cos 等。文字は出るが単語登録推奨)

let renderer = null, characters = {}, theme = {}, skeleton = null;
let lastResult = null;
let overrides = {};               // { slideIdx: { blockIdx: {dx,dy,s, els:{elIdx:{dx,dy,s}}} } }
let selected = null;              // { slide, block, el(任意) } = 複数選択のプライマリ
let selList = [];                 // 複数選択の集合 [{slide,block,el}]。selected はその最後(プライマリ)。
let charMode = null;              // 文字編集中のブロック { slide, block }
let currentSlide = 0;             // ステージに表示中のスライド index
const statusTextEl = document.getElementById("statusText");
const $ = (id) => document.getElementById(id);
const setText = (id, t) => { const e = $(id); if (e) e.textContent = t; };
// Undo/Redo (インデックス方式の履歴: history[histIdx] が現在状態)
let history = [], histIdx = -1, dragSnapshot = null;
const snapshot = () => JSON.parse(JSON.stringify(overrides));
function recordHistory() {                 // 確定した編集を1手として記録
  history = history.slice(0, histIdx + 1);
  history.push(snapshot());
  if (history.length > 100) history.shift();
  histIdx = history.length - 1;
  if (typeof updateUndoRedoBtns === "function") updateUndoRedoBtns();
}
function baselineHistory() { history = [snapshot()]; histIdx = 0; if (typeof updateUndoRedoBtns === "function") updateUndoRedoBtns(); }
// 読み取り専用の override スナップショット (ドラッグ開始時の ov0 用。クリックだけで履歴を汚さない)。
function readBlockOv(slide, block) { return { dx: 0, dy: 0, s: 1, ...((overrides[slide] || {})[block] || {}) }; }
function readElOv(slide, block, el) { const bo = (overrides[slide] || {})[block] || {}; return { dx: 0, dy: 0, s: 1, ...((bo.els || {})[el] || {}) }; }
function persist() { mdEl.value = writeOverridesToMd(mdEl.value, overrides); } // MD frontmatterへ書き戻し
function undo() {
  if (histIdx <= 0) { setStatus("warn", "これ以上戻せません"); return; }
  histIdx -= 1;
  overrides = JSON.parse(JSON.stringify(history[histIdx]));
  selList = []; selected = null; charMode = null; persist(); update();
}
function redo() {
  if (histIdx >= history.length - 1) { setStatus("warn", "やり直しはありません"); return; }
  histIdx += 1;
  overrides = JSON.parse(JSON.stringify(history[histIdx]));
  selList = []; selected = null; charMode = null; persist(); update();
}

function setStatus(cls, msg) {
  if (statusTextEl) statusTextEl.textContent = msg;
  if (statusEl) statusEl.className = "status-pill" + (cls === "err" ? " err" : cls === "warn" ? " warn" : "");
}

// ---- 未登録文字の登録導線 (バー + 全画面QR) ----
function escapeHtml(s) { return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

function bulkUrl(missingChars, missingWords) {
  const u = new URL("/bulk", location.origin);
  if (missingChars.length) u.searchParams.set("custom", missingChars.join(""));
  if (missingWords && missingWords.length) u.searchParams.set("words", missingWords.join(","));
  u.searchParams.set("target", "1");
  return u.toString();
}

function updateMissingUI(autoOpen) {
  const hasChars = lastMissing.length > 0;
  const hasWords = lastMissingWords.length > 0;
  if (hasChars || hasWords) {
    missingBar.style.display = "flex";
    const parts = [];
    if (hasChars) parts.push(`未登録 ${lastMissing.length} 文字: <span class="mchars">${escapeHtml(lastMissing.join(""))}</span>`);
    if (hasWords) parts.push(`関数 <span class="mchars">${escapeHtml(lastMissingWords.join(" "))}</span> も単語登録できます`);
    missingBar.innerHTML = `${parts.join(" ／ ")}<span class="sp"></span><button id="openQr">QRで登録</button>`;
    missingBar.querySelector("#openQr").addEventListener("click", openQrOverlay);
    // 自動全画面QRは「□で壊れる文字」がある時だけ。関数は任意なので強制しない。
    if (autoOpen && hasChars) openQrOverlay();
  } else {
    missingBar.style.display = "none";
    closeQrOverlay();
  }
}

function openQrOverlay() {
  if (!lastMissing.length && !lastMissingWords.length) return;
  const url = bulkUrl(lastMissing, lastMissingWords);
  const segs = [];
  if (lastMissing.length) segs.push(`未登録 ${lastMissing.length} 文字`);
  if (lastMissingWords.length) segs.push(`関数 ${lastMissingWords.length} 個`);
  document.getElementById("qrCount").textContent = segs.join(" ・ ");
  document.getElementById("qrMissingList").textContent = [lastMissing.join(""), lastMissingWords.join(" ")].filter(Boolean).join("  ");
  document.getElementById("qrUrl").textContent = url;
  const codeEl = document.getElementById("qrCode");
  try { codeEl.innerHTML = qrToSvg(url, { ecl: "M" }); }
  catch (e) { codeEl.innerHTML = `<div style="font-size:.78rem;color:#900;padding:1.5rem 0.5rem">QRを生成できませんでした（文字数が多すぎます）。下のURLをiPadで開いてください。</div>`; }
  qrOverlay.style.display = "flex";
}
function closeQrOverlay() { qrOverlay.style.display = "none"; }

async function recheckDict() {
  setStatus("warn", "辞書を再取得して再チェック中…");
  try {
    const ex = await fetch("/api/export", { cache: "no-store" }).then((r) => r.json());
    characters = ex.characters || {};
    theme = ex.theme || {};
  } catch (e) { setStatus("err", "辞書再取得に失敗: " + (e && e.message ? e.message : e)); return; }
  update();
  if (!lastMissing.length && !lastMissingWords.length) setStatus("ok", "全文字が登録されました。pptx を出力できます。");
  else if (lastMissing.length) { setStatus("warn", `まだ ${lastMissing.length} 文字が未登録です: ${lastMissing.join("")}`); openQrOverlay(); }
  else setStatus("ok", `文字は全て登録済み。関数 ${lastMissingWords.join(" ")} は任意で単語登録できます。`);
}

function ovFor(slide, block) {
  if (!overrides[slide]) overrides[slide] = {};
  if (!overrides[slide][block]) overrides[slide][block] = { dx: 0, dy: 0, s: 1 };
  return overrides[slide][block];
}
function elOvFor(slide, block, el) {
  const b = ovFor(slide, block);
  if (!b.els) b.els = {};
  if (!b.els[el]) b.els[el] = { dx: 0, dy: 0, s: 1 };
  return b.els[el];
}

function update(opts) {
  opts = opts || {};
  if (!renderer) return;
  let result;
  try { result = renderer.render(mdEl.value, characters, theme); }
  catch (e) { setStatus("err", "描画エラー: " + (e && e.message ? e.message : e)); console.error(e); return; }
  lastResult = result;
  lastMissing = result.missingChars || [];
  lastMissingWords = result.missingWords || [];
  updateMissingUI(opts.autoOpen);
  // overrides の真実は MD frontmatter。毎回そこから同期する。
  overrides = result.doc.meta.overrides || {};
  const { doc, slides, color, brushWidthCm, slideWCm, slideHCm, mode, fontFamily, anim } = result;
  const n = slides.length;
  if (currentSlide >= n) currentSlide = Math.max(0, n - 1);
  if (doc.errors.length) setStatus("err", "エラー: " + doc.errors.join(" / "));
  else if (!n) setStatus("warn", "# 見出しでスライドを開始");
  else setStatus("ok", `${n} スライド`);

  // ステータスバー / バッジ / 行数
  const lines = (mdEl.value.match(/\n/g) || []).length + 1;
  setText("badgeNum", n ? String(currentSlide + 1).padStart(2, "0") : "–");
  setText("badgeTotal", n ? String(n).padStart(2, "0") : "–");
  setText("sbSlides", `${n} スライド`);
  setText("sbLines", `Markdown ${lines} 行`);
  setText("mdLines", `${lines} 行`);

  const stEl = $("stage");
  if (stEl) stEl.classList.toggle("has-selection", !!selected);

  // サムネイル (全スライド) — role="tab" + aria-selected + tabindex で role="tablist" を補完
  const thumbsEl = $("thumbs");
  if (thumbsEl) {
    thumbsEl.innerHTML = slides.map((s, i) => {
      const act = i === currentSlide;
      return `<div class="thumb${act ? " is-active" : ""}" data-idx="${i}" role="tab" aria-selected="${act}" tabindex="${act ? 0 : -1}" aria-label="スライド ${i + 1}"><span class="thumb-num">${i + 1}</span>` +
        slideItemsToSvg(s.blocks, slideWCm, slideHCm, { pxPerCm: PX, defaultColor: color, fontFamily: result.fontStack, thumb: true, grid: false }) +
        `</div>`;
    }).join("");
    thumbsEl.querySelectorAll(".thumb").forEach((t) => {
      t.addEventListener("click", () => setCurrentSlide(parseInt(t.dataset.idx, 10)));
      t.addEventListener("keydown", (e) => {
        const idx = parseInt(t.dataset.idx, 10);
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCurrentSlide(idx); }
        else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setCurrentSlide(Math.min(slides.length - 1, idx + 1)); thumbsEl.querySelector(".thumb.is-active")?.focus(); }
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setCurrentSlide(Math.max(0, idx - 1)); thumbsEl.querySelector(".thumb.is-active")?.focus(); }
        else if (e.key === "Home") { e.preventDefault(); setCurrentSlide(0); thumbsEl.querySelector(".thumb.is-active")?.focus(); }
        else if (e.key === "End") { e.preventDefault(); setCurrentSlide(slides.length - 1); thumbsEl.querySelector(".thumb.is-active")?.focus(); }
      });
    });
  }

  // アクティブスライド (16:9 カード)
  const s = slides[currentSlide];
  if (s) {
    slidesEl.innerHTML = `<div class="slide slide-card is-active${s.overflow ? " overflow" : ""}" data-index="${currentSlide}">` +
      slideItemsToSvg(s.blocks, slideWCm, slideHCm, { pxPerCm: PX, defaultColor: color, fontFamily: result.fontStack }, overrides[currentSlide]) +
      `</div>`;
    const svg = slidesEl.querySelector("svg");
    if (svg) svg.addEventListener("pointerdown", (e) => onSvgPointerDown(e, currentSlide, svg));
    if (charMode && charMode.slide === currentSlide) {
      const g = slidesEl.querySelector(`.blk[data-block="${charMode.block}"]`);
      if (g) g.classList.add("charmode");
    }
  } else {
    slidesEl.innerHTML = "";
  }
  if (selected && selected.slide === currentSlide) drawSelection(); else hideFmtbar();
  updateFmtbar();
  renderMdHighlight();
  if (typeof updateUndoRedoBtns === "function") updateUndoRedoBtns();
  // フィルムストリップ: 選択サムネを中央へ。スライド切替時はsmooth、編集時は瞬時(再描画でscrollLeftがリセットされる対策)。
  scrollActiveThumbIntoCenter(currentSlide !== _lastScrolledSlide);
  _lastScrolledSlide = currentSlide;
}
let _lastScrolledSlide = -1;
function scrollActiveThumbIntoCenter(smooth) {
  const t = $("thumbs"); if (!t) return;
  const active = t.querySelector(".thumb.is-active"); if (!active) return;
  const tr = t.getBoundingClientRect();
  const ar = active.getBoundingClientRect();
  const delta = (ar.left + ar.width / 2) - (tr.left + tr.width / 2);
  if (Math.abs(delta) < 1) return;
  t.scrollTo({ left: t.scrollLeft + delta, behavior: smooth ? "smooth" : "auto" });
}

// フィルムストリップ/ナビからスライド切替。選択は解除。
function setCurrentSlide(i) {
  const n = lastResult ? lastResult.slides.length : 0;
  i = Math.max(0, Math.min(n - 1, i));
  if (i === currentSlide && lastResult) return;
  currentSlide = i;
  selList = []; selected = null; charMode = null;
  update();
  syncMdToSlide(i);
}
function syncMdToSlide(i) {
  if (document.activeElement === mdEl) return;
  const sl = lastResult && lastResult.doc.slides[i];
  const line = (sl && sl.headingSrc && sl.headingSrc[0]) || 0;
  const total = (mdEl.value.match(/\n/g) || []).length + 1;
  mdEl.scrollTop = Math.max(0, (total > 1 ? line / total : 0) * (mdEl.scrollHeight - mdEl.clientHeight));
  const hl = $("mdHighlight"); if (hl) hl.scrollTop = mdEl.scrollTop;
}
// MD エディタ背面に、表示中スライドの該当行を薄い青でハイライト (textarea のミラー)。
function renderMdHighlight() {
  const hl = $("mdHighlight"); if (!hl) return;
  const lines = mdEl.value.split("\n");
  let start = -1, end = -1;
  if (lastResult && lastResult.doc.slides.length) {
    const sl = lastResult.doc.slides[currentSlide];
    start = (sl && sl.headingSrc && sl.headingSrc[0] != null) ? sl.headingSrc[0] : -1;
    const nx = lastResult.doc.slides[currentSlide + 1];
    end = (nx && nx.headingSrc && nx.headingSrc[0] != null) ? nx.headingSrc[0] : lines.length;
  }
  let html = "";
  for (let i = 0; i < lines.length; i++) {
    const safe = escapeHtml(lines[i]);
    html += (i >= start && i < end && safe) ? `<mark>${safe}</mark>` : safe;
    if (i < lines.length - 1) html += "\n";
  }
  hl.innerHTML = html;
  hl.scrollTop = mdEl.scrollTop;
}

// 登場アニメの向き (ブロック単位 override.anim)。同じ向きを再クリックで既定に戻す。
function setAnimDir(dir) {
  const blks = selList.filter((s) => s.el == null); // アニメはブロック単位
  if (!blks.length) return;
  for (const it of blks) { const ov = ovFor(it.slide, it.block); if (ov.anim === dir) delete ov.anim; else ov.anim = dir; }
  persist(); update(); recordHistory();
}
// 矢印アイコン↔保存する dir のマッピング: 矢印は「進む方向」を示す (例 ←=左に進む=右から登場=wipe(right))。
const ANIM_MAP = [["right", "animLeft"], ["down", "animUp"], ["up", "animDown"], ["left", "animRight"], ["none", "animNone"]];
function updateAnimBtns(enabled, curDir) {
  // global anim ON で個別指定なしなら、既定方向 "left" (=右に進む / 左から登場 / animRight ボタン) を強調。
  const globalOn = lastResult && lastResult.anim !== false;
  const eff = curDir != null ? curDir : (enabled && globalOn ? "left" : null);
  for (const [dir, id] of ANIM_MAP) {
    const b = document.getElementById(id);
    if (!b) continue;
    b.disabled = !enabled; b.style.opacity = enabled ? "1" : "0.4";
    const on = enabled && eff === dir;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

// フォント選択の表示を現在の対象に同期: 選択中はその override.font、未選択は文書 font:。
function syncFontSel() {
  const fontSel = document.getElementById("fontSel");
  if (!fontSel || !lastResult) return;
  let fv = (lastResult.mode === "text" && lastResult.doc.meta.font) || "";
  if (lastResult.mode === "text" && selected) {
    const bo = overrides[selected.slide] && overrides[selected.slide][selected.block];
    const t = selected.el != null ? (bo && bo.els && bo.els[selected.el]) : bo;
    if (t && t.font) fv = t.font;
  }
  fontSel.value = fv;
  // M3 ドロップダウンの表示ラベルも同期。
  const label = document.getElementById("fmtFontLabel");
  if (label) {
    const opt = fontSel.querySelector(`option[value="${(fv || "").replace(/"/g, '\\"')}"]`);
    label.textContent = (opt && opt.textContent) || "既定";
  }
}

function enterCharMode(slide, block, g) {
  slidesEl.querySelectorAll(".blk.charmode").forEach((b) => b.classList.remove("charmode"));
  g.classList.add("charmode");
  charMode = { slide, block };
  selSetOne({ slide, block, el: null });
  clearSelection();
  // fmtbar の状態 (anim 無効化など) を charMode 反映させるため再評価。
  updateFmtbar();
  setStatus("ok", "文字編集モード: 文字(緑枠)をドラッグで個別移動。別の場所をクリックで解除");
}

function svgCm(svg, clientX, clientY, slideWCm, slideHCm) {
  const r = svg.getBoundingClientRect();
  const sc = r.width / (slideWCm * PX);
  return [(clientX - r.left) / sc / PX, (clientY - r.top) / sc / PX];
}

let drag = null; // {kind:'block'|'el', mode:'move'|'resize', slide, block, el?, startCm, ov0, svg}
let dragMoved = false; // クリックと意図的なドラッグを区別 (閾値超えるまで動かさない)
let lastTap = null; // ダブルタップ判定用 {slide, block, time} (dblclickはpreventDefaultで不発のため自前判定)
const SNAP_CM = 0.5; // スナップ配置: Shift 押下中だけ 0.5cm グリッドに吸着 (既定はフリー)。
function snapTo(value) { return Math.round(value / SNAP_CM) * SNAP_CM; }

function onSvgPointerDown(e, slide, svg) {
  const { slideWCm, slideHCm } = lastResult;
  const [cx, cy] = svgCm(svg, e.clientX, e.clientY, slideWCm, slideHCm);
  dragSnapshot = snapshot(); // ドラッグ前状態を記録 (pointerupで変化あれば履歴へ)
  dragMoved = false;         // 閾値を超えるまで移動/リサイズしない (クリック=選択のみ)
  const handle = e.target.closest(".handle-rect");
  if (handle && selected && selected.el == null) {
    // ブロックのリサイズ
    drag = { kind: "block", mode: "resize", slide: selected.slide, block: selected.block, startCm: [cx, cy], ov0: readBlockOv(selected.slide, selected.block), svg };
    svg.setPointerCapture(e.pointerId); e.preventDefault(); return;
  }
  // 文字編集モード中、編集中ブロック内の要素クリック (ehit/グリフどちらでも) → 要素選択/ドラッグ。
  // 別ブロックの要素/文字をクリックした場合はここを通さず、下のブロック処理へ (ダブルクリックで切替)。
  const elHit = e.target.closest(".el");
  const elHitBlk = elHit ? elHit.closest(".blk") : null;
  const elHitBlock = elHitBlk ? parseInt(elHitBlk.dataset.block, 10) : null;
  if (charMode && charMode.slide === slide && elHit && elHitBlock === charMode.block) {
    lastTap = null;
    const el = parseInt(elHit.dataset.el, 10);
    const item = { slide, block: charMode.block, el };
    if (e.metaKey || e.ctrlKey) { selToggleItem(item); drawSelection(); updateFmtbar(); e.preventDefault(); return; }
    if (e.shiftKey) { selRangeTo(item); drawSelection(); updateFmtbar(); e.preventDefault(); return; }
    selSetOne(item);
    drawSelection();
    drag = { kind: "el", mode: "move", slide, block: charMode.block, el, startCm: [cx, cy], ov0: readElOv(slide, charMode.block, el), svg };
    svg.setPointerCapture(e.pointerId); e.preventDefault(); return;
  }
  // ブロック選択 (bhit)
  const g = e.target.closest(".blk");
  if (g) {
    const block = parseInt(g.dataset.block, 10);
    const item = { slide, block, el: null };
    const clearCharmode = () => { slidesEl.querySelectorAll(".blk.charmode").forEach((b) => b.classList.remove("charmode")); charMode = null; };
    // 修飾キーでブロックを複数選択 (ダブルタップ/ドラッグより優先)
    if (e.metaKey || e.ctrlKey) { lastTap = null; selToggleItem(item); clearCharmode(); drawSelection(); updateFmtbar(); e.preventDefault(); return; }
    if (e.shiftKey) { lastTap = null; selRangeTo(item); clearCharmode(); drawSelection(); updateFmtbar(); e.preventDefault(); return; }
    // 自前ダブルタップ判定 → 文字編集モードへ (dblclickイベントはpreventDefaultで発火しない)
    const now = Date.now();
    if (lastTap && lastTap.slide === slide && lastTap.block === block && now - lastTap.time < 350) {
      lastTap = null;
      enterCharMode(slide, block, g);
      const dblEl = e.target.closest(".el"); // ダブルクリックした文字があればそれを選択状態に
      if (dblEl && dblEl.dataset.el != null) selSetOne({ slide, block, el: parseInt(dblEl.dataset.el, 10) });
      drawSelection();
      e.preventDefault(); return; // ブロックドラッグは開始しない
    }
    lastTap = { slide, block, time: now };
    if (!charMode || charMode.slide !== slide || charMode.block !== block) clearCharmode();
    selSetOne(item);
    drawSelection();
    drag = { kind: "block", mode: "move", slide, block, startCm: [cx, cy], ov0: readBlockOv(slide, block), svg };
    svg.setPointerCapture(e.pointerId); e.preventDefault();
  } else {
    lastTap = null;
    clearSel(); clearSelection(); hideFmtbar();
    slidesEl.querySelectorAll(".blk.charmode").forEach((b) => b.classList.remove("charmode"));
    charMode = null;
    updateFmtbar();
  }
}

function onPointerMove(e) {
  if (!drag) return;
  const { slideWCm, slideHCm } = lastResult;
  const [cx, cy] = svgCm(drag.svg, e.clientX, e.clientY, slideWCm, slideHCm);
  if (!dragMoved) {
    // 4px 相当 (cm) 動くまでは何もしない → 単クリックは選択だけ
    if (Math.hypot(cx - drag.startCm[0], cy - drag.startCm[1]) < 4 / PX) return;
    dragMoved = true;
  }
  const blk = lastResult.slides[drag.slide].blocks[drag.block];
  const doSnap = e.shiftKey; // Shift 押下中だけ 0.5cm グリッドにスナップ
  if (drag.kind === "block") {
    const ov = ovFor(drag.slide, drag.block);
    if (drag.mode === "move") {
      ov.dx = drag.ov0.dx + (cx - drag.startCm[0]);
      ov.dy = drag.ov0.dy + (cy - drag.startCm[1]);
      if (doSnap) { ov.dx = snapTo(blk.x_cm + ov.dx) - blk.x_cm; ov.dy = snapTo(blk.y_cm + ov.dy) - blk.y_cm; }
    } else {
      const w = blk.w_cm || 1;
      let s = (cx - blk.x_cm - ov.dx) / w;
      if (!isFinite(s)) s = 1;
      ov.s = Math.max(0.3, Math.min(5, s));
    }
    const g = drag.svg.querySelector(`.blk[data-block="${drag.block}"]`);
    if (g) { const tr = overrideTransform(ov, blk.x_cm, blk.y_cm, PX); if (tr) g.setAttribute("transform", tr); else g.removeAttribute("transform"); }
  } else {
    // 要素移動 (ブロックscaleの分だけ補正)
    const bov = ovFor(drag.slide, drag.block);
    const bs = bov.s || 1;
    const el = blk.elements[drag.el];
    const eo = elOvFor(drag.slide, drag.block, drag.el);
    eo.dx = drag.ov0.dx + (cx - drag.startCm[0]) / bs;
    eo.dy = drag.ov0.dy + (cy - drag.startCm[1]) / bs;
    if (doSnap) { eo.dx = snapTo(el.x_cm + eo.dx) - el.x_cm; eo.dy = snapTo(el.y_cm + eo.dy) - el.y_cm; }
    const g = drag.svg.querySelector(`.blk[data-block="${drag.block}"] .el[data-el="${drag.el}"]`);
    if (g) { const tr = overrideTransform(eo, el.x_cm, el.y_cm, PX); if (tr) g.setAttribute("transform", tr); else g.removeAttribute("transform"); }
  }
  drawSelection();
}

function onPointerUp(e) {
  if (drag) {
    try { drag.svg.releasePointerCapture(e.pointerId); } catch (_) {}
    drag = null;
    if (dragSnapshot) {
      const changed = JSON.stringify(dragSnapshot) !== JSON.stringify(overrides);
      dragSnapshot = null;
      if (changed) { persist(); recordHistory(); } // ドラッグ確定 → MD自動保存＋1手記録
    }
  }
}
document.addEventListener("pointermove", onPointerMove);
document.addEventListener("pointerup", onPointerUp);

// Undo/Redo (キャンバス編集中のみ。テキスト編集中はブラウザ標準に任せる)
document.addEventListener("keydown", (e) => {
  if (document.activeElement === mdEl) return;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
});

function clearSelection() {
  slidesEl.querySelectorAll(".sel-rect,.handle-rect").forEach((el) => el.remove());
}
// ---- 複数選択 (文字・ブロック共通) ----
// selList の各要素 {slide,block,el}: el=null=ブロック / 数値=要素(charMode内)。
// 同種(全ブロック or 同一ブロック内の要素)のみ混在可。selected は集合のプライマリ。
function sameSel(a, b) { return !!a && !!b && a.slide === b.slide && a.block === b.block && a.el === b.el; }
function selCompatible(a, b) {
  if (a.el == null && b.el == null) return a.slide === b.slide;                        // 両方ブロック
  if (a.el != null && b.el != null) return a.slide === b.slide && a.block === b.block; // 同一ブロック内の要素
  return false;
}
function selSetOne(item) { selList = [item]; selected = item; }            // 単一選択
function selToggleItem(item) {                                            // Cmd/Ctrl: トグル追加 (最低1個は残す)
  const i = selList.findIndex((s) => sameSel(s, item));
  if (i >= 0) { if (selList.length > 1) { selList.splice(i, 1); selected = selList[selList.length - 1]; } }
  else { if (selList.length && !selCompatible(selList[0], item)) selList = []; selList.push(item); selected = item; }
}
function selRangeTo(item) {                                               // Shift: 集合の起点〜item を範囲選択
  const anchor = selList.length ? selList[0] : item;
  if (!selCompatible(anchor, item)) { selSetOne(item); return; }
  const useEl = item.el != null;
  const a = useEl ? anchor.el : anchor.block, b = useEl ? item.el : item.block;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  selList = [];
  for (let k = lo; k <= hi; k++) selList.push(useEl ? { slide: item.slide, block: item.block, el: k } : { slide: item.slide, block: k, el: null });
  selected = item;
}
function clearSel() { selList = []; selected = null; }
// フローティング文脈ツールバー: 選択時だけ表示し、選択近傍に配置。
function hideFmtbar() {
  const bar = $("fmtbar"); if (bar) { bar.classList.remove("is-visible"); bar.setAttribute("aria-hidden", "true"); }
  const pop = $("fmtColorPop"); if (pop) pop.classList.remove("is-open");
  const stage = $("stage"); if (stage) { stage.classList.remove("editing"); stage.classList.remove("has-selection"); }
}
function anchorFromRect(rectEl, s) {
  // 選択枠は文字スケール override(s) で伸縮するので、s で割った "s=1 相当" の矩形を返し、
  // サイズ変更で書式バーが横ずれしないようにする（左上は s 非依存なので left/top はそのまま）。
  if (!s || Math.abs(s - 1) < 1e-6) return rectEl;
  const b = rectEl.getBoundingClientRect();
  const w0 = b.width / s, h0 = b.height / s;
  return { getBoundingClientRect: () => ({ left: b.left, top: b.top, width: w0, height: h0, right: b.left + w0, bottom: b.top + h0 }) };
}
function positionFmtbar(anchorEl) {
  const bar = $("fmtbar"); if (!bar || !anchorEl) return;
  const r = anchorEl.getBoundingClientRect();
  const bw = bar.offsetWidth, bh = bar.offsetHeight, gap = 12;
  let left = Math.max(12, Math.min(window.innerWidth - bw - 12, r.left + r.width / 2 - bw / 2));
  let top = r.top - bh - gap, below = false;
  if (top < 70) { top = r.bottom + gap; below = true; }
  bar.style.left = left + "px"; bar.style.top = top + "px";
  bar.classList.toggle("is-below", below);
}
function showFmtbar(anchorEl) {
  const bar = $("fmtbar"); if (!bar) return;
  const stage = $("stage"); if (stage) { stage.classList.add("editing"); stage.classList.add("has-selection"); }
  const hint = $("editHint");
  if (hint) hint.textContent = (selected && selected.el != null)
    ? "ドラッグで移動・別の場所をクリックで解除"
    : "ドラッグで移動・角でリサイズ・ダブルクリックで文字を編集";
  bar.classList.add("is-visible");
  bar.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => positionFmtbar(anchorEl));
}
function applyOv(p, ox, oy, ov) {
  const dx = ov.dx || 0, dy = ov.dy || 0, s = ov.s || 1;
  return [ox + (p[0] - ox) * s + dx, oy + (p[1] - oy) * s + dy];
}
// it={slide,block,el} → 選択枠の cm 対角2点 + 合算スケール(アンカー横ずれ防止用)
function cornersOf(it) {
  const blk = lastResult.slides[it.slide] && lastResult.slides[it.slide].blocks[it.block];
  if (!blk) return null;
  const bov = (overrides[it.slide] && overrides[it.slide][it.block]) || { dx: 0, dy: 0, s: 1 };
  if (it.el != null && blk.elements && blk.elements[it.el]) {
    const e = blk.elements[it.el];
    const eo = (bov.els && bov.els[it.el]) || { dx: 0, dy: 0, s: 1 };
    let p1 = applyOv([e.x_cm, e.y_cm], e.x_cm, e.y_cm, eo);
    let p2 = applyOv([e.x_cm + e.w_cm, e.y_cm + e.h_cm], e.x_cm, e.y_cm, eo);
    p1 = applyOv(p1, blk.x_cm, blk.y_cm, bov);
    p2 = applyOv(p2, blk.x_cm, blk.y_cm, bov);
    return { corners: [p1, p2], s: (eo.s || 1) * (bov.s || 1) };
  }
  const p1 = applyOv([blk.x_cm, blk.y_cm], blk.x_cm, blk.y_cm, bov);
  const p2 = applyOv([blk.x_cm + blk.w_cm, blk.y_cm + blk.h_cm], blk.x_cm, blk.y_cm, bov);
  return { corners: [p1, p2], s: bov.s || 1 };
}
function drawSelection() {
  clearSelection();
  if (!selList.length || !lastResult || !selected || selected.slide !== currentSlide) { hideFmtbar(); return; }
  const slideDiv = slidesEl.querySelector(".slide");
  if (!slideDiv) { hideFmtbar(); return; }
  const svg = slideDiv.querySelector("svg");
  const NS = "http://www.w3.org/2000/svg";
  let primaryRect = null, primaryS = 1;
  let aL = Infinity, aT = Infinity, aR = -Infinity, aB = -Infinity; // s=1 正規化したアンカー bbox(複数選択用)
  for (const it of selList) {
    if (it.slide !== currentSlide) continue;
    const c = cornersOf(it);
    if (!c) continue;
    const x = Math.min(c.corners[0][0], c.corners[1][0]) * PX, y = Math.min(c.corners[0][1], c.corners[1][1]) * PX;
    const w = Math.abs(c.corners[1][0] - c.corners[0][0]) * PX, h = Math.abs(c.corners[1][1] - c.corners[0][1]) * PX;
    const isPrimary = sameSel(it, selected);
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("class", "sel-rect" + (it.el != null ? " is-el" : "") + (isPrimary ? " is-primary" : ""));
    rect.setAttribute("x", x); rect.setAttribute("y", y); rect.setAttribute("width", Math.max(w, 4)); rect.setAttribute("height", Math.max(h, 4));
    rect.style.pointerEvents = "none";
    svg.appendChild(rect);
    const rb = rect.getBoundingClientRect(); const ns = c.s || 1; // 各枠を s で割って s=1 相当に正規化(左上は s 非依存)
    aL = Math.min(aL, rb.left); aT = Math.min(aT, rb.top); aR = Math.max(aR, rb.left + rb.width / ns); aB = Math.max(aB, rb.top + rb.height / ns);
    if (isPrimary) { primaryRect = rect; primaryS = c.s; }
    if (isPrimary && it.el == null) { // プライマリのブロックのみリサイズハンドル
      const hs = 12;
      const handle = document.createElementNS(NS, "rect");
      handle.setAttribute("class", "handle-rect");
      handle.setAttribute("x", x + w - hs / 2); handle.setAttribute("y", y + h - hs / 2); handle.setAttribute("width", hs); handle.setAttribute("height", hs);
      handle.style.cursor = "nwse-resize";
      svg.appendChild(handle);
    }
  }
  if (!primaryRect) { hideFmtbar(); return; }
  if (selList.length > 1) { // 複数選択: 全枠を s=1 正規化した bbox をアンカーに(サイズ変更で動かない)
    showFmtbar({ getBoundingClientRect: () => ({ left: aL, top: aT, width: aR - aL, height: aB - aT, right: aR, bottom: aB }) });
  } else {
    showFmtbar(anchorFromRect(primaryRect, primaryS)); // 単一: サイズ変更の横ずれを s 正規化で防ぐ
  }
  updateFmtbar();
}

// ---- 書式ツールバー (選択ブロック → 太字/色/サイズ を MD に書き戻す) ----
// 内容(太字・色)は MD 記法に、サイズは frontmatter の役割別 pt に書き戻す。
// ブロックの src 行範囲 (mdparse 由来) を使い、左テキストエリアの該当行を編集して再描画。
const PT_TO_CM_UI = 2.54 / 72;
const fmtbar = document.getElementById("fmtbar");
const TEXT_TYPES = new Set(["heading", "bullet", "paragraph", "note", "subheading"]);
const SPAN_RE = /^<span class="([^"]*)">([\s\S]*)<\/span>$/;
const ROLE = {
  heading: { key: "heading_pt", label: "見出し", defCm: (m) => (m.heading_size_cm || 1.8) },
  subheading: { key: "subheading_pt", label: "小見出し", defCm: (m) => bodyCm(m) * 1.12 },
  note: { key: "note_pt", label: "メモ", defCm: (m) => bodyCm(m) * 0.62 },
  body: { key: "body_pt", label: "本文", defCm: (m) => bodyCm(m) },
};
function bodyCm(m) { return m.body_pt ? m.body_pt * PT_TO_CM_UI : (m.bullet_size_cm || 1.0); }
function roleOf(type) { return (type === "heading" || type === "subheading" || type === "note") ? type : "body"; }
function currentPt(meta, role) { const r = ROLE[role]; return meta[r.key] ? meta[r.key] : Math.round(r.defCm(meta) / PT_TO_CM_UI); }

// 選択ブロックの {src:[start,end), type} を doc から取得 (block 0 = 見出し)
function blockMeta(slide, blockIdx) {
  const sl = lastResult && lastResult.doc && lastResult.doc.slides[slide];
  if (!sl) return null;
  if (blockIdx === 0) return sl.headingSrc ? { src: sl.headingSrc, type: "heading" } : null;
  const c = sl.content[blockIdx - 1];
  return c && c.src ? { src: c.src, type: c.type } : null;
}
function splitMarker(line) {
  let m;
  if ((m = /^(\s*#{1,3}\s+)([\s\S]*)$/.exec(line))) return { prefix: m[1], content: m[2] };
  if ((m = /^(\s*-\s+)([\s\S]*)$/.exec(line))) return { prefix: m[1], content: m[2] };
  if ((m = /^(\s*>\s?)([\s\S]*)$/.exec(line))) return { prefix: m[1], content: m[2] };
  return { prefix: "", content: line };
}
// 太字(**)とスパン(<span class>)が入れ子・順不同でも正しく分解/再構成する。
// 例: **<span class="key">x</span>** も <span class="key">**x**</span> も {bold:true, cls:"key", inner:"x"} に。
const BOLD_WRAP = /^\*\*((?:(?!\*\*)[\s\S])*)\*\*$/;
function decompose(content) {
  const lead = (content.match(/^\s*/) || [""])[0];
  const trail = (content.match(/\s*$/) || [""])[0];
  let core = content.slice(lead.length, content.length - trail.length);
  let bold = false, cls = null, changed = true;
  while (changed) {
    changed = false;
    let m = BOLD_WRAP.exec(core);
    if (m) { bold = true; core = m[1]; changed = true; continue; }
    m = SPAN_RE.exec(core);
    if (m) { cls = m[1]; core = m[2]; changed = true; continue; }
  }
  return { lead, trail, bold, cls, inner: core };
}
function recompose(d) {
  let s = d.inner;
  if (d.bold) s = "**" + s + "**";                       // 太字は内側
  if (d.cls) s = `<span class="${d.cls}">${s}</span>`;   // スパンは外側 (正準順)
  return d.lead + s + d.trail;
}
function isBold(content) { return decompose(content).bold; }
function curClass(content) { return decompose(content).cls; }
function toggleBold(content) { const d = decompose(content); d.bold = !d.bold; return recompose(d); }
function applyClass(content, cls) { const d = decompose(content); d.cls = (d.cls === cls ? null : cls); return recompose(d); }
function clearClass(content) { const d = decompose(content); d.cls = null; return recompose(d); }
function setFrontmatterKey(md, key, value) {
  const lines = md.split("\n");
  if (lines[0].trim() !== "---") return `---\n${key}: ${value}\n---\n` + md;
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") { end = i; break; }
  if (end < 0) return md;
  for (let i = 1; i < end; i++) { const m = /^\s*([A-Za-z_][\w]*)\s*:/.exec(lines[i]); if (m && m[1] === key) { lines[i] = `${key}: ${value}`; return lines.join("\n"); } }
  lines.splice(end, 0, `${key}: ${value}`);
  return lines.join("\n");
}
function removeFrontmatterKey(md, key) {
  const lines = md.split("\n");
  if (lines[0].trim() !== "---") return md;
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") { end = i; break; }
  if (end < 0) return md;
  for (let i = 1; i < end; i++) { const m = /^\s*([A-Za-z_][\w]*)\s*:/.exec(lines[i]); if (m && m[1] === key) { lines.splice(i, 1); return lines.join("\n"); } }
  return md;
}
function editBlockContent(transform) {
  if (!selected || selected.el != null) return;
  const meta = blockMeta(selected.slide, selected.block);
  if (!meta || !meta.src || meta.src[1] - meta.src[0] !== 1 || !TEXT_TYPES.has(meta.type)) { setStatus("warn", "このブロックは太字/色の対象外です"); return; }
  const lines = mdEl.value.split("\n");
  const { prefix, content } = splitMarker(lines[meta.src[0]]);
  lines[meta.src[0]] = prefix + transform(content);
  mdEl.value = lines.join("\n");
  update(); baselineHistory();
}
// 色はオブジェクト/文字のプロパティ (override) として扱う (PowerPoint 流)。
// プリセットも hex。カスタムはカラーピッカーで任意の hex。
const CLS_COLOR = { key: "#e53935", weak: "#9e9e9e", note: "#1e88e5" };

// サイズ変更: 要素選択中はその文字、ブロック選択中はそのブロックのスケール override。
function changeSize(deltaPt) {
  if (!selList.length) return;
  for (const it of selList) {
    const meta = blockMeta(it.slide, it.block);
    if (!meta) continue;
    const basePt = currentPt(lastResult.doc.meta || {}, roleOf(meta.type));
    const ov = it.el != null ? elOvFor(it.slide, it.block, it.el) : ovFor(it.slide, it.block);
    const curEff = basePt * (ov.s || 1);
    ov.s = Math.max(6, curEff + deltaPt) / basePt;   // 最小 6pt 相当
  }
  persist(); update(); recordHistory();
}

// 文字単位の override (太字) を編集
function editElOv(mutate) {
  if (!selected || selected.el == null) return;
  const eo = elOvFor(selected.slide, selected.block, selected.el);
  mutate(eo);
  persist(); update(); recordHistory();
}
// 色対象の override: 要素選択中はその文字、ブロック選択中はそのブロック
function colorTarget() {
  if (!selected) return null;
  return selected.el != null
    ? elOvFor(selected.slide, selected.block, selected.el)
    : ovFor(selected.slide, selected.block);
}
function setColor(hexOrNull) {
  if (!selList.length) return;
  for (const it of selList) {
    const t = it.el != null ? elOvFor(it.slide, it.block, it.el) : ovFor(it.slide, it.block);
    if (hexOrNull == null) delete t.color; else t.color = hexOrNull;
  }
  persist(); update(); recordHistory();
}
// 太字: 要素=override / ブロック=MD (** **)
function blockBoldState(it) { // 複数ブロック太字用: MD行から太字状態を読む
  const meta = blockMeta(it.slide, it.block);
  if (!meta || !meta.src || meta.src[1] - meta.src[0] !== 1 || !TEXT_TYPES.has(meta.type)) return { editable: false };
  const { prefix, content } = splitMarker(mdEl.value.split("\n")[meta.src[0]]);
  return { editable: true, line: meta.src[0], prefix, content, bold: isBold(content) };
}
function fmtBoldClick() {
  if (!selList.length) return;
  const els = selList.filter((s) => s.el != null);
  if (els.length) { // 要素(文字): override.bold を統一トグル (全部太字なら解除)
    const allBold = els.every((it) => { const bo = overrides[it.slide] && overrides[it.slide][it.block]; const eo = bo && bo.els && bo.els[it.el]; return eo && eo.bold; });
    for (const it of els) elOvFor(it.slide, it.block, it.el).bold = !allBold;
    persist(); update(); recordHistory(); return;
  }
  const blks = selList.filter((s) => s.el == null);
  if (blks.length === 1) { editBlockContent(toggleBold); return; } // 単一ブロックは従来通り
  const targets = blks.map(blockBoldState).filter((s) => s.editable); // 複数ブロック: MD ** ** を統一トグル
  if (!targets.length) { setStatus("warn", "選択中に太字にできるブロックがありません"); return; }
  const allBold = targets.every((s) => s.bold);
  const lines = mdEl.value.split("\n");
  for (const s of targets) { const d = decompose(s.content); d.bold = !allBold; lines[s.line] = s.prefix + recompose(d); }
  mdEl.value = lines.join("\n");
  update(); baselineHistory();
}
// 現在の選択の override 色 (作成せず読むだけ)
function currentColorVal() {
  if (!selected) return null;
  const bo = overrides[selected.slide] && overrides[selected.slide][selected.block];
  if (selected.el != null) return (bo && bo.els && bo.els[selected.el] && bo.els[selected.el].color) || null;
  return (bo && bo.color) || null;
}
// カラーパレット (PowerPoint 風 swatch ＋ その他の色)
const PALETTE_STD = ["#C00000", "#FF0000", "#FFC000", "#FFFF00", "#92D050", "#00B050", "#00B0F0", "#0070C0", "#002060", "#7030A0"];
const PALETTE_GRAY = ["#000000", "#404040", "#808080", "#BFBFBF", "#D9D9D9", "#FFFFFF"];
const colorPop = document.getElementById("fmtColorPop");
const colorBtn = document.getElementById("fmtColorBtn");
function closeColorPop() {
  if (colorPop) colorPop.classList.remove("is-open");
  if (colorBtn) colorBtn.setAttribute("aria-expanded", "false");
}
function refreshSwatchActive() {
  if (!colorPop) return;
  const cur = (currentColorVal() || "").toUpperCase();
  colorPop.querySelectorAll(".sw").forEach((b) => {
    const on = (b.dataset.color || "").toUpperCase() === cur;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
  const ci = $("fmtColor"); if (ci && /^#[0-9A-F]{6}$/.test(cur)) ci.value = cur;
  const cp = $("customPick"); if (cp && /^#[0-9A-F]{6}$/.test(cur)) cp.value = cur;
}
function openColorPop() {
  if (colorPop) { colorPop.classList.add("is-open"); refreshSwatchActive(); }
  if (colorBtn) colorBtn.setAttribute("aria-expanded", "true");
}
function buildSwatches(container, colors) {
  if (!container) return;
  container.innerHTML = colors.map((c) => `<button class="sw" data-color="${c}" title="${c}" role="radio" aria-checked="false" aria-label="${c}" style="background:${c}"></button>`).join("");
  container.querySelectorAll(".sw").forEach((b) => b.addEventListener("click", () => { setColor(b.dataset.color); closeColorPop(); }));
}
function updateFmtbar() {
  if (!fmtbar) return;
  syncFontSel();
  const meta = (selected && lastResult) ? blockMeta(selected.slide, selected.block) : null;
  const isEl = !!(meta && selected.el != null);
  const boldBtn = $("fmtBold"), colorBtnEl = $("fmtColorBtn");
  const szBtns = [$("fmtSizeUp"), $("fmtSizeDown")];
  const roleLabel = $("fmtRoleLabel"), sizeVal = $("fmtSizeVal");
  const en = (b, on) => { if (b) { b.disabled = !on; b.style.opacity = on ? "1" : "0.4"; } };
  if (!meta) { // 選択なし
    en(boldBtn, false); en(colorBtnEl, false); szBtns.forEach((b) => en(b, false));
    updateAnimBtns(false); closeColorPop();
    if (roleLabel) roleLabel.textContent = "—";
    if (sizeVal) sizeVal.textContent = "–";
    return;
  }
  const bo = overrides[selected.slide] && overrides[selected.slide][selected.block];
  // 個別要素編集モード (charMode 中) や要素選択 (isEl) では登場アニメはブロック単位なので無効化。
  const animUsable = !isEl && !(charMode && charMode.slide === selected.slide && charMode.block === selected.block);
  updateAnimBtns(animUsable, (bo && bo.anim));
  if (isEl) {
    const eo = (bo && bo.els && bo.els[selected.el]) || {};
    const on = !!eo.bold;
    boldBtn.classList.toggle("is-on", on); boldBtn.setAttribute("aria-pressed", on ? "true" : "false");
    en(boldBtn, true);
  } else {
    const editable = !!(meta.src && meta.src[1] - meta.src[0] === 1 && TEXT_TYPES.has(meta.type));
    const content = editable ? splitMarker(mdEl.value.split("\n")[meta.src[0]]).content : "";
    const on = editable && isBold(content);
    boldBtn.classList.toggle("is-on", on); boldBtn.setAttribute("aria-pressed", on ? "true" : "false");
    en(boldBtn, editable);
  }
  en(colorBtnEl, true); szBtns.forEach((b) => en(b, true));
  const cur = currentColorVal();
  const chip = $("fmtColorChip"); if (chip) chip.style.background = cur || "#1b1b1f";
  if (colorPop && colorPop.classList.contains("is-open")) refreshSwatchActive();
  const tgt = isEl ? ((bo && bo.els && bo.els[selected.el]) || {}) : (bo || {});
  const basePt = currentPt(lastResult.doc.meta || {}, roleOf(meta.type));
  if (roleLabel) roleLabel.textContent = selList.length > 1 ? selList.length + "個を選択" : (isEl ? "文字" : ROLE[roleOf(meta.type)].label);
  if (sizeVal) sizeVal.textContent = Math.round(basePt * (tgt.s || 1));
}
if (fmtbar) {
  $("fmtBold").addEventListener("click", fmtBoldClick);
  buildSwatches($("cpStd"), PALETTE_STD);
  buildSwatches($("cpGray"), PALETTE_GRAY);
  if (colorBtn) colorBtn.addEventListener("click", (e) => { e.stopPropagation(); if (colorBtn.disabled) return; colorPop.classList.contains("is-open") ? closeColorPop() : openColorPop(); });
  const fmtColorEl = $("fmtColor"); if (fmtColorEl) fmtColorEl.addEventListener("change", () => setColor(fmtColorEl.value));
  const customPick = $("customPick"); if (customPick) customPick.addEventListener("input", () => setColor(customPick.value));
  const clearBtn = $("fmtClsClear"); if (clearBtn) clearBtn.addEventListener("click", () => { setColor(null); closeColorPop(); });
  document.addEventListener("click", (e) => { if (colorPop && colorPop.classList.contains("is-open") && !e.target.closest("#fmtColorPop") && !e.target.closest("#fmtColorBtn")) closeColorPop(); });
  $("fmtSizeUp").addEventListener("click", (e) => changeSize(e.shiftKey ? 5 : 1));
  $("fmtSizeDown").addEventListener("click", (e) => changeSize(e.shiftKey ? -5 : -1));
  for (const [dir, id] of ANIM_MAP) {
    const b = $(id); if (b) b.addEventListener("click", () => setAnimDir(dir));
  }
}

// ---- フォント選択 ----
// ブロック/文字を選択中 → その対象だけに override.font。未選択 → 文書全体 (frontmatter font:)。
const fontSelEl = document.getElementById("fontSel");
if (fontSelEl) fontSelEl.addEventListener("change", () => {
  const v = fontSelEl.value;
  if (lastResult && lastResult.mode === "text" && selList.length) {
    for (const it of selList) {
      const t = it.el != null ? elOvFor(it.slide, it.block, it.el) : ovFor(it.slide, it.block);
      if (v) t.font = v; else delete t.font;
    }
    persist(); update(); recordHistory();
  } else {
    mdEl.value = v ? setFrontmatterKey(mdEl.value, "font", v) : removeFrontmatterKey(mdEl.value, "font");
    update(); baselineHistory();
  }
});

// ---- M3 ドロップダウン (fmtbar のフォント picker) ----
// native <select> のポップアップは OS 任せで上端編集時に見切れることがあるため、
// クリックで下方向に開くカスタムメニューに置換。空きが無ければ上方向に flip する。
function renderFontMenu() {
  const menu = document.getElementById("fmtFontMenu");
  const sel = document.getElementById("fontSel");
  if (!menu || !sel) return;
  const cur = sel.value || "";
  const opts = Array.from(sel.options);
  // 既定 (value="") にはヒント (Noto Sans JP) を見出しの下に小さく出す。
  menu.innerHTML = opts.map((o, i) => {
    const v = o.value, label = o.textContent;
    const hint = v === "" ? "Noto Sans JP" : "";
    const sel2 = v === cur;
    return `<div class="opt" role="option" data-v="${v.replace(/"/g, "&quot;")}" aria-selected="${sel2 ? "true" : "false"}" tabindex="${sel2 ? 0 : -1}" data-idx="${i}"><span>${label}</span>${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
  }).join("");
  menu.querySelectorAll(".opt").forEach((el) => {
    el.addEventListener("click", () => {
      const v = el.dataset.v;
      sel.value = v;
      sel.dispatchEvent(new Event("change"));
      closeFontMenu();
      document.getElementById("fmtFontBtn")?.focus();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); (el.nextElementSibling || menu.firstElementChild).focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); (el.previousElementSibling || menu.lastElementChild).focus(); }
      else if (e.key === "Escape") { e.preventDefault(); closeFontMenu(); document.getElementById("fmtFontBtn")?.focus(); }
    });
  });
}

function positionFontMenu() {
  const btn = document.getElementById("fmtFontBtn");
  const menu = document.getElementById("fmtFontMenu");
  if (!btn || !menu) return;
  const r = btn.getBoundingClientRect();
  menu.style.minWidth = Math.max(r.width, 220) + "px";
  // measure
  const mh = menu.offsetHeight, mw = menu.offsetWidth;
  // window.innerHeight が 0 を返す環境 (headless プレビュー等) のためフォールバック。
  const winH = window.innerHeight || window.visualViewport?.height || document.documentElement.clientHeight || 800;
  const winW = window.innerWidth || window.visualViewport?.width || document.documentElement.clientWidth || 1280;
  const gap = 6, pad = 8;
  const below = winH - r.bottom - gap;
  const above = r.top - gap;
  let top, flipUp = false;
  if (mh + gap <= below || below >= above) {
    top = r.bottom + gap;
  } else {
    top = Math.max(pad, r.top - mh - gap);
    flipUp = true;
  }
  let left = r.left;
  if (left + mw > winW - pad) left = winW - mw - pad;
  if (left < pad) left = pad;
  menu.style.top = top + "px";
  menu.style.left = left + "px";
  menu.classList.toggle("flip-up", flipUp);
}

let _fontMenuOutside = null, _fontMenuEsc = null, _fontMenuReposition = null;
function openFontMenu() {
  renderFontMenu();
  const menu = document.getElementById("fmtFontMenu");
  const btn = document.getElementById("fmtFontBtn");
  if (!menu || !btn) return;
  menu.classList.add("is-open");
  positionFontMenu();
  btn.setAttribute("aria-expanded", "true");
  // 選択中の項目にフォーカス (なければ先頭)。
  const cur = menu.querySelector('.opt[aria-selected="true"]') || menu.querySelector(".opt");
  cur?.focus({ preventScroll: false });
  _fontMenuOutside = (e) => {
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    closeFontMenu();
  };
  _fontMenuEsc = (e) => { if (e.key === "Escape") { closeFontMenu(); btn.focus(); } };
  _fontMenuReposition = () => positionFontMenu();
  setTimeout(() => document.addEventListener("pointerdown", _fontMenuOutside, true), 0);
  document.addEventListener("keydown", _fontMenuEsc);
  window.addEventListener("resize", _fontMenuReposition);
  window.addEventListener("scroll", _fontMenuReposition, true);
}
function closeFontMenu() {
  const menu = document.getElementById("fmtFontMenu");
  const btn = document.getElementById("fmtFontBtn");
  menu?.classList.remove("is-open");
  menu?.classList.remove("flip-up");
  btn?.setAttribute("aria-expanded", "false");
  if (_fontMenuOutside) document.removeEventListener("pointerdown", _fontMenuOutside, true);
  if (_fontMenuEsc) document.removeEventListener("keydown", _fontMenuEsc);
  if (_fontMenuReposition) { window.removeEventListener("resize", _fontMenuReposition); window.removeEventListener("scroll", _fontMenuReposition, true); }
  _fontMenuOutside = _fontMenuEsc = _fontMenuReposition = null;
}
document.getElementById("fmtFontBtn")?.addEventListener("click", () => {
  const menu = document.getElementById("fmtFontMenu");
  if (menu && menu.classList.contains("is-open")) closeFontMenu(); else openFontMenu();
});
document.getElementById("fmtFontBtn")?.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); openFontMenu(); }
});

// ---- ファイルドロップ / スクロール同期 ----
mdEl.addEventListener("input", () => { clearTimeout(window._t); window._t = setTimeout(() => { update(); baselineHistory(); }, 150); });
mdEl.addEventListener("scroll", () => { const hl = $("mdHighlight"); if (hl) hl.scrollTop = mdEl.scrollTop; });
mdEl.addEventListener("dragover", (e) => e.preventDefault());
mdEl.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { mdEl.value = r.result; selList = []; selected = null; charMode = null; update({ autoOpen: true }); baselineHistory(); };
  r.readAsText(f);
});

// ---- ツールバー ----
document.getElementById("dl").addEventListener("click", () => {
  if (!lastResult || !skeleton) { setStatus("warn", "まだ準備中です"); return; }
  const { doc, slides, color, brushWidthCm, mode, fontFamily, slideWCm, slideHCm, anim } = lastResult;
  if (!slides.length) { setStatus("err", "スライドがありません"); return; }
  try {
    let bytes;
    if (mode === "text") {
      // ネイティブテキスト出力 (辞書不要・編集可能)。override(移動/リサイズ/色)を焼き込む。
      const sb = slides.map((s, i) => applySlideOverrides(s.blocks, overrides[i]));
      bytes = buildPptxText(sb, { color: doc.meta.color || "#000000", slideWCm, slideHCm, fontName: fontFamily || "Noto Sans JP", anim }, skeleton);
    } else {
      const sb = slides.map((s, i) => applySlideOverrides(s.blocks, overrides[i]));
      bytes = buildPptx(sb, { color: doc.meta.color || "#000000", brushWidthCm: doc.meta.brush_width_cm || 0.06 }, skeleton);
    }
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "slides.pptx";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { setStatus("err", "pptx生成エラー: " + (e && e.message ? e.message : e)); console.error(e); }
});

// 元に戻す / やり直し (アプリバー)。状態はキー操作・ボタンどちらでも更新。
$("undo") && $("undo").addEventListener("click", () => { undo(); updateUndoRedoBtns(); });
$("redo") && $("redo").addEventListener("click", () => { redo(); updateUndoRedoBtns(); });
function updateUndoRedoBtns() {
  const u = $("undo"), r = $("redo");
  if (u) { const can = histIdx > 0; u.disabled = !can; u.style.opacity = can ? "1" : "0.4"; }
  if (r) { const can = histIdx < history.length - 1; r.disabled = !can; r.style.opacity = can ? "1" : "0.4"; }
}
$("resetAll").addEventListener("click", () => {
  overrides = {}; selList = []; selected = null; charMode = null; persist(); update(); recordHistory();
  setSettingsOpen(false);
});

// ---- 設定サイドシート ----
let _lastFocusBeforeSheet = null;
function setSettingsOpen(v) {
  const sheet = $("sheet"), scrim = $("scrim"), opener = $("openSettings");
  if (sheet) { sheet.classList.toggle("is-open", v); sheet.setAttribute("aria-hidden", v ? "false" : "true"); }
  if (scrim) { scrim.classList.toggle("is-open", v); scrim.setAttribute("aria-hidden", v ? "false" : "true"); }
  if (opener) opener.setAttribute("aria-expanded", v ? "true" : "false");
  if (v) {
    _lastFocusBeforeSheet = document.activeElement;
    // M3: シートが開いたら最初の操作ボタンへフォーカス (M3 modal focus トラップ的)
    const close = $("closeSettings"); if (close) setTimeout(() => close.focus(), 50);
  } else if (_lastFocusBeforeSheet) {
    try { _lastFocusBeforeSheet.focus(); } catch (_) {}
    _lastFocusBeforeSheet = null;
  }
}
// Esc でシートも閉じる (md エディタフォーカス中は除く)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("sheet") && $("sheet").classList.contains("is-open")) {
    e.preventDefault(); setSettingsOpen(false);
  }
});
function syncSettings() {
  if (!lastResult) return;
  const df = $("setDefaultFont"); const v = lastResult.doc.meta.font || "";
  if (df) df.value = v;
  const list = $("setDefaultFontList");
  if (list) list.querySelectorAll(".radio-item").forEach((i) => i.classList.toggle("is-on", (i.dataset.value || "") === v));
  const sw = $("setAnim"); if (sw) { const on = lastResult.anim !== false; sw.classList.toggle("is-on", on); sw.setAttribute("aria-checked", String(on)); }
}
$("openSettings") && $("openSettings").addEventListener("click", () => { syncSettings(); setSettingsOpen(true); });
$("closeSettings") && $("closeSettings").addEventListener("click", () => setSettingsOpen(false));
$("scrim") && $("scrim").addEventListener("click", () => setSettingsOpen(false));
$("setDefaultFont") && $("setDefaultFont").addEventListener("change", (e) => {
  const v = e.target.value;
  mdEl.value = v ? setFrontmatterKey(mdEl.value, "font", v) : removeFrontmatterKey(mdEl.value, "font");
  update(); baselineHistory();
});
// 既定フォントのラジオリスト: クリック/Enterで hidden select の値を更新して change を発火
const _fontList = $("setDefaultFontList");
if (_fontList) _fontList.querySelectorAll(".radio-item").forEach((item) => {
  const select = () => {
    const v = item.dataset.value || "";
    _fontList.querySelectorAll(".radio-item").forEach((i) => i.classList.toggle("is-on", i === item));
    const sel = $("setDefaultFont");
    if (sel) { sel.value = v; sel.dispatchEvent(new Event("change")); }
  };
  item.addEventListener("click", select);
  item.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
});
$("setAnim") && $("setAnim").addEventListener("click", () => {
  const sw = $("setAnim"); const on = !sw.classList.contains("is-on");
  sw.classList.toggle("is-on", on); sw.setAttribute("aria-checked", String(on));
  mdEl.value = on ? removeFrontmatterKey(mdEl.value, "anim") : setFrontmatterKey(mdEl.value, "anim", "off");
  update(); baselineHistory();
});

// ---- フィルムストリップ: 矢印でストリップを横スクロール ----
function scrollThumbs(dir) { const t = $("thumbs"); if (t) t.scrollBy({ left: dir * Math.max(200, t.clientWidth * 0.8), behavior: "smooth" }); }
$("filmPrev") && $("filmPrev").addEventListener("click", () => scrollThumbs(-1));
$("filmNext") && $("filmNext").addEventListener("click", () => scrollThumbs(1));
// ステージ矢印が残っていればスライド送り (現状UIには無い)
$("prevSlide") && $("prevSlide").addEventListener("click", () => setCurrentSlide(currentSlide - 1));
$("nextSlide") && $("nextSlide").addEventListener("click", () => setCurrentSlide(currentSlide + 1));
// 矢印キーでスライド送り (MD編集中・選択中は除く)
document.addEventListener("keydown", (e) => {
  if (document.activeElement === mdEl || selected) return;
  if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); setCurrentSlide(currentSlide + 1); }
  else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); setCurrentSlide(currentSlide - 1); }
});
window.addEventListener("resize", () => { if (selected) drawSelection(); });
// Esc で選択解除
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && selected && document.activeElement !== mdEl) {
    selList = []; selected = null; charMode = null; clearSelection(); hideFmtbar();
    slidesEl.querySelectorAll(".blk.charmode").forEach((b) => b.classList.remove("charmode"));
    updateFmtbar();
  }
});

// ---- QR オーバーレイのボタン ----
document.getElementById("qrDone").addEventListener("click", recheckDict);
document.getElementById("qrSkip").addEventListener("click", () => {
  closeQrOverlay();
  setStatus("warn", `未登録文字は □ で出力されます (${lastMissing.length}文字)`);
});
qrOverlay.addEventListener("click", (e) => { if (e.target === qrOverlay) closeQrOverlay(); });

// overrides を MD frontmatter に書き戻す (overrides: <json> 行を更新/挿入/削除)
function writeOverridesToMd(text, ov) {
  const empty = !ov || Object.keys(ov).length === 0;
  const json = JSON.stringify(ov);
  text = text.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  if (lines[0] && lines[0].trim() === "---") {
    let end = -1;
    for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") { end = i; break; }
    if (end > 0) {
      let oi = -1;
      for (let i = 1; i < end; i++) if (lines[i].trim().startsWith("overrides:")) { oi = i; break; }
      if (empty) { if (oi >= 0) lines.splice(oi, 1); }      // 空なら行削除
      else if (oi >= 0) lines[oi] = `overrides: ${json}`;
      else lines.splice(end, 0, `overrides: ${json}`);
      return lines.join("\n");
    }
  }
  if (empty) return text;
  return `---\noverrides: ${json}\n---\n\n` + text;
}

async function init() {
  setStatus("warn", "読み込み中…");
  try {
    // テキストモードは辞書不要 (コールドスタートゼロ)。骨格(pptx) と metrics のみ。
    const [m, sk] = await Promise.all([
      fetch("/metrics.json").then((r) => r.json()),
      fetch("/skeleton.json").then((r) => r.json()),
    ]);
    renderer = createRenderer(m);
    characters = {};
    theme = {};
    skeleton = sk.parts;
  } catch (e) { setStatus("err", "読み込み失敗: " + (e && e.message ? e.message : e)); return; }
  if (!mdEl.value.trim()) mdEl.value = SAMPLE;
  update();
  baselineHistory();
  // Webフォント読込後に再計測 (フォント未ロード時の幅ズレを補正)
  if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => update());
  }
}

// 初期表示は機能ショーケース (examples/demo_slides.md と同内容)
const SAMPLE = String.raw`---
type: slides
styles:
  key:   { color: red, bold: true }
  note:  { color: blue }
  brand: { color: "#e8632a", bold: true }
---

# md-slides でできること

- 見出し・箇条書き・段落をそのまま記述
- **太字** と <span class="key">強調</span> <span class="note">補足</span> <span class="weak">控えめ</span>
- 色は <span class="brand">カラーコード</span> 指定も可
- インライン数式 $a^2 + b^2 = c^2$ も文中に

# 数式：基本

- べき乗・添字: $x^2$, $a_n$, $x^{n+1}$, $a_{i,j}$
- 分数: $\frac{1}{2}$, $\frac{x+1}{2y}$
- 平方根: $\sqrt{2}$, $\sqrt{x^2 + 1}$, 3乗根 $\sqrt[3]{x}$

# 数式：大型記号

- 積分: $\int_a^b f(x)\, dx$
- 総和: $\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$
- 極限: $\lim_{x \to 0} \frac{\sin x}{x} = 1$
- ベクトル: $\vec{a} + \vec{b}$

# 関数・ギリシャ・演算子

- 関数: $\sin x$, $\cos x$, $\tan x$, $\log x$, $\ln x$
- ギリシャ: $\pi$, $\theta$, $\alpha$, $\beta$, $\lambda$, $\sigma$, $\omega$
- 演算子: $\pm$, $\times$, $\div$, $\leq$, $\geq$, $\neq$, $\approx$, $\to$, $\Rightarrow$, $\infty$

# 化学記法 \ce{}

- 分子式: $\ce{H2SO4}$, $\ce{CaCO3}$, $\ce{Ca(OH)2}$
- イオン式: $\ce{SO4^2-}$, $\ce{Ca^2+}$, $\ce{Na+}$, $\ce{Cl-}$
- 反応式: $\ce{2H2 + O2 -> 2H2O}$
- 平衡・条件付き: $\ce{N2 + 3H2 <=> 2NH3}$, $\ce{CaCO3 ->[\Delta] CaO + CO2}$

# ブロック数式

- 独立行の数式は $$ で囲む

$$ f'(x) = \lim_{h \to 0} \frac{f(x+h)-f(x)}{h} $$

$$ \int_0^1 x^2\, dx = \left[ \frac{x^3}{3} \right]_0^1 = \frac{1}{3} $$

# 表

| 関数 | 導関数 |
| --- | --- |
| $x^n$ | $n x^{n-1}$ |
| $\sin x$ | $\cos x$ |
| $e^x$ | $e^x$ |

# 増減・凹凸表（カーブ矢印）

| $x$ | $\cdots$ | $-1$ | $\cdots$ | $0$ | $\cdots$ | $1$ | $\cdots$ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| $f''(x)$ | $-$ | $-$ | $-$ | $0$ | $+$ | $+$ | $+$ |
| $f'(x)$ | $+$ | $0$ | $-$ | $-$ | $-$ | $0$ | $+$ |
| $f(x)$ | $\incurvedown$ | $2$ | $\decurvedown$ | $0$ | $\decurveup$ | $-2$ | $\incurveup$ |

# 多段見出しと段落

## 小見出し（##）

行頭マークなしで段落も書けます。文章はそのまま本文として配置されます。

### さらに小さい見出し（###）

$$ e^{i\pi} + 1 = 0 $$
`;

// ---- LLM 向け記法ルール (コピペ用) ----
const LLM_SPEC = String.raw`あなたはmd→slide 用の Markdown を作るアシスタントです。
次の記法に厳密に従い、指定テーマの解説スライドを Markdown だけで出力してください（前置きやコードフェンスは不要）。

【スライドの構造】
・先頭に YAML フロントマター(省略可):
  ---
  type: slides
  heading_pt: 50        # 見出しサイズ(pt)
  subheading_pt: 32     # 小見出し(pt)
  body_pt: 28           # 本文(pt)
  note_pt: 18           # メモ(pt)
  styles:
    key:  { color: red, bold: true }
    note: { color: blue }
  ---
・フォントは pt の役割別固定サイズ(heading_pt/subheading_pt/body_pt/note_pt)。行数で自動縮小しない(入り切らない時は要調整)。
・各スライドは「# 見出し」で始める。新しい「# 」が来ると次のスライドになる(区切り線 --- も可)。
・1スライドにつき「# 」は1つだけ。「## 」「### 」はスライド内の小見出し。

【テキスト】
・箇条書き: 行頭「- 」(* や + は不可)
・段落: 行頭マークなしの文
・メモ: 行頭「> 」(本文より小さめ・グレーの補足注釈)
・太字: **重要**
・色/装飾: <span class="key">語</span> (key=赤太字 / note=青 / weak=灰)。
  frontmatter の styles で独自クラスを定義可。色は CSS 色名(red, crimson, teal 等)か #RRGGBB / #RGB / rgb(r,g,b)。

【数式】インラインは $...$、独立行は $$...$$
・べき乗 x^2 / 添字 a_n / 2文字以上は中括弧 x^{n+1}
・分数 \frac{分子}{分母}
・平方根 \sqrt{x} / n乗根 \sqrt[3]{x}
・積分 \int_a^b f(x)\,dx (_ が下限・^ が上限)
・総和 \sum_{k=1}^{n} k
・極限/関数 \lim_{x \to 0} / \sin x \cos \tan \log \ln
・ベクトル \vec{a}
・記号 \pi \theta \alpha \beta \lambda \mu \sigma \infty \pm \times \div \leq \geq \neq \approx \to \Rightarrow \cdots

【化学 \ce{}】数式の中で \ce{...} と書く (mhchem 風)
・分子式: \ce{H2SO4} (数字は自動で下付き), \ce{Ca(OH)2}
・イオン式: \ce{SO4^2-} \ce{Ca^2+} \ce{Na+} (^電荷 は上付き)
・反応式: \ce{2H2 + O2 -> 2H2O} (係数・+ ・矢印 -> )
・平衡 <=> 、条件付き矢印 \ce{CaCO3 ->[\Delta] CaO + CO2} ( ->[上][下] )
・状態は (s)(l)(g)(aq) をそのまま書く

【表・増減表】
・通常の Markdown 表(| 区切り、2行目は ---)。セル内に数式も可。
・増減の矢印: \nearrow (増加) \searrow (減少)
・2回微分の凹凸を表す曲線矢印:
  \incurveup (増加・下に凸) \incurvedown (増加・上に凸)
  \decurveup (減少・下に凸) \decurvedown (減少・上に凸)

【コツ】
・1スライドの本文は 3〜6 項目程度に。詰め込みすぎない。
・数式は必ず $ で囲む。日本語の語の中にコマンドを混ぜない。

【例】
---
type: slides
styles:
  key: { color: red, bold: true }
---

# 微分の基本
- 関数 $f(x)$ の **変化の割合** を考える
- <span class="key">微分係数</span> は接線の傾き

# 定義
$$ f'(x) = \lim_{h \to 0} \frac{f(x+h)-f(x)}{h} $$
`;

const llmSpecEl = document.getElementById("llmSpec");
if (llmSpecEl) llmSpecEl.value = LLM_SPEC;
const copyLlmBtn = document.getElementById("copyLlm");
if (copyLlmBtn) copyLlmBtn.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(LLM_SPEC); }
  catch (_) { if (llmSpecEl) { llmSpecEl.focus(); llmSpecEl.select(); try { document.execCommand("copy"); } catch (e) {} } }
  copyLlmBtn.textContent = "コピーしました";
  setTimeout(() => { copyLlmBtn.textContent = "コピー"; }, 1500);
});

init();
