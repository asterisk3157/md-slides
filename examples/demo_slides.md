---
type: handwriting-slides
styles:
  key:   { color: red, bold: true }
  note:  { color: blue }
  brand: { color: "#e8632a", bold: true }
---

# Tegaki Slides でできること

- 見出し・箇条書き・段落をそのまま記述
- **太字** と <span class="key">強調</span> <span class="note">補足</span> <span class="weak">控えめ</span>
- 色は <span class="brand">カラーコード</span> 指定も可
- インライン数式 $a^2 + b^2 = c^2$ も文中に

# 数式：基本

- べき乗・添字: $x^2$, $a_n$, $x^{n+1}$, $a_{i,j}$
- 分数: $\frac{1}{2}$, $\frac{x+1}{2y}$
- 平方根: $\sqrt{2}$, $\sqrt{x^2 + 1}$, 3乗根 $\sqrt[3]{x}$

# 数式：大型記号

- 積分: $\int_a^b f(x)\, dx$
- 総和: $\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$
- 極限: $\lim_{x \to 0} \frac{\sin x}{x} = 1$
- ベクトル: $\vec{a} + \vec{b}$

# 関数・ギリシャ・演算子

- 関数: $\sin x$, $\cos x$, $\tan x$, $\log x$, $\ln x$
- ギリシャ: $\pi$, $\theta$, $\alpha$, $\beta$, $\lambda$, $\sigma$, $\omega$
- 演算子: $\pm$, $\times$, $\div$, $\leq$, $\geq$, $\neq$, $\approx$, $\to$, $\Rightarrow$, $\infty$

# ブロック数式

- 独立行の数式は $$ で囲む

$$ f'(x) = \lim_{h \to 0} \frac{f(x+h)-f(x)}{h} $$

$$ \int_0^1 x^2\, dx = \left[ \frac{x^3}{3} \right]_0^1 = \frac{1}{3} $$

# 表

| 関数 | 導関数 |
| --- | --- |
| $x^n$ | $n x^{n-1}$ |
| $\sin x$ | $\cos x$ |
| $e^x$ | $e^x$ |

# 増減・凹凸表（カーブ矢印）

| $x$ | $\cdots$ | $-1$ | $\cdots$ | $0$ | $\cdots$ | $1$ | $\cdots$ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| $f''(x)$ | $-$ | $-$ | $-$ | $0$ | $+$ | $+$ | $+$ |
| $f'(x)$ | $+$ | $0$ | $-$ | $-$ | $-$ | $0$ | $+$ |
| $f(x)$ | $\incurvedown$ | $2$ | $\decurvedown$ | $0$ | $\decurveup$ | $-2$ | $\incurveup$ |

# 多段見出しと段落

## 小見出し（##）

行頭マークなしで段落も書けます。文章はそのまま本文として配置されます。

### さらに小さい見出し（###）

$$ e^{i\pi} + 1 = 0 $$
