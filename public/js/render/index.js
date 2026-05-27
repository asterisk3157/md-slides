// JSレンダラ公開API。MD文字列 + 辞書 + テーマ → スライドSVG。
// Python (handwriting_pptx) と同一の配置ロジックを移植したもの (node検証済み)。

import { createMetrics } from "./metrics.js";
import { createDictionary } from "./dict.js";
import { createFormula } from "./formula.js";
import { createFlow } from "./flow.js";
import { parseMD } from "./mdparse.js";
import { buildStyles } from "./theme.js";
import { slideToSvg } from "./svg.js";
import { createTextLayout, createMeasure } from "./textlayout.js";
import { createFormulaFont } from "./formulafont.js";

// テキストモード既定フォント (フリー)。frontmatter font: で上書き。
export const DEFAULT_FONT_STACK = "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', 'Yu Gothic UI', sans-serif";
function resolveFontStack(font) {
  if (!font) return DEFAULT_FONT_STACK;
  // 単一フォント名を指定されたら、CJK/汎用フォールバックを後ろに足す
  return `'${font}', ${DEFAULT_FONT_STACK}`;
}

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
    const SLIDE_W = 33.867, SLIDE_H = 19.05;
    const doc = parseMD(text);
    const styles = buildStyles(doc.meta.styles, theme.styles);
    // フォントサイズ: frontmatter の pt キー優先 → 旧 cm キー → 既定。
    const PT_TO_CM = 2.54 / 72;
    const headingSize = doc.meta.heading_pt ? doc.meta.heading_pt * PT_TO_CM : (doc.meta.heading_size_cm || 1.8);
    const bodySize = doc.meta.body_pt ? doc.meta.body_pt * PT_TO_CM : (doc.meta.bullet_size_cm || 1.0);
    const subheadingSize = doc.meta.subheading_pt ? doc.meta.subheading_pt * PT_TO_CM : bodySize * 1.12;
    const noteSize = doc.meta.note_pt ? doc.meta.note_pt * PT_TO_CM : bodySize * 0.62;
    const color = doc.meta.color || "#000000";
    const brushWidthCm = doc.meta.brush_width_cm || 0.06;
    // 描画モード: text（フォント・既定）/ handwriting（インク・層2レガシー）。既定 = text。
    const mode = doc.meta.mode === "handwriting" ? "handwriting" : "text";
    const fontFamily = doc.meta.font || null;
    const fontStack = resolveFontStack(fontFamily);
    // アニメ: 既定 ON (左→右ワイプ)。frontmatter anim: off で無効。
    const anim = !(doc.meta.anim === "off" || doc.meta.anim === false || doc.meta.anim === "none");

    if (mode === "text") {
      // 辞書非依存のフォント配置。コールドスタートゼロ。
      const measure = createMeasure(fontStack);
      const { placeFormula } = createFormulaFont(measure);
      const TL = createTextLayout({ measure, placeFormula, styles, slideWCm: SLIDE_W, slideHCm: SLIDE_H, fontFamily: fontStack });
      const sizes = { heading: headingSize, body: bodySize, subheading: subheadingSize, note: noteSize };
      const slides = doc.slides.map((sl) => TL.layoutSlide(sl.heading, sl.content, sizes));
      return { doc, color, brushWidthCm, slideWCm: SLIDE_W, slideHCm: SLIDE_H, slides, mode, fontFamily, fontStack, anim, missingChars: [], missingWords: [] };
    }

    // --- 以下 handwriting (層2レガシー・辞書ストローク) ---
    const effMetrics = mergeMetrics(metricsJson, theme.metrics);
    const M = createMetrics(effMetrics);
    const F = createFormula(M);
    const { layoutFlow } = createFlow(M, F.placeFormula);
    const dict = createDictionary(characters);
    const missingSet = new Set();
    const origGlyph = dict.glyph;
    dict.glyph = (ch) => { const g = origGlyph(ch); if (g === null && ch !== " " && ch !== "　") missingSet.add(ch); return g; };
    const missingWordSet = new Set();
    const origHas = dict.has;
    dict.has = (ch) => { const r = origHas(ch); if (!r && typeof ch === "string" && ch.length > 1) missingWordSet.add(ch); return r; };

    const slides = doc.slides.map((sl) => {
      const { blocks, overflow } = layoutFlow(sl.heading, sl.content, dict, {
        headingSizeCm: headingSize, bodySizeCm: bodySize,
        subheadingSizeCm: subheadingSize, noteSizeCm: noteSize, styles,
        slideWCm: SLIDE_W, slideHCm: SLIDE_H,
      });
      return { blocks, overflow };
    });
    return { doc, color, brushWidthCm, slideWCm: SLIDE_W, slideHCm: SLIDE_H, slides, mode, fontFamily, fontStack, anim, missingChars: [...missingSet], missingWords: [...missingWordSet] };
  }
  return { render };
}
