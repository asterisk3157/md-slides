// 手書きプレビュー＋エディタ: MD → スライド → ブロック移動/リサイズ(overrides) → pptx。
import { createRenderer } from "/js/render/index.js";
import { buildPptx } from "/js/render/pptxbuild.js";
import { slideToSvgEditable, slideToSvgText, overrideTransform } from "/js/render/svg.js";
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
let selected = null;              // { slide, block, el(任意) }
let charMode = null;              // 文字編集中のブロック { slide, block }
// Undo/Redo (インデックス方式の履歴: history[histIdx] が現在状態)
let history = [], histIdx = -1, dragSnapshot = null;
const snapshot = () => JSON.parse(JSON.stringify(overrides));
function recordHistory() {                 // 確定した編集を1手として記録
  history = history.slice(0, histIdx + 1);
  history.push(snapshot());
  if (history.length > 100) history.shift();
  histIdx = history.length - 1;
}
function baselineHistory() { history = [snapshot()]; histIdx = 0; } // 新規文書の基準点
function persist() { mdEl.value = writeOverridesToMd(mdEl.value, overrides); } // MD frontmatterへ書き戻し
function undo() {
  if (histIdx <= 0) { setStatus("warn", "これ以上戻せません"); return; }
  histIdx -= 1;
  overrides = JSON.parse(JSON.stringify(history[histIdx]));
  selected = null; charMode = null; persist(); update();
}
function redo() {
  if (histIdx >= history.length - 1) { setStatus("warn", "やり直しはありません"); return; }
  histIdx += 1;
  overrides = JSON.parse(JSON.stringify(history[histIdx]));
  selected = null; charMode = null; persist(); update();
}

function setStatus(cls, msg) {
  statusEl.className = `status ${cls}`;
  statusEl.textContent = msg;
  statusEl.style.display = msg ? "block" : "none";
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
  const { doc, slides, color, brushWidthCm, slideWCm, slideHCm, mode, fontFamily } = result;
  if (doc.errors.length) setStatus("err", "ERROR:\n" + doc.errors.join("\n"));
  else if (!slides.length) setStatus("warn", "スライドがありません (# 見出しが必要)");
  else setStatus("ok", `${slides.length} スライド  (ブロックをクリックで選択→ドラッグ移動 / 角ハンドルでリサイズ / Shift 押しながらでグリッド吸着)`);

  slidesEl.innerHTML = slides.map((s, i) =>
    `<div class="slide${s.overflow ? " overflow" : ""}"><div class="num">スライド ${i + 1}` +
    (s.overflow ? `<span class="ovwarn">はみ出し（固定サイズのため自動縮小しません）</span>` : "") +
    (mode === "text" ? `<span class="ovwarn" style="color:#2563eb">テキストモード（フォント）</span>` : "") +
    `</div>` +
    (mode === "text"
      ? slideToSvgText(s.blocks, slideWCm, slideHCm, { pxPerCm: PX, defaultColor: color, brushWidthCm, fontFamily })
      : slideToSvgEditable(s.blocks, slideWCm, slideHCm, { pxPerCm: PX, defaultColor: color, brushWidthCm }, overrides[i])) +
    `</div>`).join("");

  // 各スライドSVGにハンドラ
  slidesEl.querySelectorAll(".slide").forEach((slideDiv, si) => {
    const svg = slideDiv.querySelector("svg");
    svg.addEventListener("pointerdown", (e) => onSvgPointerDown(e, si, svg));
  });
  // char mode のブロックに class 付与
  if (charMode) {
    const sd = slidesEl.querySelectorAll(".slide")[charMode.slide];
    const g = sd && sd.querySelector(`.blk[data-block="${charMode.block}"]`);
    if (g) g.classList.add("charmode");
  }
  if (selected) drawSelection();
  updateFmtbar();
}

function enterCharMode(slide, block, g) {
  slidesEl.querySelectorAll(".blk.charmode").forEach((b) => b.classList.remove("charmode"));
  g.classList.add("charmode");
  charMode = { slide, block };
  selected = { slide, block, el: null };
  clearSelection();
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
    drag = { kind: "block", mode: "resize", slide: selected.slide, block: selected.block, startCm: [cx, cy], ov0: { ...ovFor(selected.slide, selected.block) }, svg };
    svg.setPointerCapture(e.pointerId); e.preventDefault(); return;
  }
  // 文字編集モード中の要素クリック (ehit矩形/インクのどちらをクリックしても選択)
  const elHit = e.target.closest(".el");
  if (charMode && charMode.slide === slide && elHit) {
    lastTap = null;
    const el = parseInt(elHit.dataset.el, 10);
    selected = { slide, block: charMode.block, el };
    drawSelection();
    drag = { kind: "el", mode: "move", slide, block: charMode.block, el, startCm: [cx, cy], ov0: { ...elOvFor(slide, charMode.block, el) }, svg };
    svg.setPointerCapture(e.pointerId); e.preventDefault(); return;
  }
  // ブロック選択 (bhit)
  const g = e.target.closest(".blk");
  if (g) {
    const block = parseInt(g.dataset.block, 10);
    // 自前ダブルタップ判定 → 文字編集モードへ (dblclickイベントはpreventDefaultで発火しない)
    const now = Date.now();
    if (lastTap && lastTap.slide === slide && lastTap.block === block && now - lastTap.time < 350) {
      lastTap = null;
      enterCharMode(slide, block, g);
      e.preventDefault(); return; // ブロックドラッグは開始しない
    }
    lastTap = { slide, block, time: now };
    if (!charMode || charMode.slide !== slide || charMode.block !== block) {
      slidesEl.querySelectorAll(".blk.charmode").forEach((b) => b.classList.remove("charmode"));
      charMode = null;
    }
    selected = { slide, block, el: null };
    drawSelection();
    drag = { kind: "block", mode: "move", slide, block, startCm: [cx, cy], ov0: { ...ovFor(slide, block) }, svg };
    svg.setPointerCapture(e.pointerId); e.preventDefault();
  } else {
    lastTap = null;
    selected = null; clearSelection();
    slidesEl.querySelectorAll(".blk.charmode").forEach((b) => b.classList.remove("charmode"));
    charMode = null;
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
function applyOv(p, ox, oy, ov) {
  const dx = ov.dx || 0, dy = ov.dy || 0, s = ov.s || 1;
  return [ox + (p[0] - ox) * s + dx, oy + (p[1] - oy) * s + dy];
}
function drawSelection() {
  clearSelection();
  if (!selected || !lastResult) return;
  const { slide, block, el } = selected;
  const slideDiv = slidesEl.querySelectorAll(".slide")[slide];
  if (!slideDiv) return;
  const svg = slideDiv.querySelector("svg");
  const blk = lastResult.slides[slide].blocks[block];
  if (!blk) return;
  const bov = (overrides[slide] && overrides[slide][block]) || { dx: 0, dy: 0, s: 1 };
  let corners; // [x,y] in cm の対角2点
  if (el != null && blk.elements && blk.elements[el]) {
    const e = blk.elements[el];
    const eo = (bov.els && bov.els[el]) || { dx: 0, dy: 0, s: 1 };
    // 要素override → ブロックoverride の順で2隅を変換
    let p1 = applyOv([e.x_cm, e.y_cm], e.x_cm, e.y_cm, eo);
    let p2 = applyOv([e.x_cm + e.w_cm, e.y_cm + e.h_cm], e.x_cm, e.y_cm, eo);
    p1 = applyOv(p1, blk.x_cm, blk.y_cm, bov);
    p2 = applyOv(p2, blk.x_cm, blk.y_cm, bov);
    corners = [p1, p2];
  } else {
    const p1 = applyOv([blk.x_cm, blk.y_cm], blk.x_cm, blk.y_cm, bov);
    const p2 = applyOv([blk.x_cm + blk.w_cm, blk.y_cm + blk.h_cm], blk.x_cm, blk.y_cm, bov);
    corners = [p1, p2];
  }
  const x = Math.min(corners[0][0], corners[1][0]) * PX, y = Math.min(corners[0][1], corners[1][1]) * PX;
  const w = Math.abs(corners[1][0] - corners[0][0]) * PX, h = Math.abs(corners[1][1] - corners[0][1]) * PX;
  const NS = "http://www.w3.org/2000/svg";
  const rect = document.createElementNS(NS, "rect");
  rect.setAttribute("class", "sel-rect");
  rect.setAttribute("x", x); rect.setAttribute("y", y); rect.setAttribute("width", Math.max(w, 4)); rect.setAttribute("height", Math.max(h, 4));
  rect.setAttribute("fill", "rgba(0,100,255,0.06)"); rect.setAttribute("stroke", el != null ? "#0a0" : "#06c"); rect.setAttribute("stroke-width", "1.5"); rect.setAttribute("stroke-dasharray", "5 4");
  rect.style.pointerEvents = "none";
  svg.appendChild(rect);
  if (el == null) { // ブロック選択時のみリサイズハンドル
    const hs = 12;
    const handle = document.createElementNS(NS, "rect");
    handle.setAttribute("class", "handle-rect");
    handle.setAttribute("x", x + w - hs / 2); handle.setAttribute("y", y + h - hs / 2); handle.setAttribute("width", hs); handle.setAttribute("height", hs);
    handle.setAttribute("fill", "#06c"); handle.setAttribute("stroke", "#fff"); handle.setAttribute("stroke-width", "1.5");
    handle.style.cursor = "nwse-resize";
    svg.appendChild(handle);
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
  if (!selected) return;
  const meta = blockMeta(selected.slide, selected.block);
  if (!meta) return;
  const basePt = currentPt(lastResult.doc.meta || {}, roleOf(meta.type));
  const ov = selected.el != null
    ? elOvFor(selected.slide, selected.block, selected.el)
    : ovFor(selected.slide, selected.block);
  const curEff = basePt * (ov.s || 1);
  ov.s = Math.max(6, curEff + deltaPt) / basePt;   // 最小 6pt 相当
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
  const t = colorTarget();
  if (!t) return;
  if (hexOrNull == null) delete t.color; else t.color = hexOrNull;
  persist(); update(); recordHistory();
}
// 太字: 要素=override / ブロック=MD (** **)
function fmtBoldClick() {
  if (selected && selected.el != null) editElOv((eo) => { eo.bold = !eo.bold; });
  else editBlockContent(toggleBold);
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
function closeColorPop() { if (colorPop) colorPop.style.display = "none"; }
function refreshSwatchActive() {
  if (!colorPop) return;
  const cur = (currentColorVal() || "").toUpperCase();
  colorPop.querySelectorAll(".sw").forEach((b) => b.classList.toggle("active", b.dataset.color.toUpperCase() === cur));
  const ci = document.getElementById("fmtColor");
  if (ci && /^#[0-9A-F]{6}$/.test(cur)) ci.value = cur;
}
function openColorPop() { if (colorPop) { colorPop.style.display = "block"; refreshSwatchActive(); } }
function buildSwatches(container, colors) {
  if (!container) return;
  container.innerHTML = colors.map((c) => `<button class="sw" data-color="${c}" title="${c}" style="background:${c}"></button>`).join("");
  container.querySelectorAll(".sw").forEach((b) => b.addEventListener("click", () => { setColor(b.dataset.color); closeColorPop(); }));
}
function updateFmtbar() {
  if (!fmtbar) return;
  fmtbar.style.display = "flex"; // 常時表示 (出し入れによるレイアウトのズレを防ぐ)
  const meta = (selected && lastResult) ? blockMeta(selected.slide, selected.block) : null;
  const isEl = !!(meta && selected.el != null);
  const boldBtn = document.getElementById("fmtBold");
  const colorBtnEl = document.getElementById("fmtColorBtn");
  const szBtns = [document.getElementById("fmtSizeUp"), document.getElementById("fmtSizeDown")];
  const en = (b, on) => { if (b) { b.disabled = !on; b.style.opacity = on ? "1" : "0.4"; } };

  if (!meta) { // 選択なし → 全部グレーアウト
    en(boldBtn, false); en(colorBtnEl, false); szBtns.forEach((b) => en(b, false));
    closeColorPop();
    document.getElementById("fmtRole").textContent = "—";
    document.getElementById("fmtSizeVal").textContent = "–";
    return;
  }
  const bo = overrides[selected.slide] && overrides[selected.slide][selected.block];
  // 太字: 要素=override / ブロック=単一行テキストのみ MD
  if (isEl) {
    const eo = (bo && bo.els && bo.els[selected.el]) || {};
    boldBtn.classList.toggle("active", !!eo.bold); en(boldBtn, true);
  } else {
    const editable = !!(meta.src && meta.src[1] - meta.src[0] === 1 && TEXT_TYPES.has(meta.type));
    const content = editable ? splitMarker(mdEl.value.split("\n")[meta.src[0]]).content : "";
    boldBtn.classList.toggle("active", editable && isBold(content)); en(boldBtn, editable);
  }
  en(colorBtnEl, true); szBtns.forEach((b) => en(b, true));
  // 色チップ (現在色) + パレット表示中なら active 更新
  const cur = currentColorVal();
  const chip = document.getElementById("fmtColorChip");
  if (chip) chip.style.background = cur || "#000000";
  if (colorPop && colorPop.style.display === "block") refreshSwatchActive();
  // サイズ
  const tgt = isEl ? ((bo && bo.els && bo.els[selected.el]) || {}) : (bo || {});
  const basePt = currentPt(lastResult.doc.meta || {}, roleOf(meta.type));
  document.getElementById("fmtRole").textContent = isEl ? "文字" : ROLE[roleOf(meta.type)].label;
  document.getElementById("fmtSizeVal").textContent = Math.round(basePt * (tgt.s || 1)) + "pt";
}
if (fmtbar) {
  document.getElementById("fmtBold").addEventListener("click", fmtBoldClick);
  // カラーパレット
  buildSwatches(document.getElementById("cpStd"), PALETTE_STD);
  buildSwatches(document.getElementById("cpGray"), PALETTE_GRAY);
  if (colorBtn) colorBtn.addEventListener("click", (e) => { e.stopPropagation(); if (colorBtn.disabled) return; (colorPop.style.display === "block") ? closeColorPop() : openColorPop(); });
  const fmtColorEl = document.getElementById("fmtColor");
  if (fmtColorEl) fmtColorEl.addEventListener("change", () => setColor(fmtColorEl.value)); // その他の色 (カラーコード)
  const clearBtn = document.getElementById("fmtClsClear");
  if (clearBtn) clearBtn.addEventListener("click", () => { setColor(null); closeColorPop(); });
  // ポップアップ外クリックで閉じる
  document.addEventListener("click", (e) => { if (colorPop && colorPop.style.display === "block" && !e.target.closest(".fmt-colorwrap")) closeColorPop(); });
  document.getElementById("fmtSizeUp").addEventListener("click", () => changeSize(2));
  document.getElementById("fmtSizeDown").addEventListener("click", () => changeSize(-2));
}

// ---- ファイルドロップ ----
mdEl.addEventListener("input", () => { clearTimeout(window._t); window._t = setTimeout(() => { update(); baselineHistory(); }, 150); });
mdEl.addEventListener("dragover", (e) => e.preventDefault());
mdEl.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { mdEl.value = r.result; selected = null; charMode = null; update({ autoOpen: true }); baselineHistory(); };
  r.readAsText(f);
});

// ---- ツールバー ----
document.getElementById("dl").addEventListener("click", () => {
  if (!lastResult || !skeleton) { setStatus("warn", "まだ準備中です"); return; }
  const { doc, slides, color, brushWidthCm } = lastResult;
  if (!slides.length) { setStatus("err", "スライドがありません"); return; }
  try {
    const sb = slides.map((s, i) => applySlideOverrides(s.blocks, overrides[i]));
    const bytes = buildPptx(sb, { color: doc.meta.color || "#000000", brushWidthCm: doc.meta.brush_width_cm || 0.06 }, skeleton);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "slides.pptx";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { setStatus("err", "pptx生成エラー: " + (e && e.message ? e.message : e)); console.error(e); }
});

document.getElementById("save").addEventListener("click", () => {
  persist();
  setStatus("ok", "overrides を MD frontmatter に保存しました (このMDをコピー/保管すれば位置調整が残ります。編集中も自動保存されています)");
});
document.getElementById("resetSel").addEventListener("click", () => {
  if (selected && overrides[selected.slide] && overrides[selected.slide][selected.block]) {
    if (selected.el != null && overrides[selected.slide][selected.block].els) delete overrides[selected.slide][selected.block].els[selected.el];
    else delete overrides[selected.slide][selected.block];
    persist(); update(); recordHistory();
  }
});
document.getElementById("resetAll").addEventListener("click", () => {
  overrides = {}; selected = null; charMode = null; persist(); update(); recordHistory();
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
  setStatus("warn", "辞書・メトリクス・骨格を読み込み中…");
  try {
    const [m, ex, sk] = await Promise.all([
      fetch("/metrics.json").then((r) => r.json()),
      fetch("/api/export").then((r) => r.json()),
      fetch("/skeleton.json").then((r) => r.json()),
    ]);
    renderer = createRenderer(m);
    characters = ex.characters || {};
    theme = ex.theme || {};
    skeleton = sk.parts;
  } catch (e) { setStatus("err", "読み込み失敗: " + (e && e.message ? e.message : e)); return; }
  if (!mdEl.value.trim()) mdEl.value = SAMPLE;
  update(); // 初期SAMPLEではQRを自動表示しない (バーのみ)。ドロップ時に全画面QR
  baselineHistory();
}

// 初期表示は機能ショーケース (examples/demo_slides.md と同内容)
const SAMPLE = String.raw`---
type: handwriting-slides
styles:
  key:   { color: red, bold: true }
  note:  { color: blue }
  brand: { color: "#e8632a", bold: true }
---

# Tegaki Slides でできること

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
const LLM_SPEC = String.raw`あなたは「Tegaki Slides」用の Markdown を作るアシスタントです。
次の記法に厳密に従い、指定テーマの解説スライドを Markdown だけで出力してください（前置きやコードフェンスは不要）。

【スライドの構造】
・先頭に YAML フロントマター(省略可):
  ---
  type: handwriting-slides
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
type: handwriting-slides
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
