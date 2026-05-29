# 既知の不具合・改善 TODO

> バグ報告（2026-05-30 受領）を次回着手用に整理したもの。
> 各項目の「入口」は `file:line 関数名` 形式。**行番号は 2026-05-30 時点**で、コード編集後はズレるので関数名を主軸に探すこと（全項目とも実コードで挙動を確認済み）。
> 報告内の「ポップアップウィンドウ」はコード上は固定ツールバー **`fmtbar`**（選択枠の上に浮く書式バー）を指す。
>
> **進捗 (2026-05-30):** A-1・A-2・A-3 は実装＆ローカル検証済み（commit f8d8356, 9040302）。残りは B-1・B-2（要 Windows 実機）。

## 関連ファイル地図

| 機能 | ファイル |
|---|---|
| 編集 UI（選択・ダブルクリック・fmtbar・サイズ変更） | `public/js/preview.js` |
| テキスト配置・canvas 計測 | `public/js/render/textlayout.js` |
| フォントスタック解決・描画への伝播 | `public/js/render/index.js` |
| SVG 描画（font-family 属性） | `public/js/render/svg.js` |
| pptx 出力（typeface） | `public/js/render/pptxtext.js` |
| frontmatter パース | `public/js/render/mdparse.js` |
| フォント UI・CDN link | `public/preview.html` |

---

## A. ダブルクリック編集 UI（書式バー fmtbar）

### A-1. ダブルクリックで複数選択できるようにすべき（要望）— ✅ 2026-05-30 実装済 (9040302)

> 文字(文字編集モード)・ブロックの複数選択を実装。Cmd/Ctrl+クリック=トグル追加、Shift+クリック=範囲。`selList` 集合を導入し、サイズ・色・フォント・太字・アニメを一括適用。`fmtbar` に「N個を選択」表示。修飾キー押下時はドラッグ移動せず選択操作のみ（移動中の Shift グリッド吸着と非競合）。


- **症状**: 1 要素しか選択・編集できない。複数まとめて書式変更したい。
- **入口**:
  - `preview.js:23` `let charMode = null;`（`{ slide, block }` 単数を保持）
  - `preview.js:298` `enterCharMode(slide, block, g)` … `charMode = { slide, block }` で常に上書き（301）
  - `preview.js:351` ダブルタップ判定（`lastTap` 自前判定）→ 単一 block で `enterCharMode`
  - `preview.js:472` `drawSelection()` … `selected` 単数前提で選択枠を 1 個だけ描く
- **現状の仕組み**: `selected` / `charMode` がどちらも単一 `{slide, block, el}`。複数選択の概念なし。
- **修正の当たり**: `selected` を配列化（or `selectedSet`）。`onSvgPointerDown` で Ctrl/Cmd 押下時に追加選択。`drawSelection` を全選択分ループして枠描画。`changeSize`/色/太字/フォント変更を選択集合全体に適用。fmtbar のアンカーは選択集合の bbox にする。**影響範囲が広い**（選択状態を扱う全関数）。
- **優先度メモ**: 中（要望。設計変更が大きいので A-2/A-3 より後でよい）。

### A-2. 文字を小さくすると fmtbar が縮小に追従して移動する（バグ）— ✅ 2026-05-30 修正済 (f8d8356)

- **症状**: ダブルクリック後にフォントサイズを下げると、書式バーがズレて動く。
- **入口**:
  - `preview.js:497-513` `drawSelection()` … 選択枠 `rect` を `override.s`（サイズ倍率）込みの cm 座標から計算（`w,h = |corners 差| * PX`）し、`showFmtbar(rect)` に**その縮んだ rect を渡す**。
  - `preview.js:447` `positionFmtbar(anchorEl)` … `anchorEl.getBoundingClientRect()` の `r.left + r.width/2`（中央）, `r.top`（上端）でバー位置を決定。
  - `preview.js:611` `changeSize(deltaPt)` → `persist(); update();` で毎回 `drawSelection()` が再実行され、縮んだ rect で再配置される。
- **現状の仕組み**: バーのアンカー＝「選択枠 SVG 矩形そのもの」。文字を縮める→`ov.s` 減→選択枠が縮む→`getBoundingClientRect` の中心/上端が動く→バーが追従。
- **修正の当たり**: アンカーを「現在の選択枠サイズ」から切り離す。案: (a) `positionFmtbar` に rect 要素ではなく**固定基準点**（ブロックの元位置 `blk.x_cm,y_cm` を画面座標化した点、`ov.s` 非依存）を渡す。(b) サイズ変更中はアンカーの中心 X・上端 Y をキャプチャして固定。`showFmtbar(rect)`(513) の引数を見直すのが起点。
- **優先度メモ**: 中〜高（UX で目立つ。修正は局所的）。

### A-3. フォントサイズが ±2 刻みでしか調整できない（仕様改善）— ✅ 2026-05-30 修正済 (f8d8356)

- **症状**: サイズ調整が ±2 単位固定（報告は「±2px」だが、内部実装は **pt 刻み**＝`changeSize(deltaPt)` の `deltaPt`）。
- **入口**:
  - `preview.js:735-736` `$("fmtSizeUp").addEventListener("click", () => changeSize(2));` / `changeSize(-2)` … **±2 がハードコード**。
  - `preview.js:611` `changeSize(deltaPt)` 関数自体は任意 delta 対応（`ov.s = max(6, curEff + deltaPt)/basePt`、最小 6pt）。
- **現状の仕組み**: 関数は汎用だが呼び出しが ±2 固定。刻みを変える UI なし。
- **修正の当たり**: (a) 定数 `SIZE_STEP` 化して 1pt 等に。(b) 数値入力フィールドを fmtbar に追加し直接 pt 指定。(c) Shift で粗く/Alt で細かく等の修飾キー対応。最小工数は (a)。
- **優先度メモ**: 低〜中（修正は容易。まず刻みを 1 にするだけでも改善）。

---

## B. フォント反映

> 伝播フロー: frontmatter `font:` → `mdparse` `meta.font` → `index.js` `resolveFontStack()` → ① canvas 計測 `textlayout.createMeasure` ② SVG `svg.itemToSvg` ③ pptx `pptxtext.textSp`。①②③でフォント指定の渡し方が異なるのが不具合の温床。

### B-1. デジタル教科書体が Windows で反映されない／各種フォントが出たり出なかったり（バグ）

- **症状**: 「UD 教科書体」等が Windows で効かない。フォントが安定しない。配布先（教員）に Windows 多 → **影響大**。
- **入口**:
  - `preview.html:9` Google Fonts `<link>` … 読み込むのは Roboto / Noto Sans JP / Noto Serif JP / M PLUS Rounded 1c / **BIZ UDPGothic** / Klee One / LINE Seed JP。**「UD デジタル教科書体 N-R」は無い**（非フリー＝CDN に無く Windows 同梱のみ）。
  - `preview.html:521,610` フォント選択肢 `value="UD デジタル教科書体 N-R, BIZ UDPGothic"`（612 のコメント「Windows 搭載・他は BIZ UDPGothic」）。
  - `index.js:15` `DEFAULT_FONT_STACK = "'Noto Sans JP','Hiragino Sans','Yu Gothic','Yu Gothic UI',sans-serif"`、`index.js:16` `resolveFontStack()` がユーザー指定＋デフォルトを連結。
  - `textlayout.js:32` `createMeasure(fontFamily)` → `:38` `ctx.font = \`...px ${fam}\`` で **フォントスタック全体**を canvas に渡す。
  - `svg.js`（`itemToSvg`）は `font-family` にスタック全体（ブラウザが順にフォールバック＝比較的安全）。
  - `pptxtext.js`（`textSp`）は `split(",")[0]` で **スタック先頭 1 つだけ**を `<a:latin>/<a:ea> typeface` に採用。
- **想定原因**: 
  1. canvas `ctx.font` にスタック全体を渡すと、未知フォントを含む指定をブラウザが無効化しデフォルト計測に落ちる環境がある（Windows 疑い）→ **計測幅と実際の描画フォントがズレる**。
  2. UD 教科書体は CDN 非搭載なので、未同梱環境では BIZ UDPGothic/Noto にフォールバック（出る/出ないのバラつき）。
  3. pptx は先頭 1 フォントのみ＝未搭載環境の PowerPoint で代替が効かない。
- **修正の当たり**: 
  - `createMeasure` で計測時は**スタック先頭（実フォント名）を抽出**して `ctx.font` に渡す（svg/pptx の解釈と揃える）。`document.fonts.check()` で可用性判定して計測フォントを選ぶのも可。
  - UD 教科書体は「Windows 同梱・他環境は BIZ UDPGothic にフォールバック」を仕様として明記（CDN 追加は不可）。
  - **要 Windows 実機検証**。
- **優先度メモ**: 高（配布先環境で破綻＝堀の「本物の編集可能 pptx」に直結）。

### B-2. frontmatter `font:` のカスタム指定が不安定・未検証（要望／要検証）

- **症状**: md に `font:` を書いて任意フォント指定。CLAUDE.md 記載「一部実装・動作不安定・未確認」。
- **入口**:
  - `mdparse.js:127` 付近 `parseFrontmatter()` … `val.replace(/^["']|["']$/g,"")` で前後引用符のみ除去（`font: "A, B"` だと分割後に引用符残りの恐れ。後段 `trim` 追加が無難）。
  - `index.js:51-52` `const fontFamily = doc.meta.font || null; const fontStack = resolveFontStack(fontFamily);`（**グローバル指定は実装済み**）。
  - `preview.js:933-945` 設定シート `setDefaultFont` → `setFrontmatterKey(...,"font",v)`。
  - `preview.js:743-755` `fontSel` change … ブロック/要素 override に `t.font` 保存（**ブロック単位 override も実装済み**）。
- **現状の仕組み**: グローバル `font:` もブロック単位 override も書き戻しは動く。**ただし override.font は SVG/pptx 描画にしか効かず、canvas 計測（`createMeasure` は `fontStack` グローバル固定）には反映されない** → フォント差で字幅が変わると配置がズレる（既知の設計制限）。
- **修正の当たり**: 計測を override.font 込みで行えるようにする（ブロック/要素ごとに measure のフォントを切替）。引用符 trim の小修正。最後に **PowerPoint 実機でネイティブ編集・字幅崩れを目視**。
- **優先度メモ**: 中〜高（「本物の編集可能 pptx ×教育記法」の堀。B-1 の計測修正と一緒に直すと効率的）。

---

## C. 横断的な検証タスク（既存・未検証）

- **pptx を実機 PowerPoint で目視**（ベースライン微調整・ワイプ再生・字幅崩れ）。生成物は整形式 XML＋SVG プレビュー一致までは確認済み。
- **Windows 実機でのフォント描画確認**（B-1/B-2 の前提）。
- 検証環境が Mac のみだと B 系は再現困難。Windows 実機 or VM が要る。
