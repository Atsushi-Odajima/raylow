#!/usr/bin/env python3
"""
派生安全版 PDF の生成（§20.3）: JavaScript/OpenAction/AA/埋込ファイル/注釈アクション/文書メタデータを除去した派生物を書き出す。
原本は変更しない。黒く覆うだけの墨消しは作らない。
usage: pdf_sanitize.py <in.pdf> <out.pdf> [--keep-metadata]
"""
from __future__ import annotations

import json
import sys

from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject


def main(argv: list[str]) -> int:
    src, dst = argv[1], argv[2]
    keep_meta = "--keep-metadata" in argv
    r = PdfReader(src)
    if r.is_encrypted:
        json.dump({"ok": False, "error": "encrypted"}, sys.stdout)
        return 1
    w = PdfWriter()
    removed = {"javascript": 0, "openAction": 0, "aa": 0, "embeddedFiles": 0, "annotActions": 0, "annotations": 0}
    for page in r.pages:
        w.add_page(page)
    root = w._root_object  # noqa: SLF001
    for key in ("/OpenAction", "/AA", "/AcroForm"):
        if key in root:
            del root[NameObject(key)]
            removed["openAction" if key == "/OpenAction" else "aa"] += 1
    names = root.get("/Names")
    if names is not None:
        n = names.get_object()
        for key in ("/JavaScript", "/EmbeddedFiles"):
            if key in n:
                del n[NameObject(key)]
                removed["javascript" if key == "/JavaScript" else "embeddedFiles"] += 1
    for page in w.pages:
        annots = page.get("/Annots")
        if annots is None:
            continue
        keep = []
        for a in annots:
            ao = a.get_object()
            sub = str(ao.get("/Subtype"))
            if sub == "/Link" and "/A" in ao:
                act = ao["/A"].get_object()
                if str(act.get("/S")) in ("/JavaScript", "/Launch", "/SubmitForm", "/ImportData"):
                    removed["annotActions"] += 1
                    continue
                keep.append(a)
            elif sub in ("/Widget", "/FileAttachment", "/Sound", "/Movie", "/Screen", "/RichMedia", "/3D"):
                removed["annotations"] += 1
                continue
            else:
                if "/AA" in ao:
                    del ao[NameObject("/AA")]
                    removed["aa"] += 1
                keep.append(a)
        from pypdf.generic import ArrayObject

        page[NameObject("/Annots")] = ArrayObject(keep)
    if not keep_meta:
        w.add_metadata({"/Producer": "RayLaw sanitized derivative"})
        try:
            w.remove_links  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass
    with open(dst, "wb") as f:
        w.write(f)
    json.dump({"ok": True, "removed": removed, "pages": len(w.pages)}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
