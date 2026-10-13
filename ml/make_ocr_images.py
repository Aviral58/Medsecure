"""Render synthetic documents as pictures, to test reading photos and scans (OCR).

Takes documents whose true contents are known (data/extraction.jsonl) and
draws each one twice:

    scan   a clean, straight page, like a flatbed scan or a screenshot
    photo  the same page as a phone picture: tilted, slightly out of focus,
           unevenly lit and saved as a compressed JPEG

A manifest.jsonl next to the images records what each picture really says, so
backend/test/ocr-eval.mjs can measure how much of it the system reads back.

Needs:  pip install playwright && playwright install chromium
Run:    python make_ocr_images.py [output folder] [documents per layout]
"""

import html
import json
import random
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "data" / "ocr_images"
PER_LAYOUT = int(sys.argv[2]) if len(sys.argv) > 2 else 6
RNG = random.Random(21)

FONTS = ["Liberation Sans, Arial, sans-serif", "DejaVu Sans, Verdana, sans-serif", "DejaVu Serif, Georgia, serif",
         "Liberation Serif, 'Times New Roman', serif", "Carlito, Calibri, sans-serif", "Liberation Mono, 'Courier New', monospace"]

PAGE = """<style>
body {{ margin: 0; background: {desk}; }}
.sheet {{ width: 1040px; box-sizing: border-box; padding: 56px 64px; background: {paper}; color: #151515;
          font: {size}px/1.55 {font}; white-space: pre-wrap; tab-size: 4; {transform} {filter} }}
</style><div class="sheet">{text}</div>"""


def page_html(text, style):
    font = RNG.choice(FONTS)
    size = RNG.choice([19, 20, 21, 22])
    if style == "scan":
        return PAGE.format(desk="#ffffff", paper="#ffffff", size=size, font=font, transform="", filter="", text=html.escape(text))
    angle = RNG.uniform(-2.2, 2.2)
    tilt = RNG.uniform(-5, 5)
    blur = RNG.uniform(0.35, 0.7)
    light = RNG.choice(["linear-gradient(100deg,#f5f1e7 0%,#e4decf 55%,#c3bcab 100%)",
                        "linear-gradient(250deg,#f3f0e8 0%,#dfdacb 60%,#b9b3a4 100%)",
                        "radial-gradient(circle at 30% 25%,#faf7ee 0%,#e2dccd 60%,#c9c2b2 100%)"])
    return PAGE.format(
        desk=RNG.choice(["#6b6258", "#4d5560", "#7a6f5d", "#3f4a44"]), paper=light, size=size, font=font,
        transform=f"margin: 34px auto; transform: rotate({angle:.2f}deg) perspective(1500px) rotateY({tilt:.1f}deg) scale(.95);",
        filter=f"filter: blur({blur:.2f}px) contrast({RNG.uniform(.82, .92):.2f}) brightness({RNG.uniform(.9, .98):.2f});",
        text=html.escape(text))


def main():
    rows = [json.loads(line) for line in open(HERE / "data" / "extraction.jsonl", encoding="utf-8")]
    rows = [r for r in rows if not r["noisy"]]
    by_layout = {}
    for row in rows:
        by_layout.setdefault(row["layout"], []).append(row)
    chosen = [row for layout in sorted(by_layout) for row in by_layout[layout][:PER_LAYOUT]]

    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1140, "height": 900})
        for index, row in enumerate(chosen):
            for style in ("scan", "photo"):
                page.set_content(page_html(row["text"], style))
                name = f"{index:03d}-{row['layout']}-{style}.{'png' if style == 'scan' else 'jpg'}"
                if style == "scan":
                    page.locator(".sheet").screenshot(path=str(OUT / name))
                else:
                    page.screenshot(path=str(OUT / name), type="jpeg", quality=RNG.randint(52, 72), full_page=True)
                manifest.append({"image": name, "style": style, "label": row["label"], "layout": row["layout"], "truth": row["truth"]})
        browser.close()
    with open(OUT / "manifest.jsonl", "w", encoding="utf-8") as f:
        for entry in manifest:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"wrote {len(manifest)} pictures of {len(chosen)} documents to {OUT}")


if __name__ == "__main__":
    main()
