# ベクトル記法対応 — ✅ 実装済み (2026-05)

> 設計メモ。`\vec{...}` は `handwriting_pptx/formula.py`
> (`_place_vector` / `_make_vec_arrow`) に実装済み。矢印の高さは `VEC_GAP` で調整可。

## ゴール

数式中で `\vec{v}` `\vec{AB}` のようなベクトル表記をサポート。
文字の上に右向き矢印 → が描かれる。

## 想定記法

| 入力 | 表示 |
|---|---|
| `\vec{v}` | v⃗ (v の上に小さな →) |
| `\vec{AB}` | AB の上に → (両文字をカバーする長さ) |
| `\vec{a+b}` | (a+b) の上に → |

## 実装イメージ

### パーサ
- `\vec` キーワードを LATEX_MAP ではなく **特別ハンドリング** で処理（`\frac` `\sqrt` と同じパターン）
- 引数 `{...}` を取り、Expr に `vec` フィールドを設定

```python
@dataclass
class Expr:
    ...
    vec: Optional[List["Expr"]] = None
```

### レイアウト
- 内容（`v`、`AB` 等）を通常通り配置 → 幅と top位置を取得
- その上に **矢印ストローク** を追加描画:
  - 水平線（文字幅と同じ長さ、または少し狭め）
  - 終端に小さな矢頭（V字 or 三角）

矢印の Y 位置: 文字 top の少し上（gap 0.05〜0.10 × font_size）

### 例: 矢印ストロークの構築

```python
def _make_vec_arrow(left_x, right_x, y_top, font_size):
    # 水平線 (文字より少し狭く)
    margin = font_size * 0.05
    line_left = left_x + margin
    line_right = right_x - margin
    # 矢頭 (右端から左下/左上に短い線)
    head_size = font_size * 0.10
    head_y_offset = font_size * 0.06
    arrow_pts = [
        (line_left, y_top),                                      # 線開始
        (line_right, y_top),                                     # 線終点 = 矢頭根元
        (line_right - head_size, y_top - head_y_offset),         # 矢頭上
        (line_right, y_top),                                     # 矢頭根元に戻る
        (line_right - head_size, y_top + head_y_offset),         # 矢頭下
    ]
    return PlacedStroke(points_cm=arrow_pts, pressures=[0.4]*5)
```

サイズ感: 矢印の太さは bar と同様 pressure 0.35-0.40。

## 関連検討

- 太字ベクトル `\mathbf{v}` 対応？（ストローク太め）
- 行列・ベクトル成分縦並び `\vector{a; b; c}` （別機能、行列の一種）
- 内積 `\vec{a} \cdot \vec{b}` のような表記

## 優先度

Phase 5 以降（基本 L1-L3 数式エンジン完成後）。技術的には ∫ オーバーライン extension と同じ仕組みで実装可能。
