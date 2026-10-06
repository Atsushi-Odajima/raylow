#!/usr/bin/env python3
"""
同梱の可変フォント（Noto Sans JP / Noto Serif JP / Bricolage Grotesque, SIL OFL 1.1）から静的インスタンスを生成する。
LibreOffice 24.2 は可変フォントを PDF へ Type3 として書き出すため、書面出力には静的インスタンスを使う。
OFL 下の派生物として assets/licenses の OFL 全文を同梱したまま配布する（Noto に Reserved Font Name は無い）。
usage: python3 -I scripts/build_static_fonts.py
"""
import os
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "fonts")
OUT = os.path.join(SRC, "static")
os.makedirs(OUT, exist_ok=True)

PLAN = {
    "NotoSerifJP.ttf": [("Regular", {"wght": 400}), ("Medium", {"wght": 500}), ("SemiBold", {"wght": 600}), ("Bold", {"wght": 700})],
    "NotoSansJP.ttf": [("Regular", {"wght": 400}), ("Medium", {"wght": 500}), ("Bold", {"wght": 700})],
    "BricolageGrotesque.ttf": [("SemiBold", {"wght": 600, "opsz": 48, "wdth": 100})],
}


def set_names(font: TTFont, family: str, style: str) -> None:
    name = font["name"]
    full = f"{family} {style}" if style != "Regular" else family
    ps = f"{family.replace(' ', '')}-{style}"
    for rec in list(name.names):
        if rec.nameID in (1, 2, 3, 4, 6, 16, 17, 21, 22, 25):
            name.removeNames(rec.nameID, rec.platformID, rec.platEncID, rec.langID)
    for pid, eid, lid in ((3, 1, 0x409), (1, 0, 0)):
        name.setName(family, 1, pid, eid, lid)
        name.setName(style if style in ("Regular", "Bold") else "Regular", 2, pid, eid, lid)
        name.setName(f"{ps};RayLaw-static", 3, pid, eid, lid)
        name.setName(full, 4, pid, eid, lid)
        name.setName(ps, 6, pid, eid, lid)
        name.setName(family, 16, pid, eid, lid)
        name.setName(style, 17, pid, eid, lid)
    weight = {"Regular": 400, "Medium": 500, "SemiBold": 600, "Bold": 700}[style]
    font["OS/2"].usWeightClass = weight
    if style == "Bold":
        font["OS/2"].fsSelection |= 1 << 5
        font["head"].macStyle |= 1
    else:
        font["OS/2"].fsSelection &= ~(1 << 5)
        font["head"].macStyle &= ~1
    if style == "Regular":
        font["OS/2"].fsSelection |= 1 << 6


def main() -> int:
    for src, variants in PLAN.items():
        path = os.path.join(SRC, src)
        if not os.path.exists(path):
            print(f"skip {src} (missing)")
            continue
        for style, loc in variants:
            font = TTFont(path)
            family = font["name"].getDebugName(16) or font["name"].getDebugName(1)
            family = family.split(" ")[0] + " " + " ".join(family.split(" ")[1:]) if family else src
            # Noto の family 名は "Noto Serif JP" / "Noto Sans JP"
            if "Noto" in family:
                family = "Noto Serif JP" if "Serif" in src else "Noto Sans JP"
            elif "Bricolage" in src:
                family = "Bricolage Grotesque"
            inst = instancer.instantiateVariableFont(font, loc, inplace=True, updateFontNames=False)
            set_names(inst, family, style)
            out = os.path.join(OUT, f"{family.replace(' ', '')}-{style}.ttf")
            inst.save(out)
            print(f"wrote {out} ({os.path.getsize(out)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
