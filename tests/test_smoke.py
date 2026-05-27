"""スモークテスト。

1. ライブラリで pptx 生成成功
2. 生成された pptx を zipfile で開き、必要なパートが存在
3. lxml で各 XML が well-formed
4. お手本と同じ名前空間が出力 XML に含まれる
"""
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

# tests/ を実行ディレクトリに依存せずパッケージ解決可能にする
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from lxml import etree

from handwriting_pptx import Presentation


DUMMY_DICT = ROOT / "tests" / "dummy_dict.json"


EXPECTED_NAMESPACES = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "p14": "http://schemas.microsoft.com/office/powerpoint/2010/main",
}

INKML_NS = "http://www.w3.org/2003/InkML"


class SmokeTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="hw_pptx_test_")
        self.out = Path(self.tmpdir) / "out.pptx"

    def tearDown(self):
        import shutil

        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_generate_and_validate(self):
        # 1. 生成
        p = Presentation(dict_path=str(DUMMY_DICT))
        p.add_slide_5block(
            heading="アイウエオ",
            bullets=["ア", "イ a1", "ウ b2", "エオ"],
            color="#004F8B",
            brush_width_cm=0.086,
        )
        p.save(self.out)
        self.assertTrue(self.out.exists(), "pptx ファイルが生成されていない")
        self.assertGreater(self.out.stat().st_size, 1000, "pptx が小さすぎる")

        # 2. zip 中身チェック
        with zipfile.ZipFile(self.out, "r") as z:
            names = set(z.namelist())
            self.assertIn("ppt/slides/slide1.xml", names)
            self.assertIn("[Content_Types].xml", names)
            self.assertIn("_rels/.rels", names)
            self.assertIn("ppt/slides/_rels/slide1.xml.rels", names)
            self.assertIn("ppt/presentation.xml", names)
            self.assertIn("ppt/_rels/presentation.xml.rels", names)
            self.assertIn("ppt/slideMasters/slideMaster1.xml", names)
            self.assertIn("ppt/slideLayouts/slideLayout1.xml", names)
            self.assertIn("ppt/theme/theme1.xml", names)
            ink_files = sorted(n for n in names if n.startswith("ppt/ink/"))
            self.assertGreaterEqual(len(ink_files), 5, "5ブロック分の ink* がない")

            # 3. 全 XML が well-formed
            for n in names:
                if not n.endswith(".xml") and not n.endswith(".rels"):
                    continue
                data = z.read(n)
                # well-formed check
                try:
                    etree.fromstring(data)
                except etree.XMLSyntaxError as e:
                    self.fail(f"{n} not well-formed: {e}")

            # 4. slide1.xml の名前空間チェック
            # mc/p14 は AlternateContent 内で局所宣言する方式なので、
            # XML全体に文字列として現れることだけ確認する（お手本もこの方式）。
            slide_xml = z.read("ppt/slides/slide1.xml")
            root = etree.fromstring(slide_xml)
            ns_uris = set(root.nsmap.values())
            for k, uri in EXPECTED_NAMESPACES.items():
                if k in ("p", "a", "r"):
                    self.assertIn(uri, ns_uris, f"slide1.xml の root に名前空間 {k}={uri} がない")
                else:
                    self.assertIn(uri.encode(), slide_xml,
                                  f"slide1.xml のどこにも名前空間 {k}={uri} が現れない")

            # contentPart + timing 確認
            self.assertIn(b"<p:contentPart", slide_xml)
            self.assertIn(b"<p:timing", slide_xml)
            self.assertIn(b"presetID=\"63\"", slide_xml)
            self.assertIn(b"drawProgress", slide_xml)

            # ink1.xml は InkML
            ink1 = z.read("ppt/ink/ink1.xml")
            ink_root = etree.fromstring(ink1)
            self.assertEqual(ink_root.tag, f"{{{INKML_NS}}}ink")
            self.assertIn(b"<inkml:trace", ink1)


if __name__ == "__main__":
    unittest.main()
