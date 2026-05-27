# 数学関数記法対応 (高校範囲) — ✅ 実装済み（iPad実機テスト待ち）

> 2系統で動作:
> 1. **文字合成** (フォールバック): `\sin` を s/i/n の単一文字グリフで合成
>    (`formula.py:_place_function`)。`\lim` 下添字・`\log_{10}`・`\sin^{-1}` 対応。
> 2. **単語グリフ** (推奨): "sin" 等を ∑ 同様 canvas+anchor の単一手書きグリフとして登録。
>    `_place_function` は「`name` が辞書登録済みなら単語グリフを使う」分岐済み。
>
> 単語グリフ登録の配線 (B, 完了):
> - `decodeCharParam` 多文字キー対応: コードポイント '-' 連結 ("73-69-6e"→"sin")
>   (`variants.ts` / `variants/[id].ts`)
> - `pathEncodeChar` (stroke_pad.js) 全コードポイント '-' 連結に拡張
> - `guide_templates.js` に sin/cos/tan/log/ln (右に引数/上下添字) と lim (下添字は真下)
> - `presets.js` に「関数」プリセット (`tokens: [...]`)、`missing.ts` に `words` パラメータ
> - bulk.js: 単語トークンを 1文字と分離してクエリ送信、index.js: 件数表示を語/字で出し分け
>
> 単体検証済み (encode/decode 往復、formula が登録済み単語グリフを優先描画)。
> **未検証**: iPad 実機での手書き登録フロー (wrangler + 実機が必要)。

## ゴール

`lim` `log` `sin` `cos` `tan` などの **複数文字からなる関数名** を、
1つの「単位」として組版する。具体的には:

- 関数名は **斜体ではなく直立体** で表示（手書きの場合、特に気にしないが視覚的に統一）
- 関数名の後ろに添字や引数を自然に並べる
- `lim` には特殊な下添字 (`x → 0`) サポート

## 想定記法とサンプル

| 入力 | 表示 |
|---|---|
| `\sin x` | sin x |
| `\sin^{-1} x` または `\arcsin x` | sin⁻¹ x  / arcsin x |
| `\sin(\theta + \pi)` | sin(θ + π) — 引数の `(θ+π)` も縮小ロジック適用 |
| `\cos^2 x` | cos² x (cos に上付き 2) |
| `\tan \theta` | tan θ |
| `\log x` `\log_{10} x` | log x  / log₁₀ x (下付き) |
| `\ln x` | ln x |
| `\lim_{x \to 0} f(x)` | lim (下に x→0) f(x) |
| `\exp(x)` | exp(x) |
| `e^x` | 通常の上付き処理 (既存対応済み) |

## 実装方針

### 1. LATEX_MAP で「合字」を1つの atom にする
通常 `\name` は LATEX_MAP で**1文字シンボル**に変換するが、`sin` `cos` `lim` などは
**3文字の合字** として扱いたい。

オプション A: 個別グリフを登録（ユーザーが `s` `i` `n` をまとめて手書き登録）
オプション B: 配置時に複数文字を **1つの atom 扱い** （advance を 3文字分にまとめる）

→ **B が現実的**: 既存の "s" "i" "n" のグリフを使い、関数名として並べる。位置・サイズは関数名フラグで制御。

### 2. パーサ拡張
```python
FUNCTION_NAMES = {"sin", "cos", "tan", "log", "ln", "lim", "exp",
                  "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh"}

# パース中、\name が FUNCTION_NAMES なら Expr(base="", fn_name=name, children=[char1, char2, ...])
```

### 3. レイアウト
- 関数名の各文字を**詰めて配置**（advance を字幅にぴったり、余白なし）
- 関数名直後に**自動で小さな空白** (`0.1 * font_size`)
- 引数が `(...)` の場合は **既存の関数引数縮小ロジック** が発動

### 4. `lim_{x \to 0}` の特殊配置
`\lim` は下添字 (`_`) を **中央の真下** に大きめに配置（通常の sub より大きく）。

```python
# lim 特殊扱い
if e.base == "" and e.fn_name == "lim" and e.sub:
    # sub を lim の真下に、サイズ 0.5x で中央揃え
    ...
```

### 5. `\to` `\rightarrow` の対応
`\lim_{x \to 0}` の `\to` は → 記号として表示。LATEX_MAP に追加:
```python
"to": "→",
"rightarrow": "→",
"leftarrow": "←",
"Rightarrow": "⇒",
"Leftrightarrow": "⇔",
```

ユーザーは事前に `→` を辞書登録する必要あり。

## 必要な追加辞書登録

ユーザーに登録してもらう文字（高校範囲）：
- 矢印: `→` `←` `⇒` `⇔`
- ギリシャ大文字 (必要に応じて): `Δ` `Σ` `Π` `Ω`
- 他: 既存の ASCII a-z, 数字 でカバー可能

## 関連: 三角関数とベクトルの組み合わせ

`\sin(\vec{a} \cdot \vec{b})` のような複合表記。
ベクトル機能 (`docs/future_vectors.md`) と組み合わせると自然に対応可能。

## 優先度

- **Phase 5 (関数名対応)**: \sin \cos \tan \log \ln \exp ← 数式組版エンジン強化
- **Phase 5.1 (lim 特殊)**: 下添字の特殊配置
- **Phase 5.2 (逆関数)**: \arcsin etc または `\sin^{-1}` パース

## 実装規模

- パーサ拡張: ~30 行
- レイアウト関数名処理: ~50 行
- lim 特殊配置: ~30 行
- テスト: ~50 行

合計 ~150 行、1セッションで実装可能。
