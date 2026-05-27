// 配置メトリクス (Python handwriting_pptx/metrics.py の JS 版)。
// データは public/metrics.json (Python metrics.export_json() の出力) を読み込む。
// → Python と同一ルールを共有しドリフトを防ぐ。

// 小書き仮名 (見出しでも常に縮小)。Python metrics.SMALL_KANA と一致させること。
const SMALL_KANA = new Set(Array.from("ゃゅょっャュョッぁぃぅぇぉァィゥェォ"));

export function createMetrics(data) {
  const charM = data.char_metrics || {};
  const tightA = data.tight_adv || {};
  const formulaM = data.formula_metrics || {};
  const anchorN = data.anchor_nudge || {};
  const anchorP = data.anchor_pos || {};
  const fallback = data.fallback_map || {};

  function charMetrics(ch) {
    const alt = fallback[ch];
    if (alt && charM[alt]) return [charM[alt].rel_size, charM[alt].valign];
    if (charM[ch]) return [charM[ch].rel_size, charM[ch].valign];
    return [1.0, "top"];
  }

  function tightAdv(ch) {
    return Object.prototype.hasOwnProperty.call(tightA, ch) ? tightA[ch] : null;
  }

  function formulaMetrics(ch) {
    const m = formulaM[ch];
    if (m) return [m.rel_size, m.valign, (m.advance === undefined ? null : m.advance)];
    const [rs, va] = charMetrics(ch);
    return [rs, va, null];
  }

  function anchorNudge(char, type) {
    const m = anchorN[`${char}|${type}`];
    if (m) return [m.dx || 0, m.dy || 0];
    return [0, 0];
  }

  function anchorPos(char, type) {
    const m = anchorP[`${char}|${type}`];
    if (m) return [m.x || 0, m.y || 0];
    return null;
  }

  function isSmallKana(ch) {
    return SMALL_KANA.has(ch);
  }

  return { charMetrics, tightAdv, formulaMetrics, anchorNudge, anchorPos, isSmallKana };
}
