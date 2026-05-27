// 文字編集ページ: 手書きパッド (StrokePad共通コンポーネント) + バリエーション一覧

const params = new URLSearchParams(location.search);
const targetChar = params.get("c") || "";

const titleEl = document.getElementById("title");
const ghostEl = document.getElementById("ghost");
const variantsEl = document.getElementById("variants");
const variantsEmpty = document.getElementById("variants-empty");
const toast = document.getElementById("toast");
const padCanvas = document.getElementById("pad");

const undoBtn = document.getElementById("undo");
const clearBtn = document.getElementById("clear");
const previewBtn = document.getElementById("preview");
const saveBtn = document.getElementById("save");

if (!targetChar) {
  alert("文字が指定されていません。一覧に戻ります。");
  location.href = "/chars";
}

document.title = `『${targetChar}』 — Tegaki Slides`;

const pad = new StrokePad(padCanvas, { ghostEl, lineWidth: 3 });
pad.setGhost(targetChar);
// 数式記号にはガイドテンプレート、通常文字には基準線グリッド (em座標登録)
if (window.GUIDE_TEMPLATES && window.GUIDE_TEMPLATES[targetChar]) {
  pad.setGuide(window.GUIDE_TEMPLATES[targetChar]);
  const hint = document.getElementById("anchor-hint");
  if (hint) hint.textContent = window.GUIDE_TEMPLATES[targetChar].description;
} else {
  pad.setBaselineGrid(true);
  const hint = document.getElementById("anchor-hint");
  if (hint) hint.textContent = "基準線に合わせて書いてください。ベースライン(赤)に乗せ、大文字は上端まで／小文字はx-height(青)までの高さで。描いた大きさがそのまま反映されます。";
}

undoBtn.addEventListener("click", () => pad.undo());
clearBtn.addEventListener("click", () => pad.clear());
previewBtn.addEventListener("click", () => pad.preview());

// アンカー設定ボタン
const anchorButtons = document.querySelectorAll(".anchor-btn[data-anchor]");
anchorButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const type = btn.dataset.anchor;
    pad.setAnchorMode(type);
    anchorButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const hint = document.getElementById("anchor-hint");
    if (hint) hint.textContent = `「${btn.textContent.replace("+","")}」の位置をキャンバスでクリックしてください`;
  });
});
const anchorClearBtn = document.getElementById("anchor-clear");
if (anchorClearBtn) anchorClearBtn.addEventListener("click", () => {
  pad.clearAnchors();
  anchorButtons.forEach((b) => b.classList.remove("active"));
});
// 配置後にボタン状態リセット
const origOnAnchorChange = (anchors) => {
  anchorButtons.forEach((b) => b.classList.remove("active"));
  const hint = document.getElementById("anchor-hint");
  if (hint) hint.textContent = `現在のアンカー: ${anchors.length === 0 ? "なし" : anchors.map(a => a.type).join(", ")}`;
};
pad._onAnchorChange = origOnAnchorChange;

saveBtn.addEventListener("click", async () => {
  const payload = pad.exportNormalized();
  if (!payload) {
    showToast("先に何か描いてください");
    return;
  }
  saveBtn.disabled = true;
  try {
    const res = await fetch(`/api/chars/${pathEncodeChar(targetChar)}/variants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strokes_json: JSON.stringify(payload) }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast("登録しました");
    pad.clear();
    await loadVariants();
  } catch (e) {
    console.error(e);
    showToast("登録に失敗しました");
  } finally {
    saveBtn.disabled = false;
  }
});

async function loadVariants() {
  let list = [];
  try {
    const res = await fetch(`/api/chars/${pathEncodeChar(targetChar)}/variants`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    list = await res.json();
  } catch (e) {
    console.error(e);
    showToast("バリエーション取得に失敗");
  }

  titleEl.textContent = `『${targetChar}』のバリエーション (${list.length}件)`;
  variantsEl.innerHTML = "";
  variantsEmpty.style.display = list.length === 0 ? "block" : "none";

  for (const v of list) {
    const card = document.createElement("div");
    card.className = "variant-card";

    let payload;
    try {
      payload = JSON.parse(v.strokes_json);
    } catch {
      payload = { strokes: [] };
    }

    card.appendChild(renderPreviewSvg(payload.strokes || [], payload.anchors || []));

    const meta = document.createElement("div");
    meta.className = "meta";
    const d = (v.registered_at || "").replace("T", " ").slice(0, 16);
    meta.textContent = `${v.registered_by || "(匿名)"}\n${d}`;
    meta.style.whiteSpace = "pre-line";
    card.appendChild(meta);

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "削除";
    del.addEventListener("click", async () => {
      if (!confirm("このバリエーションを削除しますか？")) return;
      try {
        const r = await fetch(
          `/api/chars/${pathEncodeChar(targetChar)}/variants/${v.id}`,
          { method: "DELETE" }
        );
        if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`);
        showToast("削除しました");
        await loadVariants();
      } catch (e) {
        console.error(e);
        showToast("削除に失敗しました");
      }
    });
    card.appendChild(del);

    variantsEl.appendChild(card);
  }
}

function renderPreviewSvg(strokesNorm, anchors = []) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  // ストローク全体のbboxにviewBoxを合わせる (em座標は 0..1 を超えるので固定だと右に偏る)。
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const s of strokesNorm) for (const p of (s.points || [])) {
    if (p[0] < xMin) xMin = p[0]; if (p[1] < yMin) yMin = p[1];
    if (p[0] > xMax) xMax = p[0]; if (p[1] > yMax) yMax = p[1];
  }
  if (!isFinite(xMin)) { xMin = 0; yMin = 0; xMax = 1; yMax = 1; }
  const pad = 0.08 * Math.max(xMax - xMin, yMax - yMin, 0.1);
  const vx = xMin - pad, vy = yMin - pad;
  const vw = Math.max(xMax - xMin + 2 * pad, 1e-3), vh = Math.max(yMax - yMin + 2 * pad, 1e-3);
  svg.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  for (const s of strokesNorm) {
    const pts = s.points || [];
    if (pts.length < 2) continue;
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i][0]} ${pts[i][1]}`;
    }
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#000");
    path.setAttribute("stroke-width", "0.03");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  }

  // アンカーマーカー
  const COLORS = { sub: "#2563eb", sup: "#dc2626", body: "#16a34a" };
  for (const a of anchors) {
    const c = document.createElementNS(svgNS, "circle");
    c.setAttribute("cx", a.x);
    c.setAttribute("cy", a.y);
    c.setAttribute("r", 0.035);
    c.setAttribute("fill", "none");
    c.setAttribute("stroke", COLORS[a.type] || "#666");
    c.setAttribute("stroke-width", 0.012);
    svg.appendChild(c);
  }
  return svg;
}

function showToast(msg, ms = 1500) {
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), ms);
}

// この文字の全バリエーション削除 (再登録用)
const deleteCharAllBtn = document.getElementById("delete-char-all");
if (deleteCharAllBtn) deleteCharAllBtn.addEventListener("click", async () => {
  if (!confirm(`『${targetChar}』の登録を全て削除します。元に戻せません。よろしいですか？`)) return;
  try {
    const res = await fetch(`/api/chars/${pathEncodeChar(targetChar)}/variants`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    showToast(`${j.deleted} 件削除しました`);
    await loadVariants();
  } catch (e) { console.error(e); showToast("削除に失敗しました"); }
});

loadVariants();
