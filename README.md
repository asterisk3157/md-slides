# md-slides

🔗 **公開URL**: <https://md-slides.pages.dev/preview>

> Markdown を打つと、整ったスライドがすぐ出る — テキスト専用・ブラウザ完結・
> 編集可能な PowerPoint ファイル (.pptx) を出力する Web アプリ。

教育現場（STEM 中心）での利用を想定し、**コールドスタートゼロ**（辞書登録・
ログイン・サーバ生成不要）で立ち上がります。文字はすべてフォント描画で、
ネイティブテキストとして pptx に書き出されるため、PowerPoint や Keynote で
そのまま再編集できます。

## 特徴

- **MD → スライド**: 見出し・箇条書き・段落・表・カラム・引用などを記法で表現
- **教育記法**:
  - 数学: `$a^2 + b^2 = c^2$`, `$\frac{1}{2}$`, `$\sqrt{2}$`, `$\int$`, `$\lim$`, `$\sum$`, ベクトル・添字・カーブ矢印
  - 化学: `$\ce{H2O}$`, `$\ce{CO2 + H2O -> H2CO3}$`
- **本物の編集可能 .pptx**: テキストボックス／線／曲線として書き出し（InkML 不使用）
- **登場アニメ**: 既定 ON（左→右ワイプ）。frontmatter `anim: off` で無効化、
  個別ブロックは 4 方向＋なしから選択可能
- **フォント**: Noto Sans JP / LINE Seed Sans JP / UD 教科書体 / 游 / ヒラギノ / メイリオ /
  MS ゴシック / Klee One ほか。frontmatter `font:` で全体既定、ツールバーで要素別上書き
- **ブラウザ完結**: 静的配信のみで動作（辞書 / D1 / サーバ生成は不要）

## 利用方法

1. このリポジトリの `public/` を任意の静的ホスティング（Cloudflare Pages、
   GitHub Pages、Netlify、`python3 -m http.server` 等）で配信
2. ブラウザで `preview.html` を開く
3. 左ペインに Markdown を書き、右ペインのプレビューを確認
4. 右上の「.pptx をダウンロード」で編集可能な PowerPoint ファイルとして保存

### ローカル動作確認

```bash
python3 -m http.server 8888 --directory public
```

`http://localhost:8888/preview.html` を開きます。

## 記法

`docs/md_spec.md` に記法仕様、`docs/requirements.md` に要件定義をまとめています。

## アーキテクチャ

```
public/
├── index.html / preview.html      # ランディング / 作成 (エディタ＋プレビュー)
├── metrics.json / skeleton.json   # レイアウト指標 / pptx 静的骨格
└── js/
    ├── preview.js                 # エディタ＋プレビュー＋pptx 出力
    └── render/                    # MD → スライドのコア
        ├── mdparse.js             # MD パーサ
        ├── theme.js               # 色・スタイル
        ├── formula.js             # 数式パーサ＋化学 \ce{} 展開
        ├── textlayout.js          # 辞書非依存テキスト配置（canvas 計測）
        ├── formulafont.js         # フォント数式（グリフ＋手続き線）
        ├── svg.js                 # RenderItem → SVG プレビュー
        ├── pptxtext.js            # RenderItem → ネイティブテキスト pptx
        └── zip.js                 # pptx zip ライター
```

## ライセンス

本リポジトリのコードは **MIT License** で公開しています ([LICENSE](LICENSE))。

### サードパーティ

詳細は [NOTICE](NOTICE) を参照してください。

- **Web フォント** は Google Fonts CDN 経由で取得しています（Roboto, Noto Sans JP,
  LINE Seed Sans JP, M PLUS Rounded 1c, BIZ UDPGothic, Klee One 等。
  Apache 2.0 / SIL Open Font License 1.1）。
- **OS バンドルフォント** (游ゴシック, ヒラギノ, メイリオ, UD デジタル教科書体 等)
  は `font-family` 名のみ参照しており、フォントファイルは同梱していません。
- **UI アイコン** には Material Symbols / Material Design Icons (Apache 2.0,
  Google) を参考にした SVG 図形を含みます。

## 開発の前提

- 必ず日本語でやり取りすること
- `git push` / 本番デプロイはオーナーの明示許可が必要
- 外部 GitHub からのコードダウンロードは禁止、外部 npm は原則レジストリ経由
- 静的配信で動作するため API 不要（Cloudflare Pages の `wrangler` は devDep のみ）
