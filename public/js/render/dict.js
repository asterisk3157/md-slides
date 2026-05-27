// 辞書グリフ取得 (Python handwriting_pptx/dict_loader.py の JS 版)。
// dict.json の characters を受け取り glyph(ch) を返す。

const ASCII_FULLWIDTH_FALLBACK = {
  "!": "！", "?": "？", "(": "（", ")": "）",
  ",": "、", ".": "。", ":": "：", ";": "；", "*": "＊",
  "！": "!", "？": "?", "（": "(", "）": ")",
  "、": ",", "。": ".", "＊": "*",
};

export function fallbackUnknownGlyph(ch) {
  return {
    char: ch,
    strokes: [{ points: [[0.15, 0.15], [0.85, 0.15], [0.85, 0.85], [0.15, 0.85], [0.15, 0.15]] }],
    advance: 1.0, anchors: [], coord_space: "bbox",
  };
}

export function fallbackBulletGlyph() {
  const cx = 0.5, cy = 0.5, r = 0.08, n = 16;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * i) / n;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return { char: "・", strokes: [{ points: pts }], advance: 0.5, anchors: [], coord_space: "bbox" };
}

export function createDictionary(characters) {
  characters = characters || {};

  function get(ch) {
    let vs = characters[ch];
    if (!vs || !vs.variants || vs.variants.length === 0) {
      const alt = ASCII_FULLWIDTH_FALLBACK[ch];
      if (alt) vs = characters[alt];
    }
    if (!vs || !vs.variants || vs.variants.length === 0) return null;
    return vs.variants[0];
  }

  function has(ch) {
    return get(ch) !== null;
  }

  function glyph(ch) {
    const v = get(ch);
    if (v === null) return null;
    return {
      char: ch,
      strokes: v.strokes || [],
      advance: v.advance == null ? 1.0 : v.advance,
      anchors: v.anchors || [],
      coord_space: v.coord_space || "bbox",
    };
  }

  return { get, has, glyph };
}
