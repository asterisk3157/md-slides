"""handwriting_pptx — generate handwriting-animated PPTX from typed text.

Public API:
    Presentation, Slide, HandwrittenText, Image
"""
from .api import Presentation, Slide, HandwrittenText, Image, Math, Bold, Span

__all__ = ["Presentation", "Slide", "HandwrittenText", "Image", "Math", "Bold", "Span"]
__version__ = "0.1.0"
