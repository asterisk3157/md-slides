// 文字一覧ページ

const grid = document.getElementById("grid");
const statsEl = document.getElementById("stats");
const searchEl = document.getElementById("search");
const emptyEl = document.getElementById("empty");
const toast = document.getElementById("toast");
const addBtn = document.getElementById("add-btn");

let allChars = []; // [{char, count}]

function showToast(msg, ms = 1500) {
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), ms);
}

// バリエーション数 → セル背景色 (白→淡橙→濃橙)
function colorFor(count) {
  if (count <= 0) return "#ffffff";
  const max = 10;
  const t = Math.min(count, max) / max;
  // #fff5e6 (255,245,230) → #ff8c00 (255,140,0)
  const r = 255;
  const g = Math.round(245 + (140 - 245) * t);
  const b = Math.round(230 + (0 - 230) * t);
  return `rgb(${r},${g},${b})`;
}

function render(filter = "") {
  grid.innerHTML = "";
  const filtered = filter
    ? allChars.filter((x) => x.char.includes(filter))
    : allChars;

  for (const { char, count } of filtered) {
    const a = document.createElement("a");
    a.className = "char-cell";
    a.href = `/char.html?c=${encodeURIComponent(char)}`;
    a.style.background = colorFor(count);
    a.textContent = char;
    const b = document.createElement("span");
    b.className = "badge";
    b.textContent = `×${count}`;
    a.appendChild(b);
    grid.appendChild(a);
  }

  // 末尾に「+ 追加」セル（フィルタなしのときだけ）
  if (!filter) {
    const add = document.createElement("a");
    add.className = "char-cell add-new";
    add.href = "#";
    add.textContent = "+";
    add.title = "新しい文字を追加";
    add.addEventListener("click", (e) => {
      e.preventDefault();
      promptNewChar();
    });
    grid.appendChild(add);
  }

  emptyEl.style.display = filtered.length === 0 && !filter ? "block" : "none";
}

function promptNewChar() {
  const c = prompt("登録したい文字を1文字入力してください:");
  if (!c) return;
  const trimmed = c.trim();
  if ([...trimmed].length !== 1) {
    alert("1文字だけ入力してください。");
    return;
  }
  const ch = [...trimmed][0];
  location.href = `/char.html?c=${encodeURIComponent(ch)}&new=1`;
}

async function load() {
  try {
    const res = await fetch("/api/chars");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allChars = await res.json();
  } catch (e) {
    console.error(e);
    showToast("読み込みに失敗しました");
    allChars = [];
  }

  const totalChars = allChars.length;
  const totalVariants = allChars.reduce((acc, x) => acc + (x.count || 0), 0);
  statsEl.textContent = `${totalChars} 文字 / ${totalVariants} バリエーション`;
  render(searchEl.value);
}

searchEl.addEventListener("input", () => render(searchEl.value));
addBtn.addEventListener("click", promptNewChar);

// 全削除 (再登録用)。誤爆防止に「削除」のタイプ確認 + API側 confirm=ALL を必須化。
const deleteAllBtn = document.getElementById("delete-all");
if (deleteAllBtn) deleteAllBtn.addEventListener("click", async () => {
  const total = allChars.reduce((a, x) => a + (x.count || 0), 0);
  const phrase = prompt(`登録済みの全 ${total} バリエーションを削除します。元に戻せません。\n削除するには「削除」と入力してください。`);
  if (phrase !== "削除") { showToast("キャンセルしました"); return; }
  try {
    const res = await fetch("/api/chars?confirm=ALL", { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    showToast(`${j.deleted} 件削除しました`);
    await load();
  } catch (e) { console.error(e); showToast("削除に失敗しました"); }
});

// ===== 連続登録モード モーダル =====
const bulkBtn = document.getElementById("bulk-btn");
const bulkModal = document.getElementById("bulk-modal");
const presetListEl = document.getElementById("preset-list");
const customCharsEl = document.getElementById("custom-chars");
const targetNumEl = document.getElementById("target-num");
const bulkCancel = document.getElementById("bulk-cancel");
const bulkStart = document.getElementById("bulk-start");

function buildPresetList() {
  presetListEl.innerHTML = "";
  for (const [id, info] of Object.entries(window.PRESET_SETS || {})) {
    const id_ = `preset-${id}`;
    const wrap = document.createElement("label");
    wrap.className = "preset-item";
    const count = info.tokens ? info.tokens.length : [...(info.chars || "")].length;
    const unit = info.tokens ? "語" : "字";
    wrap.innerHTML = `
      <input type="checkbox" id="${id_}" value="${id}" />
      <span class="preset-label">${info.label}</span>
      <span class="preset-count">(${count}${unit})</span>
    `;
    presetListEl.appendChild(wrap);
  }
}

bulkBtn.addEventListener("click", () => {
  buildPresetList();
  bulkModal.style.display = "flex";
});
bulkCancel.addEventListener("click", () => { bulkModal.style.display = "none"; });
bulkModal.addEventListener("click", (e) => {
  if (e.target === bulkModal) bulkModal.style.display = "none";
});
bulkStart.addEventListener("click", () => {
  const checked = [...presetListEl.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
  const custom = customCharsEl.value.trim();
  const target = Math.max(1, parseInt(targetNumEl.value, 10) || 3);
  if (checked.length === 0 && !custom) {
    alert("プリセットを1つ以上選ぶか、カスタム文字列を入力してください。");
    return;
  }
  const qs = new URLSearchParams();
  if (checked.length) qs.set("set", checked.join(","));
  if (custom) qs.set("custom", custom);
  qs.set("target", String(target));
  location.href = `/bulk.html?${qs.toString()}`;
});

load();
