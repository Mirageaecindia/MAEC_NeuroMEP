"""
NeuroMEP -> Revit exchange: placement check (#TASK-33, 12 Nov 2026).

Reads ONLY the exchange JSON and draws every component (marker + tag) and every feeder route
onto a copy of each floor's plan PDF, using the `pdf` coordinates of the JSON. If the JSON is
right, each marker sits where the component was placed in NeuroMEP. The Revit add-in can be
checked the same way: its placed families should match this sheet after alignment.

    python -I placement_check.py samples/<sample>.json plans/   # writes <sample>_<floor>_check.pdf

Needs PyMuPDF (pip install pymupdf). PDF user space (origin bottom-left, y up) is converted to
the page's drawing space with PyMuPDF's page.transformation_matrix, so page rotation and a
media box not starting at 0, 0 are handled.
"""

import json
import sys
from pathlib import Path

import pymupdf

COLOURS = {
    "transformer": (0.8, 0.1, 0.1),
    "generator": (0.8, 0.1, 0.1),
    "ups": (0.8, 0.1, 0.1),
    "meter": (0.1, 0.55, 0.1),
    "pfc-bank": (0.55, 0.1, 0.6),
}
BLUE = (0.11, 0.3, 0.85)


def main(exchange_path: str, plans_dir: str) -> None:
    data = json.loads(Path(exchange_path).read_text(encoding="utf-8"))
    out_dir = Path(exchange_path).parent
    for floor in data["floors"]:
        plan = floor.get("plan")
        if not plan:
            continue
        source = Path(plans_dir) / plan["fileName"]
        doc = pymupdf.open(source)
        page = doc[0]
        to_page = page.transformation_matrix

        def at(p):
            return pymupdf.Point(p["x"], p["y"]) * to_page

        drawn = 0
        for f in data["feeders"]:
            if f["floorId"] != floor["id"] or not f["route"]:
                continue
            pts = [at(p) for p in f["route"]["pdf"]]
            page.draw_polyline(pts, color=BLUE, width=1.2)
            mid = pts[len(pts) // 2]
            size = f["result"]["cable"] if f["result"] else None
            label = f["tag"] + (f" {size['runs']}x{size['sizeMm2']}mm2" if size else "")
            page.insert_text(mid + (2, -2), label, fontsize=5, color=BLUE, rotate=page.rotation)
        for c in data["components"]:
            if c["floorId"] != floor["id"] or not c["placement"]["pdf"]:
                continue
            p = at(c["placement"]["pdf"])
            colour = COLOURS.get(c["kind"], (0, 0, 0))
            page.draw_circle(p, 4, color=colour, fill=(1, 1, 1), width=1.2)
            page.draw_line(p + (-6, 0), p + (6, 0), color=colour, width=0.6)
            page.draw_line(p + (0, -6), p + (0, 6), color=colour, width=0.6)
            device = c["result"]["device"] if c["result"] else None
            label = c["tag"] + (f" {device['ratingA']}A" if device else "")
            page.insert_text(p + (6, -5), label, fontsize=6, color=colour, rotate=page.rotation)
            drawn += 1
        target = out_dir / f"{Path(exchange_path).stem}_{floor['code']}_check.pdf"
        doc.save(target)
        print(f"{target.name}: {drawn} components on {plan['fileName']}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
