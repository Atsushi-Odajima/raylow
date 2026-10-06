#!/usr/bin/env python3
"""
原資料ファイル検査（§20.3 / AC20）: magic bytes/MIME/拡張子整合、ZIP 構造、PDF（暗号化/JavaScript/添付/外部動作）、画像 pixel 上限。
usage: check_file.py <path> <declared_mime> <original_name>
出力 JSON: {ok, detectedKind, errors:[{code,message}], warnings:[...], stats:{...}}
"""
from __future__ import annotations

import json
import os
import re
import sys
import zipfile

MAX_IMAGE_PIXELS = 40_000_000
MAX_PDF_PAGES = 500
MAX_SOURCE = 100 * 1024 * 1024


def detect(path: str) -> str:
    with open(path, "rb") as f:
        head = f.read(8192)
    if head[:5] == b"%PDF-":
        return "pdf"
    if head[:4] == b"\x89PNG":
        return "png"
    if head[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if head[:2] == b"PK":
        return "zip"
    if b"\x00" not in head:
        return "text"
    return "unknown"


def main(argv: list[str]) -> int:
    path, mime, name = argv[1], argv[2], argv[3] if len(argv) > 3 else ""
    out: dict = {"ok": True, "detectedKind": None, "errors": [], "warnings": [], "stats": {}}

    def err(code: str, msg: str) -> None:
        out["errors"].append({"code": code, "message": msg})
        out["ok"] = False

    size = os.path.getsize(path)
    out["stats"]["bytes"] = size
    if size > MAX_SOURCE:
        err("file_too_large", f"100MB を超えています（{size} bytes）")
    kind = detect(path)
    out["detectedKind"] = kind
    expected = {"application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpeg", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "zip", "text/plain": "text", "text/csv": "text"}.get(mime)
    if expected is None:
        err("mime_not_allowed", f"宣言 MIME {mime} は許可されていません")
    elif kind != expected:
        err("magic_mismatch", f"ファイル内容（{kind}）が宣言形式（{mime}）と一致しません（偽 MIME）")
    ext = os.path.splitext(name)[1].lower()
    ext_ok = {"pdf": [".pdf"], "png": [".png"], "jpeg": [".jpg", ".jpeg"], "zip": [".docx"], "text": [".txt", ".csv"]}.get(kind, [])
    if name and ext not in ext_ok:
        err("extension_mismatch", f"拡張子 {ext or '(なし)'} が内容（{kind}）と一致しません")
    if ext in (".docm", ".dotm", ".xlsm", ".exe", ".js", ".vbs", ".html", ".htm", ".svg"):
        err("extension_forbidden", f"拡張子 {ext} は登録できません")

    if kind == "pdf":
        try:
            from pypdf import PdfReader

            reader = PdfReader(path)
            if reader.is_encrypted:
                err("pdf_encrypted", "暗号化 PDF は登録できません（パスワード解除したコピーを登録）")
            else:
                n = len(reader.pages)
                out["stats"]["pages"] = n
                if n > MAX_PDF_PAGES:
                    err("pdf_too_many_pages", f"PDF は {MAX_PDF_PAGES} ページまでです（{n}）")
                root = reader.trailer.get("/Root", {})
                try:
                    root = root.get_object()
                except Exception:  # noqa: BLE001
                    pass
                names = root.get("/Names") if hasattr(root, "get") else None
                if names is not None:
                    try:
                        nobj = names.get_object()
                        if "/JavaScript" in nobj:
                            err("pdf_javascript", "埋込 JavaScript を含む PDF は登録できません")
                        if "/EmbeddedFiles" in nobj:
                            err("pdf_embedded_files", "添付ファイルを含む PDF は登録できません")
                    except Exception:  # noqa: BLE001
                        pass
                oa = root.get("/OpenAction") if hasattr(root, "get") else None
                if oa is not None:
                    out["warnings"].append({"code": "pdf_open_action", "message": "OpenAction を含みます（派生版で除去）"})
                if hasattr(root, "get") and root.get("/AA") is not None:
                    err("pdf_additional_actions", "文書アクション（AA）を含む PDF は登録できません")
                # ページ単位の Launch/URI/JavaScript アクション
                for i, page in enumerate(reader.pages[:50]):
                    annots = page.get("/Annots")
                    if annots is None:
                        continue
                    try:
                        for a in annots:
                            ao = a.get_object()
                            act = ao.get("/A")
                            if act is not None:
                                s = str(act.get_object().get("/S"))
                                if s in ("/Launch", "/JavaScript", "/SubmitForm", "/ImportData"):
                                    err("pdf_dangerous_action", f"ページ {i+1} に {s} アクションがあります")
                                elif s == "/URI":
                                    out["warnings"].append({"code": "pdf_uri", "message": f"ページ {i+1} に外部 URI リンクがあります（実行されません）"})
                    except Exception:  # noqa: BLE001
                        pass
                out["stats"]["metadata"] = {k: str(v)[:60] for k, v in (reader.metadata or {}).items()} if reader.metadata else {}
        except Exception as e:  # noqa: BLE001
            err("pdf_parse_failed", f"PDF を解析できません: {e}")
    elif kind in ("png", "jpeg"):
        try:
            from PIL import Image

            Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS * 2
            with Image.open(path) as im:
                w, h = im.size
                out["stats"]["pixels"] = [w, h]
                if w * h > MAX_IMAGE_PIXELS:
                    err("image_too_large", f"画像は {MAX_IMAGE_PIXELS} pixel までです（{w}×{h}）")
        except Exception as e:  # noqa: BLE001
            err("image_parse_failed", f"画像を解析できません: {e}")
    elif kind == "zip":
        try:
            with zipfile.ZipFile(path) as zf:
                names = zf.namelist()
                total = sum(i.file_size for i in zf.infolist())
                out["stats"]["entries"] = len(names)
                out["stats"]["uncompressed"] = total
                if len(names) > 2000 or total > 200 * 1024 * 1024:
                    err("zip_limits", "ZIP の entry 数または展開後サイズが上限を超えています")
                for i in zf.infolist():
                    if i.compress_size and i.file_size / max(i.compress_size, 1) > 100 and i.file_size > 1024 * 1024:
                        err("compression_ratio", f"圧縮率が異常な entry: {i.filename}（ZIP bomb の疑い）")
                    if i.filename.startswith("/") or ".." in i.filename.split("/"):
                        err("path_traversal", f"不正な entry 名: {i.filename}")
                if "word/document.xml" not in names:
                    err("not_docx", "DOCX ではありません")
                if any(n.lower().endswith("vbaproject.bin") for n in names):
                    err("macro_enabled", "マクロ（vbaProject.bin）を含みます")
                ct = zf.read("[Content_Types].xml").decode("utf-8", "replace") if "[Content_Types].xml" in names else ""
                if "macroEnabled" in ct:
                    err("macro_enabled", "マクロ有効文書です")
                if any(n.startswith("word/embeddings/") for n in names):
                    err("ole_object", "埋込オブジェクトを含みます")
                for n in names:
                    if n.endswith(".rels") and b'TargetMode="External"' in zf.read(n) and b"hyperlink" not in zf.read(n):
                        err("external_relationship", f"外部参照を含みます: {n}")
        except zipfile.BadZipFile:
            err("bad_zip", "ZIP として開けません")
    elif kind == "text":
        with open(path, "rb") as f:
            data = f.read()
        try:
            data.decode("utf-8")
            out["stats"]["encoding"] = "utf-8"
        except UnicodeDecodeError:
            try:
                data.decode("cp932")
                out["stats"]["encoding"] = "cp932"
            except UnicodeDecodeError:
                out["stats"]["encoding"] = "unknown"
                out["warnings"].append({"code": "encoding_unknown", "message": "UTF-8/CP932 で復号できません。原本 bytes は保存し、テキスト化は行いません"})
        if re.search(rb"<script|<html|<svg", data[:4096], re.IGNORECASE):
            err("html_or_svg_not_allowed", "HTML/SVG は入力として許可されていません")
    json.dump(out, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
