# スタイル指示（3案）

`brief.md` の末尾に、下の **どれか1案** を貼って Claude Design に投げる。3案を別々に走らせて比較する。

---

## 案1: Microsoft（Fluent / Windows 11 アプリ風）
「Office / Windows 11 のネイティブアプリ」そっくりに。

- **質感**: Mica/Acrylic 風の半透明レイヤー、控えめなドロップシャドウ、角丸 8px 前後。背景は淡いグレー〜ニュートラル。
- **カラー**: アクセント＝Windows ブルー `#0067C0`〜`#005A9E`。サーフェスは白〜`#F3F3F3`。選択/ホバーは薄いアクセント塗り。
- **アプリバー**: Office リボン的ではなくモダンな **コマンドバー**（左にタイトル、右に主アクション）。`pptx ダウンロード`は塗りつぶしアクセントボタン。
- **ツールバー**: セグメント化されたコマンドバー。アイコン＋小さなラベル。トグルは Fluent のピル/トグル。
- **タイポ**: Segoe UI 系（`'Segoe UI', system-ui`）。
- **コントロール**: Fluent の TextField/Dropdown/ToggleSwitch/Slider の見た目。フォーカスリングは下線アクセント。
- **設定**: 右からスライドインする **設定パネル（フライアウト）** か歯車ボタン→ポップオーバー。
- **スライド**: 中央に大きな16:9カード、下 or 左に縦/横サムネイル（Fluent の選択枠＝アクセント細枠）。

## 案2: Google（Material Design 3 / Material You 風）
「Google スライド/Workspace の M3」そっくりに。

- **質感**: フラット＋**エレベーション（影の段階）**。角丸は大きめ（12〜28px、M3 の shape scale）。リップル感のあるボタン。
- **カラー**: M3 のトーナルパレット。プライマリ＝Google ブルー系 `#1A73E8` or M3 dynamic（primary/secondary/surface/surfaceVariant）。surface に淡い tonal tint。
- **アプリバー**: M3 **Top app bar**。主アクションは **FAB 風 or filled tonal button**（`pptx ダウンロード`）。
- **ツールバー**: M3 の **Segmented button / Icon button / Chips**。トグルは選択チップ。
- **タイポ**: Roboto / `'Google Sans', Roboto, system-ui`。Material の type scale。
- **コントロール**: Outlined TextField、Filled/Outlined ボタン、Switch、Slider（M3 の太いトラック＋ハンドル）。
- **設定**: 右の **ナビゲーションドロワー** or **bottom/side sheet**。
- **スライド**: 中央16:9カード（elevation 1〜2）、横スクロールの **サムネイルカルーセル**。選択はプライマリ枠＋tonal 背景。

## 案3: Apple（Liquid Glass / visionOS・iOS の磨りガラス風）
「Apple の最新 Liquid Glass」そっくりの、透明感あるリッチな質感に。

- **質感**: **磨りガラス（強い backdrop-blur ＋半透明白/暗）**、繊細な内側ハイライト＆境界の光沢、柔らかく大きい影、角丸大きめ（16〜24px）。レイヤーが浮いて見える。
- **カラー**: ニュートラル基調＋淡い発光アクセント（system blue `#0A84FF`）。ライト/ダーク両対応の半透明サーフェス。背景に淡いグラデ/ぼかし。
- **アプリバー**: フローティングの **ガラスツールバー**（画面端から少し浮かせ、blur で背景が透ける）。`pptx ダウンロード`は発光する filled ボタン。
- **ツールバー**: ガラスのセグメントコントロール（iOS 風）。トグルは iOS Switch。アイコンは SF Symbols 風の線画（inline SVG）。
- **タイポ**: `-apple-system, 'SF Pro', system-ui`。
- **コントロール**: 角丸の半透明フィールド、iOS セグメント、ふわっとしたフォーカス/ホバー。
- **設定**: ガラスの **ポップオーバー/シート**（端から浮かぶ）。
- **スライド**: 中央16:9カード（白く明瞭＝中身は読みやすく、周辺UIだけガラス）。サムネは下部にフローティングのガラスフィルムストリップ。

---

### 各案 共通の評価軸（比較用）
- 16:9 メイン＋サムネ навигのレイアウトが破綻なく収まるか
- ツールバー/設定の情報密度と分かりやすさ
- 「アプリらしさ」と教員が迷わない明快さ
- プレビュー（白いスライド）の視認性を周辺UIが邪魔しないか
