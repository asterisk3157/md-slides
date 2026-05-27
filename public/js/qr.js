// 自己完結 QR コード生成 (byte モード / UTF-8)。外部依存なし。
// ISO/IEC 18004 準拠の標準アルゴリズム実装 (Reed-Solomon + マスク評価)。
// 用途: 不足文字の登録URL(/bulk?custom=...) を iPad で読み取らせる。

// 誤り訂正レベル: formatBits(2bit) と ECCテーブルの ordinal を保持
const ECC = {
  L: { ordinal: 0, formatBits: 1 },
  M: { ordinal: 1, formatBits: 0 },
  Q: { ordinal: 2, formatBits: 3 },
  H: { ordinal: 3, formatBits: 2 },
};

// 各版・各レベルの 1ブロックあたり ECC コード語数 [L,M,Q,H][version 0..40]
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const MIN_VER = 1, MAX_VER = 40;

function getNumRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function getNumDataCodewords(ver, eccOrdinal) {
  return Math.floor(getNumRawDataModules(ver) / 8) -
    ECC_CODEWORDS_PER_BLOCK[eccOrdinal][ver] * NUM_ERROR_CORRECTION_BLOCKS[eccOrdinal][ver];
}

function getAlignmentPatternPositions(ver) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = (ver === 32) ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [];
  for (let pos = ver * 4 + 10; result.length < numAlign - 1; pos -= step) result.unshift(pos);
  result.unshift(6);
  return result;
}

// ---- Reed-Solomon (GF(256), 原始多項式 0x11D) ----
function rsMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xFF;
}
function rsComputeDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
}
function rsComputeRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    for (let i = 0; i < divisor.length; i++) result[i] ^= rsMultiply(divisor[i], factor);
  }
  return result;
}

// ---- byte モードのデータコード語生成 ----
function utf8Bytes(str) {
  if (typeof TextEncoder !== "undefined") return Array.from(new TextEncoder().encode(str));
  // フォールバック
  const out = [];
  for (const ch of unescape(encodeURIComponent(str))) out.push(ch.charCodeAt(0));
  return out;
}

function makeBitBuffer() {
  const bits = [];
  return {
    bits,
    append(val, len) { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); },
  };
}

// version 選択 (byte モードで data が収まる最小版)
function selectVersion(numBytes, eccOrdinal) {
  for (let ver = MIN_VER; ver <= MAX_VER; ver++) {
    const capacityBits = getNumDataCodewords(ver, eccOrdinal) * 8;
    const ccBits = (ver <= 9) ? 8 : 16;       // byte モードの文字数指示子ビット
    const usedBits = 4 + ccBits + numBytes * 8; // mode(4) + count + data
    if (usedBits <= capacityBits) return ver;
  }
  return -1; // 収まらない
}

// ---- 行列構築 ----
function buildMatrix(ver, eccOrdinal, dataCodewords) {
  const size = ver * 4 + 17;
  const modules = []; const isFunction = [];
  for (let i = 0; i < size; i++) { modules.push(new Array(size).fill(false)); isFunction.push(new Array(size).fill(false)); }

  function setFunc(x, y, val) { modules[y][x] = val; isFunction[y][x] = true; }

  function drawFinder(cx, cy) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const xx = cx + dx, yy = cy + dy;
      if (xx < 0 || xx >= size || yy < 0 || yy >= size) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFunc(xx, yy, dist !== 2 && dist !== 4);
    }
  }
  function drawAlignment(cx, cy) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      setFunc(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  // 1) ファインダ + セパレータ
  drawFinder(3, 3); drawFinder(size - 4, 3); drawFinder(3, size - 4);
  // セパレータ(白)はdrawFinderの-4..4で既にfalseを置いている範囲でカバー
  // 2) タイミングパターン
  for (let i = 0; i < size; i++) {
    if (!isFunction[6][i]) setFunc(i, 6, i % 2 === 0);
    if (!isFunction[i][6]) setFunc(6, i, i % 2 === 0);
  }
  // 3) 整列パターン
  const align = getAlignmentPatternPositions(ver);
  const n = align.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
    drawAlignment(align[i], align[j]);
  }
  // 4) フォーマット/バージョン領域を関数領域として予約 (値は後で)
  reserveFormat();
  if (ver >= 7) reserveVersion();

  function reserveFormat() {
    for (let i = 0; i < 9; i++) { isFunction[i][8] = true; isFunction[8][i] = true; }
    for (let i = 0; i < 8; i++) { isFunction[8][size - 1 - i] = true; isFunction[size - 1 - i][8] = true; }
    setFunc(8, size - 8, true); // 常時暗モジュール
  }
  function reserveVersion() {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      isFunction[b][a] = true; isFunction[a][b] = true;
    }
  }

  // 5) データ + ECC をブロック分割・インターリーブ → 全コード語
  const allCodewords = addEccAndInterleave(dataCodewords, ver, eccOrdinal);

  // 6) ジグザグ配置
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let k = 0; k < 2; k++) {
        const x = right - k;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && i < allCodewords.length * 8) {
          modules[y][x] = ((allCodewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }

  // 7) マスク選択 (8パターンで最小ペナルティ)
  let bestMask = 0, minPenalty = Infinity, bestModules = null;
  for (let mask = 0; mask < 8; mask++) {
    const test = modules.map((row) => row.slice());
    applyMask(test, isFunction, mask);
    drawFormatBits(test, eccOrdinal, mask);
    const p = penaltyScore(test, size);
    if (p < minPenalty) { minPenalty = p; bestMask = mask; bestModules = test; }
  }
  // バージョン情報も最終行列へ
  if (ver >= 7) drawVersionBits(bestModules, ver, size);
  return { size, modules: bestModules };

  function addEccAndInterleave(data, ver2, ecl2) {
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl2][ver2];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl2][ver2];
    const rawCodewords = Math.floor(getNumRawDataModules(ver2) / 8);
    const numShortBlocks = numBlocks - rawCodewords % numBlocks;
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);
    const blocks = [];
    const rsDiv = rsComputeDivisor(blockEccLen);
    let off = 0;
    for (let b = 0; b < numBlocks; b++) {
      const datLen = shortBlockLen - blockEccLen + (b < numShortBlocks ? 0 : 1);
      const dat = data.slice(off, off + datLen);
      off += datLen;
      const ecc = rsComputeRemainder(dat, rsDiv);
      if (b < numShortBlocks) dat.push(0); // 短ブロックは後で詰めるための番兵
      blocks.push({ dat, ecc });
    }
    const result = [];
    // データ部インターリーブ
    const maxDat = shortBlockLen - blockEccLen + 1;
    for (let col = 0; col < maxDat; col++) {
      for (let b = 0; b < numBlocks; b++) {
        // 短ブロックの番兵(末尾)はスキップ
        if (!(col === shortBlockLen - blockEccLen && b < numShortBlocks)) {
          result.push(blocks[b].dat[col]);
        }
      }
    }
    // ECC部インターリーブ
    for (let col = 0; col < blockEccLen; col++) {
      for (let b = 0; b < numBlocks; b++) result.push(blocks[b].ecc[col]);
    }
    return result;
  }

  function applyMask(mods, isFunc, mask) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (isFunc[y][x]) continue;
      let invert = false;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = (x * y) % 2 + (x * y) % 3 === 0; break;
        case 6: invert = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
        case 7: invert = ((x + y) % 2 + (x * y) % 3) % 2 === 0; break;
      }
      if (invert) mods[y][x] = !mods[y][x];
    }
  }

  function drawFormatBits(mods, ecl2, mask) {
    const data = (ECC_ORDINAL_TO_FORMAT[ecl2] << 3) | mask;
    let rem = data;
    for (let k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let k = 0; k <= 5; k++) mods[k][8] = getBit(bits, k);
    mods[7][8] = getBit(bits, 6);
    mods[8][8] = getBit(bits, 7);
    mods[8][7] = getBit(bits, 8);
    for (let k = 9; k < 15; k++) mods[8][14 - k] = getBit(bits, k);
    for (let k = 0; k < 8; k++) mods[8][size - 1 - k] = getBit(bits, k);
    for (let k = 8; k < 15; k++) mods[size - 15 + k][8] = getBit(bits, k);
    mods[size - 8][8] = true; // 暗モジュール
  }

  function drawVersionBits(mods, ver2, sz) {
    let rem = ver2;
    for (let k = 0; k < 12; k++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const bits = (ver2 << 12) | rem;
    for (let k = 0; k < 18; k++) {
      const bit = getBit(bits, k);
      const a = sz - 11 + (k % 3), b = Math.floor(k / 3);
      mods[b][a] = bit; mods[a][b] = bit;
    }
  }
}

const ECC_ORDINAL_TO_FORMAT = [1, 0, 3, 2]; // L,M,Q,H ordinal → formatBits
function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

// ペナルティ評価 (4ルール)
function penaltyScore(mods, size) {
  let result = 0;
  const PENALTY = [3, 3, 40, 10];
  // ルール1: 行/列の連続
  for (let y = 0; y < size; y++) {
    let runColor = false, runLen = 0;
    for (let x = 0; x < size; x++) {
      if (mods[y][x] === runColor) { runLen++; if (runLen === 5) result += PENALTY[0]; else if (runLen > 5) result++; }
      else { runColor = mods[y][x]; runLen = 1; }
    }
  }
  for (let x = 0; x < size; x++) {
    let runColor = false, runLen = 0;
    for (let y = 0; y < size; y++) {
      if (mods[y][x] === runColor) { runLen++; if (runLen === 5) result += PENALTY[0]; else if (runLen > 5) result++; }
      else { runColor = mods[y][x]; runLen = 1; }
    }
  }
  // ルール2: 2x2 ブロック
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = mods[y][x];
    if (c === mods[y][x + 1] && c === mods[y + 1][x] && c === mods[y + 1][x + 1]) result += PENALTY[1];
  }
  // ルール3: ファインダ類似 1011101 + 0000
  const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
  const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
  function matches(arr, x, y, dx, dy) {
    for (let k = 0; k < arr.length; k++) {
      const xx = x + dx * k, yy = y + dy * k;
      if (xx < 0 || xx >= size || yy < 0 || yy >= size) return false;
      if (mods[yy][xx] !== arr[k]) return false;
    }
    return true;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (matches(pat1, x, y, 1, 0) || matches(pat2, x, y, 1, 0)) result += PENALTY[2];
    if (matches(pat1, x, y, 0, 1) || matches(pat2, x, y, 0, 1)) result += PENALTY[2];
  }
  // ルール4: 暗モジュール比率
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mods[y][x]) dark++;
  const total = size * size;
  const k = Math.floor((Math.abs(dark * 20 - total * 10) + total - 1) / total) - 1;
  result += k * PENALTY[3];
  return result;
}

// 公開: text → { size, modules(boolean[][], クワイエットゾーンなし) }
export function encodeQR(text, eclName = "M") {
  const ecc = ECC[eclName] || ECC.M;
  const eccOrdinal = ecc.ordinal;
  const dataBytes = utf8Bytes(text);
  const ver = selectVersion(dataBytes.length, eccOrdinal);
  if (ver < 0) throw new Error("QR: データが大きすぎます (" + dataBytes.length + " bytes)");

  // ビット列: mode(byte=0100) + count + data
  const bb = makeBitBuffer();
  bb.append(0x4, 4);
  bb.append(dataBytes.length, ver <= 9 ? 8 : 16);
  for (const b of dataBytes) bb.append(b, 8);

  const capacityBits = getNumDataCodewords(ver, eccOrdinal) * 8;
  const bits = bb.bits;
  // ターミネータ + バイト境界 + パッド
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    dataCodewords.push(b);
  }
  const padBytes = [0xEC, 0x11];
  for (let i = 0; dataCodewords.length < getNumDataCodewords(ver, eccOrdinal); i++) {
    dataCodewords.push(padBytes[i % 2]);
  }

  return buildMatrix(ver, eccOrdinal, dataCodewords);
}

// 公開: text → SVG文字列 (クワイエットゾーン4込み)
export function qrToSvg(text, opts = {}) {
  const ecl = opts.ecl || "M";
  const border = opts.border == null ? 4 : opts.border;
  const dark = opts.dark || "#000";
  const light = opts.light || "#fff";
  const { size, modules } = encodeQR(text, ecl);
  const dim = size + border * 2;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" width="100%" height="100%">`);
  parts.push(`<rect width="${dim}" height="${dim}" fill="${light}"/>`);
  parts.push(`<path fill="${dark}" d="`);
  let d = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (modules[y][x]) d += `M${x + border},${y + border}h1v1h-1z`;
  }
  parts.push(d);
  parts.push('"/></svg>');
  return parts.join("");
}
