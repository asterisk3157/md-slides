---
name: md-slides
tagline: Markdown を打つと整ったスライドが即出る、教員向けの数学・化学対応プレゼンエディタ
category: web
status: released
url: https://md-slides.pages.dev/preview
repo: https://github.com/asterisk3157/md-slides
tech: [HTML, CSS, JavaScript, Material 3, Cloudflare Pages, wrangler]
released_at: 2026-05-28
---

## これは何
教員（STEM 中心）向けの、Markdown 一本で本物の編集可能 .pptx を出すプレゼンエディタ。
辞書登録もログインも要らない（コールドスタートゼロ）、ブラウザだけで完結。

## 主な機能
- Markdown → スライド: 見出し・箇条書き・段落・表・カラム・引用
- 数学記法: `$a^2+b^2=c^2$` `$\frac{}{}$` `$\sqrt{}$` `$\int$` `$\sum$` `$\lim$` ベクトル・添字
- 化学記法: `$\ce{H2O}$` `$\ce{CO2 + H2O -> H2CO3}$`
- 本物の編集可能 .pptx 出力（テキストボックス + 線/曲線、InkML 不使用）
- 登場アニメ（既定 ON: 左→右ワイプ、4 方向＋なしから個別指定可能）
- OS 適応フォント（Noto Sans JP / LINE Seed / UD 教科書体 / 游 / ヒラギノ / メイリオ / MS / Klee 等）

## 魅力 / こだわり
- **コールドスタートゼロ**: 辞書登録・サーバ・認証不要、URL を開いて即書ける
- **Material 3 風 UI**: フローティング書式バー・サムネフィルムストリップ・設定シート・キーボードナビ
- **教育記法の網羅**: 数学＋化学を 1 つの記法で（特に化学 `\ce{}` を独自実装）
- **本物の .pptx**: 受け取った教員が PowerPoint や Keynote でそのまま再編集できる
- **完全静的**: Cloudflare Pages の静的配信のみ、Functions も D1 も不要

## スクリーンショット
public/preview.html のフローティングツールバー＋16:9 ステージ＋フィルムストリップ
