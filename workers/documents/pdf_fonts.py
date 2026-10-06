#!/usr/bin/env python3
"""
PDF preflight（§19 U07 / AC09）: フォント埋込、ページ数、文書メタデータ、外部リンク/注釈、text extraction 往復。
usage: pdf_fonts.py <pdf> [--expect-text <utf8 txt file>]
出力 JSON: {pages, fonts:[{name, embedded, subset, type}], unembeddedFonts:[], metadata:{}, annotations:n, links:n, extractedTextSample:str, missingTexts:[...]}
"""
from __future__ import annotations

import json
import sys

from pypdf import PdfReader


def main(argv: list[str]) -> int:
    path = argv[1]
    expect = None
    if "--expect-text" in argv:
        with open(argv[argv.index("--expect-text") + 1], encoding="utf-8") as f:
            expect = [ln.strip() for ln in f.read().splitlines() if ln.strip()]
    r = PdfReader(path)
    fonts: dict[str, dict] = {}
    annots = 0
    links = 0
    texts: list[str] = []
    for page in r.pages:
        res = page.get("/Resources")
        if res is not None:
            res = res.get_object()
            fdict = res.get("/Font")
            if fdict is not None:
                for _, ref in fdict.get_object().items():
                    f = ref.get_object()
                    name = str(f.get("/BaseFont", "?"))
                    sub = str(f.get("/Subtype", ""))
                    desc = f.get("/FontDescriptor")
                    if desc is None and "/DescendantFonts" in f:
                        try:
                            desc = f["/DescendantFonts"][0].get_object().get("/FontDescriptor")
                        except Exception:  # noqa: BLE001
                            desc = None
                    embedded = False
                    if desc is not None:
                        d = desc.get_object()
                        embedded = any(k in d for k in ("/FontFile", "/FontFile2", "/FontFile3"))
                    fonts[name] = {"name": name, "embedded": embedded, "subset": name.lstrip("/")[6:7] == "+" , "type": sub}
        a = page.get("/Annots")
        if a is not None:
            try:
                for x in a:
                    annots += 1
                    xo = x.get_object()
                    if xo.get("/Subtype") == "/Link":
                        links += 1
            except Exception:  # noqa: BLE001
                pass
        try:
            texts.append(page.extract_text() or "")
        except Exception:  # noqa: BLE001
            texts.append("")
    full = "\n".join(texts)
    missing = []
    if expect:
        norm = full.replace(" ", "").replace("\n", "")
        for e in expect:
            if e.replace(" ", "").replace("　", "") not in norm and e not in full:
                missing.append(e)
    meta = {k: str(v)[:80] for k, v in (r.metadata or {}).items()} if r.metadata else {}
    out = {
        "pages": len(r.pages),
        "fonts": list(fonts.values()),
        "unembeddedFonts": [f["name"] for f in fonts.values() if not f["embedded"]],
        "metadata": meta,
        "annotations": annots,
        "links": links,
        "extractedTextSample": full[:400],
        "missingTexts": missing,
        "hasText": bool(full.strip()),
    }
    json.dump(out, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
