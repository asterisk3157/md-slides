"""関数記法・ベクトル記法など formula.py の拡張機能テスト。

スモークテスト (test_smoke.py) を壊さずに、parse_formula と place_formula
の高度なパターンを検証する。
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from handwriting_pptx.dict_loader import Dictionary
from handwriting_pptx.formula import (
    FUNCTION_NAMES,
    LATEX_MAP,
    Expr,
    parse_formula,
    place_formula,
)


DUMMY_DICT = ROOT / "tests" / "dummy_dict.json"


class ParseFunctionTest(unittest.TestCase):
    def test_sin_x_parsed_as_function_atom(self):
        """\\sin x が fn_name='sin' の 1 atom + 'x' の 2 要素になる。"""
        exprs = parse_formula(r"\sin x")
        # 末尾は 'x' atom, 先頭は sin 関数
        # 途中に空白 atom が入りうる
        non_space = [e for e in exprs if e.base != " " or e.fn_name or e.vec]
        self.assertGreaterEqual(len(non_space), 2)
        self.assertEqual(non_space[0].fn_name, "sin")
        self.assertEqual(non_space[0].base, "")
        # 'x' が含まれる
        bases = [e.base for e in non_space]
        self.assertIn("x", bases)

    def test_lim_with_subscript(self):
        """\\lim_{x \\to 0} f(x) が fn_name='lim' + sub に [x,→,0] を持つ。"""
        exprs = parse_formula(r"\lim_{x \to 0} f(x)")
        # 最初の non-space atom が lim
        first = exprs[0]
        self.assertEqual(first.fn_name, "lim")
        self.assertIsNotNone(first.sub)
        sub_bases = [e.base for e in first.sub]
        self.assertIn("x", sub_bases)
        self.assertIn("→", sub_bases)
        self.assertIn("0", sub_bases)
        # f, (, x, ) も後続にある
        bases = [e.base for e in exprs]
        self.assertIn("f", bases)
        self.assertIn("(", bases)
        self.assertIn(")", bases)

    def test_function_names_set_complete(self):
        """仕様で要求される関数名がすべて含まれる。"""
        required = {"sin", "cos", "tan", "log", "ln", "exp", "lim",
                    "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh"}
        self.assertTrue(required.issubset(FUNCTION_NAMES))

    def test_to_arrow_in_latex_map(self):
        """\\to / \\rightarrow 等が LATEX_MAP にある。"""
        for name in ("to", "rightarrow", "leftarrow", "Rightarrow",
                     "Leftrightarrow", "cdot"):
            self.assertIn(name, LATEX_MAP, f"{name} が LATEX_MAP に無い")

    def test_sin_pow_minus1(self):
        """\\sin^{-1} x で sin atom が sup を持つ。"""
        exprs = parse_formula(r"\sin^{-1} x")
        first = exprs[0]
        self.assertEqual(first.fn_name, "sin")
        self.assertIsNotNone(first.sup)
        sup_bases = [e.base for e in first.sup]
        self.assertIn("-", sup_bases)
        self.assertIn("1", sup_bases)


class ParseVectorTest(unittest.TestCase):
    def test_vec_single_letter(self):
        """\\vec{v} が vec=[v] を持つ Expr になる。"""
        exprs = parse_formula(r"\vec{v}")
        self.assertEqual(len(exprs), 1)
        self.assertIsNotNone(exprs[0].vec)
        self.assertEqual(len(exprs[0].vec), 1)
        self.assertEqual(exprs[0].vec[0].base, "v")

    def test_vec_AB(self):
        """\\vec{AB} が vec=[A, B] を持つ。"""
        exprs = parse_formula(r"\vec{AB}")
        self.assertEqual(len(exprs), 1)
        self.assertIsNotNone(exprs[0].vec)
        bases = [e.base for e in exprs[0].vec]
        self.assertEqual(bases, ["A", "B"])


class PlaceFormulaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dictionary = Dictionary.from_path(str(DUMMY_DICT))

    def test_place_sin_paren(self):
        """\\sin(x+1) を配置してエラーが出ないこと。"""
        placed, width = place_formula(r"\sin(x+1)", 0.0, 0.0, 1.0, self.dictionary)
        self.assertGreater(width, 0.0)
        # ストロークが少なくとも 1 つ出る (dummy dict でも fallback あり)
        self.assertGreater(len(placed), 0)

    def test_place_lim(self):
        """\\lim_{x \\to 0} f(x) を配置してエラーが出ないこと。"""
        placed, width = place_formula(
            r"\lim_{x \to 0} f(x)", 0.0, 0.0, 1.0, self.dictionary
        )
        self.assertGreater(width, 0.0)

    def test_place_vec(self):
        """\\vec{AB} を配置してエラーが出ないこと。矢印ストロークが追加される。"""
        placed, width = place_formula(r"\vec{AB}", 0.0, 0.0, 1.0, self.dictionary)
        self.assertGreater(width, 0.0)
        # 中身の AB + 矢印 1 本 = strokes >= 1
        self.assertGreater(len(placed), 0)
        # 最後のストロークは矢印 (5 点) のはず
        arrow = placed[-1]
        self.assertEqual(len(arrow.points_cm), 5)

    def test_place_sin_theta_plus_cos_theta(self):
        """\\sin\\theta + \\cos\\theta が正常配置。"""
        placed, width = place_formula(
            r"\sin\theta + \cos\theta", 0.0, 0.0, 1.0, self.dictionary
        )
        self.assertGreater(width, 0.0)


if __name__ == "__main__":
    unittest.main()
