// 連続登録モードのプリセット文字セット
// index.html (モーダル) と bulk.html (本体) の両方から使う

window.PRESET_SETS = {
  hiragana_basic:   { label: "ひらがな46字",            chars: "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん" },
  hiragana_dakuon:  { label: "濁点・半濁点・拗音",      chars: "がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽゃゅょっ" },
  katakana_basic:   { label: "カタカナ46字",            chars: "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン" },
  digits:           { label: "数字 0-9",                chars: "0123456789" },
  alpha_lower:      { label: "英小文字",                chars: "abcdefghijklmnopqrstuvwxyz" },
  alpha_upper:      { label: "英大文字",                chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ" },
  math_basic:       { label: "数学記号 基本",           chars: "+-×÷=()[]{}.,<>≦≧≠≈±∞" },
  math_greek:       { label: "数学記号 ギリシャ",        chars: "√∫∑πθαβγλμσφω" },
  math_arrows:      { label: "矢印 (増減表など)",        chars: "→←↗↘↖↙⇒⇔" },
  math_misc:        { label: "省略記号・範囲など",        chars: "⋯…∞〜≡∝" },
  math_proof:       { label: "論理・証明 (∴∵□)",          chars: "∴∵□∎" },
  punctuation:      { label: "句読点・記号",            chars: "・「」、。！？" },
  // 関数: 単語グリフ (1文字ずつではなく "sin" 等を1つの手書きグリフとして登録)
  functions:        { label: "関数 (sin/cos/lim 等)",   tokens: ["sin", "cos", "tan", "log", "ln", "lim"] },
};
