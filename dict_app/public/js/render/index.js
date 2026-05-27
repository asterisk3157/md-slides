// JSレンダラ公開API。MD文字列 + 辞書 + テーマ → スライドSVG。
// Python (handwriting_pptx) と同一の配置ロジックを移植したもの (node検証済み)。

import { createMetrics } from "./metrics.js";
import { createDictionary } from "./dict.js";
import { createFormula } from "./formula.js";
import { createFlow } from "./flow.js";
import { parseMD } from "./mdparse.js";
import { buildStyles } from "./theme.js";
import { slideToSvg } from "./svg.js";

function mergeMetrics(base, override) {
  if (!override) return base;
  const out = JSON.parse(JSON.stringify(base));
  for (const group of ["char_metrics", "tight_adv", "formula_metrics", "anchor_nudge", "anchor_pos"]) {
    if (override[group]) out[group] = { ...(out[group] || {}), ...override[group] };
  }
  return out;
}

// metricsJson: public/metrics.json の内容
export function createRenderer(metricsJson) {
  // text/characters/theme から全スライドを描画
  function render(text, characters, theme) {
    theme = theme || {};
    const effMetrics = mergeMetrics(metricsJson, theme.metrics);
    const M = createMetrics(effMetrics);
    const F = createFormula(M);
    const { layoutFlow } = createFlow(M, F.placeFormula);
    const dict = createDictionary(characters);

    // 描画中に未登録(=□フォールバック)になった文字を収集。
    // 実際の glyph 参照を傍受するので「画面に□で出る文字」と完全一致する。
    // 「・」(行頭マーク, 専用フォールバックあり) と空白は除外。
    const missingSet = new Set();
    const origGlyph = dict.glyph;
    dict.glyph = (ch) => {
      const g = origGlyph(ch);
      // ・ も未登録なら検出する (以前は除外していたが、再登録時に「未登録なのに登録済み判定」
      // になる不具合があった。行頭マークは未登録でもフォールバック円で描かれるが、検出はする)。
      if (g === null && ch !== " " && ch !== "　") missingSet.add(ch);
      return g;
    };
    // 関数名(sin/cos/lim 等の単語グリフ)が未登録のものを収集。
    // placeFunction が dict.has(name) を呼ぶ唯一の箇所なので、ここを傍受する。
    const missingWordSet = new Set();
    const origHas = dict.has;
    dict.has = (ch) => {
      const r = origHas(ch);
      if (!r && typeof ch === "string" && ch.length > 1) missingWordSet.add(ch);
      return r;
    };

    const doc = parseMD(text);
    const styles = buildStyles(doc.meta.styles, theme.styles);
    // フォントサイズ: frontmatter の pt キー優先 → 旧 cm キー → 既定。
    // (pt 指定で「行数に依らない固定サイズ」。pt 未指定なら従来どおりで出力不変)
    const PT_TO_CM = 2.54 / 72;
    const headingSize = doc.meta.heading_pt ? doc.meta.heading_pt * PT_TO_CM : (doc.meta.heading_size_cm || 1.8);
    const bodySize = doc.meta.body_pt ? doc.meta.body_pt * PT_TO_CM : (doc.meta.bullet_size_cm || 1.0);
    const subheadingSize = doc.meta.subheading_pt ? doc.meta.subheading_pt * PT_TO_CM : bodySize * 1.12;
    const noteSize = doc.meta.note_pt ? doc.meta.note_pt * PT_TO_CM : bodySize * 0.62;
    const color = doc.meta.color || "#000000";
    const brushWidthCm = doc.meta.brush_width_cm || 0.06;

    const slides = doc.slides.map((sl) => {
      const { blocks, overflow } = layoutFlow(sl.heading, sl.content, dict, {
        headingSizeCm: headingSize, bodySizeCm: bodySize,
        subheadingSizeCm: subheadingSize, noteSizeCm: noteSize, styles,
        slideWCm: 33.867, slideHCm: 19.05,
      });
      return { blocks, overflow };
    });
    // 描画モード: text（フォント・既定の配布版）/ handwriting（インク・既存）。既定は後方互換で handwriting。
    const mode = doc.meta.mode === "text" ? "text" : "handwriting";
    const fontFamily = doc.meta.font || null;
    // color/brushWidthCm はSVG・pptx生成で共通利用
    // missingChars: 未登録文字, missingWords: 未登録の関数名(単語) (登録導線/QR用)
    return { doc, color, brushWidthCm, slideWCm: 33.867, slideHCm: 19.05, slides, mode, fontFamily, missingChars: [...missingSet], missingWords: [...missingWordSet] };
  }
  return { render };
}
