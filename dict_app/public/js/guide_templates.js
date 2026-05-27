// 数式記号の登録ガイドテンプレート
//
// 特定の文字（∫, ∑, √, lim 等）は、後で添字や本体を配置する位置が決まっている。
// 登録時に「本体を書くエリア」と「添字が来る予定地」を灰色点線でガイド表示する。
// ユーザーはガイドの「本体エリア」に記号を書くだけ。アンカー (sub/sup/body) は
// 保存時にガイドの sup/sub/arg 領域中心から自動生成される (手動配置不要)。
//
// すべて 0..1 正規化座標 (Canvas 全体)。
// type: 'body' = 記号本体を書くエリア (矩形)、'sub' = 下添字予定地 (○)、
//       'sup' = 上添字予定地 (○)、'arg' = 引数(被積分関数等)予定地 (矩形)

window.GUIDE_TEMPLATES = {
  // 積分: 左寄りに縦長 ∫、約10度左に傾けて書く。上限は右側、下限は左寄りに。
  // body は平行四辺形 (左に約10度傾斜) でガイド表示
  // tan(10°) ≈ 0.176、高さ1相当でx方向にずらす量は約0.176
  // → top-x が bottom-x より右に 0.10 ほどずれた平行四辺形
  "∫": {
    description: "∫ 本体は約15度左に傾けて縦長に。上限は右上、下限は右下。",
    regions: [
      // 平行四辺形 (左に15度傾斜、tan(15°) ≈ 0.27)
      { kind: "body",
        points: [
          [0.35, 0.00],
          [0.60, 0.00],
          [0.33, 1.00],
          [0.08, 1.00],
        ] },
      // sup (左下) / sub (右上) を本体の 15° スラント軸に沿って配置
      // tan(15°)≈0.27 → cy差 0.5 に対し cx差 0.135
      { kind: "sup",  cx: 0.35, cy: 0.75, r: 0.07 },
      { kind: "sub",  cx: 0.50, cy: 0.25, r: 0.07 },
      // 緑(arg) は横軸方向に中央揃え (canvas y方向の中心=0.5 に矩形中央が来るよう)
      { kind: "arg",  x: 0.65, y: 0.30, w: 0.30, h: 0.40 },
    ],
  },
  // 総和: 大きなΣ、上下に範囲 (Σ自体の真上・真下)、右に総和項
  "∑": {
    description: "中央に大きく ∑ 本体を書いてください。上限=真上、下限=真下、総和項=右",
    regions: [
      { kind: "body", x: 0.15, y: 0.20, w: 0.55, h: 0.60 },
      { kind: "sup",  cx: 0.42, cy: 0.08, r: 0.08 },
      { kind: "sub",  cx: 0.42, cy: 0.92, r: 0.08 },
      { kind: "arg",  x: 0.75, y: 0.30, w: 0.25, h: 0.40 },
    ],
  },
  // ルート: √ 本体 + n乗根の指数 (本体内側・下から1/4) + 被開数 (右側、上線で囲む想定)
  // n乗根の指数 (例: ³√) は √ の左下のV字の懐に書く位置に
  // ※ 本体ストロークの最終点から右に水平線を伸ばす配置ロジックは future work
  //   (docs/future_root_extension.md 参照)
  "√": {
    description: "√ 本体は左寄り・縦中央揃え。最後のストロークが上線になります。n乗根指数=本体内の懐",
    regions: [
      { kind: "body", x: 0.08, y: 0.175, w: 0.34, h: 0.65 },
      { kind: "sup",  cx: 0.22, cy: 0.66, r: 0.06 },
      { kind: "arg",  x: 0.45, y: 0.20, w: 0.55, h: 0.55 },
    ],
  },
  // --- 関数 (単語グリフ) ---
  // sin/cos/tan/log/ln: 左に語を書き、引数=右、上付き(sin^-1)=右上、下付き(log_10)=右下。
  // 語は小文字の文字高 (canvas 中央やや下) に収める。
  "sin": _fnWordTemplate("sin"),
  "cos": _fnWordTemplate("cos"),
  "tan": _fnWordTemplate("tan"),
  "log": _fnWordTemplate("log", { sub: true }), // log_2 等の底だけ下付きあり
  "ln":  _fnWordTemplate("ln"),
  // lim だけは下付き (x→0) が「真下」に来る
  "lim": {
    description: "lim 本体を左に。下付き (x→0) は真下に来ます。引数=右。",
    regions: [
      { kind: "body", x: 0.06, y: 0.18, w: 0.50, h: 0.42 },
      { kind: "sub",  cx: 0.31, cy: 0.82, r: 0.08 },
      { kind: "arg",  x: 0.66, y: 0.18, w: 0.32, h: 0.42 },
    ],
  },
};

// 関数語 (sin/cos/...) 共通テンプレート生成
// opts.sub=true のときだけ下付き(青丸)を出す (sin/cos/tan は不要なので既定で出さない)
function _fnWordTemplate(name, opts) {
  opts = opts || {};
  const regions = [
    { kind: "body", x: 0.06, y: 0.24, w: 0.50, h: 0.40 },
    { kind: "sup",  cx: 0.60, cy: 0.18, r: 0.07 },
  ];
  if (opts.sub) regions.push({ kind: "sub", cx: 0.60, cy: 0.64, r: 0.07 });
  // 引数(緑)は本体のすぐ右に寄せる (中身を左に詰める)
  regions.push({ kind: "arg", x: 0.58, y: 0.24, w: 0.34, h: 0.40 });
  const subDesc = opts.sub ? "下付き(底)=右下、" : "";
  return {
    description: `${name} を左に等倍で書いてください。引数=すぐ右、${subDesc}上付き(逆関数)=右上。`,
    regions,
  };
}
