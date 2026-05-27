"""Unit conversions.

PowerPoint uses EMU (English Metric Units): 914400 EMU = 1 inch = 2.54 cm.
InkML in our sample uses centimeters * 1000 (resolution=1000 per cm).

We adopt centimeters as the user-facing unit throughout the public API.
"""

EMU_PER_CM = 360000          # 914400 / 2.54
INK_UNITS_PER_CM = 1000      # InkML traceFormat resolution


def cm_to_emu(cm: float) -> int:
    return int(round(cm * EMU_PER_CM))


def cm_to_ink(cm: float) -> int:
    return int(round(cm * INK_UNITS_PER_CM))


def emu_to_cm(emu: int) -> float:
    return emu / EMU_PER_CM


# Standard slide size: 16:9, 33.867cm x 19.05cm (default PowerPoint widescreen)
DEFAULT_SLIDE_W_CM = 33.867
DEFAULT_SLIDE_H_CM = 19.05
