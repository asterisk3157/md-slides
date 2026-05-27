# md-slides — テキスト専用 md→slide アプリ

> `pptx_auto`（手書き版・恩師へ納品済み）からフォークした **テキスト専用**の md→slide アプリ。
> 手書き版は `/Users/hi/pptx_auto` に凍結保存（Cloudflare Pages で稼働中・触らない）。
> 製品名は未定（"Tegaki"=手書き なので別名にする）。

## このアプリの目的（要件は docs/requirements.md）

- **MD を打つ → 整ったスライドが出る**。手書き・辞書・登録は一切なし＝**コールドスタートゼロ**。
- 無料・教員に広く配布（STEM中心）。堀＝**教育記法（数学＋化学）× 本物の編集可能 pptx**。
- 文字は **全部フォント**（地の文も数式も化学式も）。インク/手書きは使わない。
- アニメは ON/OFF トグル、既定＝**左→右ワイプ**。

## アーキテクチャ（手書き版との最大の違い）

- **JS のみで完結**（手書き版の Python "真実" は不要）。Python↔JS byte 一致の縛りも撤廃。
- ブラウザ完結：`MD → パース → レイアウト → フォント描画 → pptx(ネイティブテキスト) ＋ プレビュー(SVG)`
- **辞書・D1・サーバ生成なし**（原則 静的配信。認証も不要＝公開可）。

```
md-slides/
├── public/
│   ├── index.html / preview.html   # ランディング / 作成(エディタ＋プレビュー)
│   ├── metrics.json / skeleton.json# レイアウト指標 / pptx静的骨格
│   └── js/
│       ├── preview.js              # エディタ＋プレビュー＋pptx (テキスト既定)
│       └── render/                 # MD→スライドのコア
│           ├── mdparse.js          # MDパーサ
│           ├── theme.js            # 色/スタイル(CSS色名・パレット)
│           ├── formula.js          # 数式パーサ parseFormula(辞書非依存)＋expandCe(化学)
│           │                         ※ストローク配置層は handwriting 専用(レガシー)
│           ├── textlayout.js  ★新  # テキスト配置(辞書非依存・canvas計測)＋縦フロー＋表
│           ├── formulafont.js ★新  # フォント数式(parseFormula流用→グリフ＋手続き線)
│           ├── svg.js              # slideItemsToSvg(描画アイテム→SVG, テキスト主経路)
│           ├── pptxtext.js   ★新   # ネイティブテキストpptx(テキストボックス/線/円/freeform)
│           ├── zip.js              # pptx zip ライター
│           └── (layout/flow/formula配置/pptxbuild/dict/qr = handwriting レガシー・未使用)
├── functions/api/{export,theme}.ts # handwriting 由来・テキストモードでは未使用(レガシー)
└── docs/requirements.md            # 要件定義

描画の中間表現 RenderItem(cm座標, y下向き):
  {t:"text",x,y(baseline),size,text,bold,color,italic}/{t:"line",x1,y1,x2,y2,w}
  {t:"poly",pts,w}/{t:"disc",cx,cy,r} → SVG(slideItemsToSvg)とpptx(pptxtext)が同形を展開。
```

## 実装状況（2026-05・「作る本体」完了）
1. ✅ 辞書非依存レイアウト（`textlayout.js`・canvas計測）
2. ✅ フォント数式（`formulafont.js`：分数/添字/√/∫∑/関数/ベクトル/カーブ矢印）
3. ✅ pptx ネイティブテキスト出力（`pptxtext.js`）
4. ✅ フォント選択（既定 Noto Sans JP・ツールバー・frontmatter `font:`）
5. ✅ 左→右ワイプ ON/OFF（既定ON・frontmatter `anim: off`）
6. ✅ 化学 `\ce{}` L1+L2（`formula.js` の `expandCe`）
- 表（罫線・増減表の二重線・カーブ矢印）も対応。
- **未検証**: pptx を実機 PowerPoint で開いた目視（ベースライン微調整・ワイプ再生）。
  生成物は整形式XML＋SVGプレビュー一致まで確認済。次は要 PowerPoint 目視。
- レガシー(handwriting)経路は `mode: handwriting` の時のみ使用。テキスト既定では未使用。

## 開発・検証
- 必ず日本語でやり取りする
- **push / 本番デプロイはユーザーの明示許可が必要**（コミットまでは可）
- ローカル検証: `public/` を静的配信（`.claude/launch.json` の "static"＝python http.server）。
  wrangler は未インストール（テキストモードは API 不要なので静的配信で足りる）。
  ※ブラウザは ES モジュールをキャッシュするので、編集が反映されない時はポート変更でバスト。
- ユーザーが自分で実行するコマンドは fenced code block（1ブロック=1コマンド）で出す
- 外部 GitHub からの DL 禁止／外部 npm は原則レジストリ経由（Webフォントは Google Fonts CDN）
