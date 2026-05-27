# √ ルート上線の自動延長 — ✅ 実装済み (2026-05)

> 設計メモ。`handwriting_pptx/formula.py` の `_place_expr` 内 √ 特殊処理に実装済み
> （最終ストロークを被開数右端まで延長、バー部 pressure を細く）。

## 目的

`√(x² + y²)` のようなルート式を生成するとき、被開数の幅に合わせて
√ の上線を自動で右に伸ばす。

## 設計

### 登録時 (現状)
- √ を登録するとき、最後のストロークを「短い上線」として書く
- ガイドの「本体 √」エリアの上端付近で水平に終わる想定
- アンカー: `body` 1個（被開数の左端）、任意で `sup`（n乗根の指数）

### 配置時 (未実装)
1. √ 本体ストロークを描く
2. **「最後のストロークの終点」を取得** (= 上線の右端)
3. 被開数 (arg) の strokes を配置時にbboxを計算
4. 被開数のbboxの右端より少し右までの距離を計算
5. **「上線終点から被開数右端+α まで」の直線をInkMLに追加**
6. これがルートの被開数を上から囲む線になる

### Python 実装スケッチ
```python
def render_root(root_glyph: Glyph, arg_block: Block, font_size: float, origin):
    # root_glyph 自体を配置
    placed_root = place_glyph(root_glyph, origin, font_size)
    # 最後のストロークの最終点を取得
    last_stroke = placed_root[-1]
    line_start = last_stroke.points_cm[-1]
    # 被開数を root の右に配置
    arg_placed = place_block(arg_block, (origin[0] + ROOT_W, origin[1]), font_size)
    arg_right = max(p[0] for s in arg_placed for p in s.points_cm)
    # 水平線を追加
    line_end = (arg_right + font_size * 0.1, line_start[1])
    placed_root.append(PlacedStroke(points_cm=[line_start, line_end]))
    return placed_root + arg_placed
```

## L1〜L4 数式組版エンジンで本格対応する際に実装する。
