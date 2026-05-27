// 連続登録モード: 未達成の文字を順に提示して連続で書く
// PRESET_SETS は presets.js で window に定義済み
const PRESET_SETS = window.PRESET_SETS;

// 致命的エラーを画面に出すフック
const BENIGN_ERR = /ResizeObserver loop|Script error\./;
window.addEventListener("error", (e) => {
  const msg = e.message || e.error?.message || String(e);
  if (BENIGN_ERR.test(msg)) { console.warn("[benign]", msg); return; }
  const el = document.getElementById("status-line");
  if (el) el.textContent = "❌ JS error: " + msg;
  console.error("[bulk.js error]", e);
});
window.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason?.message || String(e.reason);
  if (BENIGN_ERR.test(msg)) { console.warn("[benign]", msg); return; }
  const el = document.getElementById("status-line");
  if (el) el.textContent = "❌ Promise rejected: " + msg;
  console.error("[bulk.js rejection]", e);
});

// ===== クエリパース =====
const params = new URLSearchParams(location.search);
const setIds = (params.get("set") || "").split(",").filter(Boolean);
const customChars = params.get("custom") || "";
// words: カンマ区切りの単語トークン (関数名 "sin","cos" 等の単語グリフ)
const customWords = (params.get("words") || "").split(",").map((s) => s.trim()).filter(Boolean);
let target = Math.max(1, parseInt(params.get("target") || "1", 10));

// 文字リスト構築 (重複除去、入力順保持)。1文字 と 単語トークン を混在で持つ。
const seen = new Set();
const allChars = [];
function addChar(ch) {
  if (!ch || seen.has(ch)) return;
  seen.add(ch);
  allChars.push(ch);
}
for (const id of setIds) {
  const preset = PRESET_SETS[id];
  if (!preset) continue;
  for (const ch of preset.chars || "") addChar(ch);
  for (const tok of preset.tokens || []) addChar(tok);  // 単語トークン
}
for (const ch of customChars) addChar(ch);
for (const w of customWords) addChar(w);

// ===== DOM参照 =====
const statusLine = document.getElementById("status-line");
const progressFill = document.getElementById("progress-fill");
const bulkMain = document.getElementById("bulk-main");
const targetCharEl = document.getElementById("target-char");
const targetCountEl = document.getElementById("target-count");
const ghostEl = document.getElementById("ghost");
const padCanvas = document.getElementById("pad");
const existingEl = document.getElementById("existing-variants");
const existingEmpty = document.getElementById("existing-empty");
const toast = document.getElementById("toast");
const doneScreen = document.getElementById("done-screen");
const doneMsg = document.getElementById("done-msg");

// ★ TDZ回避: init() より前で宣言する
let missingList = [];   // 残り未達成の文字 (allChars の部分集合、順序保持)
let currentIdx = 0;     // missingList のインデックス
let pad = null;
// 直近で登録した文字の履歴 (戻るボタンで巻き戻すため)。
// 古い順 → 新しい順。pop して直前の登録に戻る。
let registeredHistory = [];

if (allChars.length === 0) {
  statusLine.textContent = "❌ 対象文字が指定されていません。トップから連続登録モードを選び直してください。";
} else {
  init();
}

async function init() {
  pad = new StrokePad(padCanvas, {
    ghostEl,
    lineWidth: 3,
    onAnchorChange: (anchors) => {
      // 配置後はボタンの active 解除
      document.querySelectorAll(".anchor-btn[data-anchor]")
        .forEach((b) => b.classList.remove("active"));
    },
  });
  bulkMain.style.display = "";
  setupShortcuts();
  await refreshMissing(true);
}

async function refreshMissing(initialLoad = false) {
  statusLine.textContent = "未達成リスト取得中...";
  // 1文字 と 単語トークンを分けてクエリに乗せる (join("") だと単語が連結して壊れるため)
  const singles = allChars.filter((c) => Array.from(c).length === 1);
  const words = allChars.filter((c) => Array.from(c).length > 1);
  const qs = new URLSearchParams();
  qs.set("chars", singles.join(""));
  if (words.length) qs.set("words", words.join(","));
  qs.set("target", String(target));
  const url = `/api/bulk/missing?${qs.toString()}`;
  console.log("[bulk] fetching", url);
  let res;
  try {
    res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    statusLine.textContent = "❌ fetch失敗: " + e.message;
    console.error(e);
    return;
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    statusLine.textContent = "❌ JSON parse失敗: " + e.message;
    console.error(e);
    return;
  }
  console.log("[bulk] got data", data);
  missingList = data.missing || [];

  if (initialLoad) {
    currentIdx = 0;
  } else {
    const cur = targetCharEl.textContent;
    const idx = missingList.indexOf(cur);
    currentIdx = idx >= 0 ? idx : 0;
  }
  try {
    updateUI();
  } catch (e) {
    statusLine.textContent = "❌ updateUI失敗: " + e.message;
    console.error(e);
  }
}

function updateUI() {
  const total = allChars.length;
  const remaining = missingList.length;
  const done = total - remaining;
  statusLine.textContent = `登録達成 ${done} / ${total} 文字（未達成 ${remaining}）— 目標 ${target} バリエーション/字`;
  progressFill.style.width = total === 0 ? "0%" : `${(done / total) * 100}%`;

  if (missingList.length === 0) {
    bulkMain.style.display = "none";
    doneScreen.style.display = "";
    doneMsg.textContent = `全 ${total} 文字が目標 ${target} バリエーションに到達しました。`;
    return;
  }
  if (currentIdx < 0) currentIdx = 0;
  if (currentIdx >= missingList.length) currentIdx = missingList.length - 1;

  const cur = missingList[currentIdx];
  targetCharEl.textContent = cur;
  pad.setGhost(cur);
  pad.clear();
  // 数式記号はガイド、通常文字は基準線グリッド (em座標登録)
  if (window.GUIDE_TEMPLATES && window.GUIDE_TEMPLATES[cur]) {
    pad.setGuide(window.GUIDE_TEMPLATES[cur]);
    pad.setBaselineGrid(false);
  } else {
    pad.setGuide(null);
    pad.setBaselineGrid(true);
  }

  loadExisting(cur);
}

async function loadExisting(ch) {
  existingEl.innerHTML = "";
  let list = [];
  try {
    const r = await fetch(`/api/chars/${pathEncodeChar(ch)}/variants`);
    if (r.ok) list = await r.json();
  } catch {}

  targetCountEl.textContent = `${list.length} / ${target} バリエーション`;
  existingEmpty.style.display = list.length === 0 ? "" : "none";

  for (const v of list) {
    const card = document.createElement("div");
    card.className = "variant-card";
    let payload;
    try { payload = JSON.parse(v.strokes_json); } catch { payload = { strokes: [] }; }
    card.appendChild(renderPreviewSvg(payload.strokes || [], payload.anchors || []));
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${v.registered_by || "(匿名)"}`;
    card.appendChild(meta);
    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "削除";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`「${ch}」のこのバリエーションを削除しますか？`)) return;
      try {
        const r = await fetch(
          `/api/chars/${pathEncodeChar(ch)}/variants/${v.id}`,
          { method: "DELETE" }
        );
        if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`);
        showToast("削除しました");
        // 既存リストを再表示
        await loadExisting(ch);
        // missingリストを再取得 (削除で未達になり得るので)
        await refreshMissing(false);
      } catch (e) {
        console.error(e);
        showToast("削除に失敗しました");
      }
    });
    card.appendChild(del);
    existingEl.appendChild(card);
  }
}

function renderPreviewSvg(strokes, anchors = []) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  // ストローク全体のbboxにviewBoxを合わせる (em座標は 0..1 を超えるので固定だと右に偏る)。
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const s of strokes) for (const p of (s.points || [])) {
    if (p[0] < xMin) xMin = p[0]; if (p[1] < yMin) yMin = p[1];
    if (p[0] > xMax) xMax = p[0]; if (p[1] > yMax) yMax = p[1];
  }
  if (!isFinite(xMin)) { xMin = 0; yMin = 0; xMax = 1; yMax = 1; }
  const pad = 0.08 * Math.max(xMax - xMin, yMax - yMin, 0.1);
  const vw = Math.max(xMax - xMin + 2 * pad, 1e-3), vh = Math.max(yMax - yMin + 2 * pad, 1e-3);
  svg.setAttribute("viewBox", `${xMin - pad} ${yMin - pad} ${vw} ${vh}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  for (const s of strokes) {
    const pts = s.points || [];
    if (pts.length < 2) continue;
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0]} ${pts[i][1]}`;
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#000");
    path.setAttribute("stroke-width", "0.03");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  }
  const COLORS = { sub: "#2563eb", sup: "#dc2626", body: "#16a34a" };
  for (const a of anchors) {
    const c = document.createElementNS(svgNS, "circle");
    c.setAttribute("cx", a.x); c.setAttribute("cy", a.y);
    c.setAttribute("r", 0.035); c.setAttribute("fill", "none");
    c.setAttribute("stroke", COLORS[a.type] || "#666");
    c.setAttribute("stroke-width", 0.012);
    svg.appendChild(c);
  }
  return svg;
}

// ===== ボタン =====
document.getElementById("undo").addEventListener("click", () => pad.undo());
document.getElementById("clear").addEventListener("click", () => pad.clear());
document.getElementById("preview").addEventListener("click", () => pad.preview());
document.getElementById("skip").addEventListener("click", () => goNext());
document.getElementById("back").addEventListener("click", () => goPrev());
document.getElementById("save").addEventListener("click", () => saveAndNext());

// アンカー設定ボタン
const anchorButtons = document.querySelectorAll(".anchor-btn[data-anchor]");
anchorButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!pad) return;
    const type = btn.dataset.anchor;
    pad.setAnchorMode(type);
    anchorButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});
const anchorClearBtn = document.getElementById("anchor-clear");
if (anchorClearBtn) anchorClearBtn.addEventListener("click", () => {
  if (pad) pad.clearAnchors();
  anchorButtons.forEach((b) => b.classList.remove("active"));
});
document.getElementById("raise-target").addEventListener("click", () => {
  target += 1;
  doneScreen.style.display = "none";
  bulkMain.style.display = "";
  refreshMissing(true);
});

async function saveAndNext() {
  const payload = pad.exportNormalized();
  if (!payload) {
    showToast("先に何か描いてください");
    return;
  }
  // 表示中のターゲット文字を優先（missingListとUIの不整合に強い）
  let ch = (targetCharEl.textContent || "").trim() || missingList[currentIdx];
  console.log("[saveAndNext.v2] ch=", JSON.stringify(ch), "missing[0..3]=", missingList.slice(0,3), "idx=", currentIdx, "DOMtxt=", JSON.stringify(targetCharEl.textContent));
  if (!ch || ch === "") {
    console.error("[saveAndNext] ch is empty!", {
      missingList,
      currentIdx,
      targetCharText: targetCharEl.textContent,
      allChars,
    });
    showToast(`❌ 対象文字が不明 (missing=${JSON.stringify(missingList).slice(0,100)} idx=${currentIdx})`, 5000);
    return;
  }
  try {
    const r = await fetch(`/api/chars/${pathEncodeChar(ch)}/variants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strokes_json: JSON.stringify(payload) }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error(e);
    showToast("登録に失敗しました");
    return;
  }
  showToast("登録しました");
  // 登録履歴に追加 (戻るボタンで巻き戻すため)
  registeredHistory.push(ch);
  // この文字が target 達成したか確認
  const r2 = await fetch(`/api/chars/${pathEncodeChar(ch)}/variants`);
  const list2 = r2.ok ? await r2.json() : [];
  if (list2.length >= target) {
    // 達成 → missingList から外して次へ
    missingList.splice(currentIdx, 1);
    if (currentIdx >= missingList.length) currentIdx = missingList.length - 1;
    updateUI();
  } else {
    // 未達成 → 同じ文字で書き続ける (リフレッシュのみ)
    pad.clear();
    loadExisting(ch);
  }
}

function goNext() {
  if (missingList.length === 0) return;
  currentIdx = (currentIdx + 1) % missingList.length;
  updateUI();
}

// 戻る: 直前に登録した文字に戻る (履歴ベース)
// その文字が達成済みで missingList から外れていたら、再追加して見えるようにする
function goPrev() {
  if (registeredHistory.length === 0) {
    showToast("登録履歴がありません");
    return;
  }
  const last = registeredHistory.pop();
  let idx = missingList.indexOf(last);
  if (idx < 0) {
    // 達成済みで missingList から削除されていた → 現在位置に挿入
    missingList.splice(currentIdx, 0, last);
    idx = currentIdx;
  }
  currentIdx = idx;
  updateUI();
  showToast(`「${last}」に戻ります (右側のバリエーション一覧から「削除」可能)`, 2500);
}

// ===== キーボードショートカット =====
function setupShortcuts() {
  document.addEventListener("keydown", (e) => {
    // 入力欄で打鍵中は無効化
    if (e.target.matches("input, textarea")) return;
    switch (e.key) {
      case "Enter": e.preventDefault(); saveAndNext(); break;
      case "ArrowRight": e.preventDefault(); goNext(); break;
      case "ArrowLeft":  e.preventDefault(); goPrev(); break;
      case "u": case "U": pad.undo(); break;
      case "c": case "C": pad.clear(); break;
      case "p": case "P": pad.preview(); break;
    }
  });
}

function showToast(msg, ms = 1200) {
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), ms);
}
