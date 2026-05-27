# Claude Design 用一式

3つのUI候補（Microsoft / Material / Liquid Glass）を Claude Design で並行生成して比較するための素材。

## 使い方
各案について、次を Claude Design に貼る：
1. `brief.md` 全文（共通仕様・DOM契約・レイアウト目標・成果物形式）
2. `styles.md` の中の **該当する1案** のセクション
3. （任意）お手本として現行の実物 `../public/preview.html` と `../public/styles.css` を添付
   → 「これを再スタイルして」と伝えると、現状のコントロールと差分が伝わりやすい。

3案ぶん（brief + 案1 / brief + 案2 / brief + 案3）を別セッションで走らせる。

## 出してもらう成果物
- 単一の自己完結 HTML（インラインCSS可）で「作成」ページUI。
- `brief.md` の必須 id を保持（JS結線は開発側で行う）。
- 16:9 メインプレビュー＋サムネ、設定パネル、控えめな編集ヒント を含む。

## 戻ってきたら
良かった/選ばれた案を共有 → 開発側で必須 id に結線しつつアプリへ統合する。
