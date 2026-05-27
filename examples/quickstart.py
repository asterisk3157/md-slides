"""使い方サンプル: 全数式記号を網羅。

実行方法:
    python3 examples/quickstart.py
出力:
    out.pptx
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from handwriting_pptx import Presentation, Math


def main() -> None:
    dict_path = ROOT / "data" / "dict.json"
    out_path = ROOT / "out.pptx"

    p = Presentation(dict_path=str(dict_path))
    p.add_slide_5block(
        heading="さんぷる",
        bullets=[
            Math(r"\sum_{n=1}^\infty \frac{1}{n^2} = \frac{\pi^2}{6}"),
            Math(r"\int_0^1 f(x) dx"),
            Math(r"\sqrt[3]{x+1} = y^2"),
            Math(r"\sin\theta + \cos\theta"),
        ],
        color="#004F8B",
        brush_width_cm=0.086,
    )
    p.save(out_path)
    print(f"wrote: {out_path}  ({out_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
