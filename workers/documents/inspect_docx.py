#!/usr/bin/env python3
"""
RayLaw DOCX 構造検査（§5.2 / §20.3 / AC05 / AC06 / AC20）

標準出力に JSON を 1 つ出す:
{
  "ok": bool, "inspectorVersion": str,
  "issues": [{severity: error|warning|info, code, message, location, hint}],
  "tags": [{raw, kind: value|loop_open|loop_close|inverted_open, key, valid, reason?, location}],
  "stats": {...},
  "residualTextCandidates": [{location, text, reason}]
}
方針:
- ZIP/XML 構造を検査する。XML 文字列の単純置換で実装しない。
- 段落(w:p)内の run を連結してタグを検出する（run 分割タグ対応）。
- 対応外要素は位置と理由と修正手順を返し、元ファイルは変更しない。
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from dataclasses import dataclass, field, asdict
from typing import Any

from lxml import etree

INSPECTOR_VERSION = "raylow-docx-inspector/1.0.0"

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "wps": "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    "v": "urn:schemas-microsoft-com:vml",
    "o": "urn:schemas-microsoft-com:office:office",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
}
W = "{%s}" % NS["w"]

MAX_ENTRIES = 2000
MAX_UNCOMPRESSED = 200 * 1024 * 1024
MAX_RATIO = 100
MAX_FILE = 20 * 1024 * 1024

TAG_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
DANGEROUS = {"__proto__", "constructor", "prototype", "this", "eval"}
ALLOWED_FIELD_INSTR = re.compile(r"^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b", re.IGNORECASE)
HINT_COPY = "Word で対応外要素を除いたコピーを保存してから再登録してください。元ファイルは変更していません。"


@dataclass
class Issue:
    severity: str
    code: str
    message: str
    location: str = ""
    hint: str = ""


@dataclass
class Tag:
    raw: str
    kind: str
    key: str
    valid: bool
    location: str
    reason: str | None = None


@dataclass
class Report:
    ok: bool = True
    inspectorVersion: str = INSPECTOR_VERSION
    issues: list[Issue] = field(default_factory=list)
    tags: list[Tag] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)
    residualTextCandidates: list[dict[str, str]] = field(default_factory=list)

    def error(self, code: str, message: str, location: str = "", hint: str = HINT_COPY) -> None:
        self.issues.append(Issue("error", code, message, location, hint))
        self.ok = False

    def warn(self, code: str, message: str, location: str = "", hint: str = "") -> None:
        self.issues.append(Issue("warning", code, message, location, hint))

    def info(self, code: str, message: str, location: str = "") -> None:
        self.issues.append(Issue("info", code, message, location, ""))


def parse_tag_body(body: str) -> tuple[str, str, bool, str | None]:
    kind = "value"
    key = body
    if body.startswith("#"):
        kind, key = "loop_open", body[1:]
    elif body.startswith("/"):
        kind, key = "loop_close", body[1:]
    elif body.startswith("^"):
        kind, key = "inverted_open", body[1:]
    if "." in key:
        return kind, key, False, "dot_path_not_allowed"
    if key in DANGEROUS:
        return kind, key, False, "dangerous_key"
    if re.search(r"[|()+\-*/<>=!?:'\"`\s]", key):
        return kind, key, False, "expression_not_allowed"
    if re.search(r"[^\x00-\x7f]", key):
        return kind, key, False, "non_ascii_key"
    if not TAG_KEY_RE.match(key):
        return kind, key, False, "tag_key_not_allowed"
    return kind, key, True, None


def paragraph_text(p: etree._Element) -> tuple[str, int]:
    """run を連結した段落テキストと run 数。w:tab/w:br は空白/改行に。"""
    parts: list[str] = []
    runs = 0
    for el in p.iter():
        tag = etree.QName(el).localname if isinstance(el.tag, str) else ""
        if tag == "r":
            runs += 1
        elif tag == "t":
            parts.append(el.text or "")
        elif tag == "tab":
            parts.append("\t")
        elif tag == "br":
            parts.append("\n")
    return "".join(parts), runs


def check_zip(path: str, rep: Report) -> zipfile.ZipFile | None:
    import os

    size = os.path.getsize(path)
    rep.stats["fileBytes"] = size
    if size > MAX_FILE:
        rep.error("file_too_large", f"書式 DOCX は {MAX_FILE // 1024 // 1024}MB までです（{size} bytes）", "zip", "ファイルを縮小してください")
        return None
    with open(path, "rb") as f:
        head = f.read(4)
    if head[:2] != b"PK":
        rep.error("not_zip", "DOCX（ZIP）ではありません（magic bytes 不一致）", "zip", "Word で .docx 形式として保存し直してください")
        return None
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        rep.error("bad_zip", "ZIP として開けません", "zip")
        return None
    infos = zf.infolist()
    rep.stats["entries"] = len(infos)
    total = 0
    for i in infos:
        name = i.filename
        if name.startswith("/") or ".." in name.split("/") or "\\" in name:
            rep.error("path_traversal", f"不正な entry 名: {name}", f"zip:{name}")
        total += i.file_size
        if i.compress_size > 0 and i.file_size / max(i.compress_size, 1) > MAX_RATIO and i.file_size > 1024 * 1024:
            rep.error("compression_ratio", f"圧縮率が上限 {MAX_RATIO} 倍を超える entry: {name}", f"zip:{name}", "ZIP bomb の疑い。通常の Word 保存で作り直してください")
    rep.stats["uncompressedBytes"] = total
    if len(infos) > MAX_ENTRIES:
        rep.error("too_many_entries", f"ZIP entry 数が上限 {MAX_ENTRIES} を超えています（{len(infos)}）", "zip")
    if total > MAX_UNCOMPRESSED:
        rep.error("uncompressed_too_large", f"展開後サイズが上限 {MAX_UNCOMPRESSED // 1024 // 1024}MB を超えています", "zip")
    names = set(zf.namelist())
    if len(names) != len(infos):
        rep.error("duplicate_entries", "重複する entry があります", "zip")
    if "[Content_Types].xml" not in names or "word/document.xml" not in names:
        rep.error("not_docx", "[Content_Types].xml または word/document.xml がありません", "zip", "Word で .docx 形式として保存し直してください")
        return None
    return zf


def check_content_types(zf: zipfile.ZipFile, rep: Report) -> None:
    ct = etree.fromstring(zf.read("[Content_Types].xml"))
    for el in ct.iter("{%s}Override" % NS["ct"]):
        c = el.get("ContentType", "")
        part = el.get("PartName", "")
        if "macroEnabled" in c or part.endswith("vbaProject.bin") or "vbaProject" in c:
            rep.error("macro_enabled", f"マクロ有効文書（{c}）は登録できません", part or "[Content_Types].xml", "Word で「Word 文書 (*.docx)」として保存し直してください（マクロは保持されません）")
        if "oleObject" in c or "package" in c and part.endswith(".bin"):
            rep.error("ole_object", f"埋込オブジェクト（{c}）は対応外です", part)
    for d in ct.iter("{%s}Default" % NS["ct"]):
        if d.get("Extension", "").lower() in ("bin",) and "vba" in d.get("ContentType", ""):
            rep.error("macro_enabled", "vbaProject.bin が含まれています", "[Content_Types].xml")
    for n in zf.namelist():
        if n.lower().endswith("vbaproject.bin"):
            rep.error("macro_enabled", "vbaProject.bin が含まれています", n)
        if n.startswith("word/embeddings/"):
            rep.error("ole_object", f"埋込オブジェクト {n} は対応外です", n)


def check_rels(zf: zipfile.ZipFile, rep: Report) -> None:
    for n in zf.namelist():
        if not n.endswith(".rels"):
            continue
        try:
            root = etree.fromstring(zf.read(n))
        except etree.XMLSyntaxError:
            rep.error("bad_xml", f"{n} を解析できません", n)
            continue
        for rel in root.iter("{%s}Relationship" % NS["rel"]):
            mode = rel.get("TargetMode", "")
            typ = rel.get("Type", "")
            target = rel.get("Target", "")
            short = typ.rsplit("/", 1)[-1]
            if mode == "External":
                if short == "hyperlink":
                    rep.warn("external_hyperlink", f"外部リンク {target}（出力時に実行されません）", n)
                else:
                    rep.error("external_relationship", f"外部参照（{short}: {target}）は対応外です", n, "リンク画像・外部オブジェクトを埋込に変えるか削除したコピーを保存してください")
            if short in ("oleObject", "package", "vbaProject"):
                rep.error("ole_object", f"埋込オブジェクト関係（{short}）は対応外です", n)
            if short in ("comments", "commentsExtended", "commentsIds", "commentsExtensible", "people"):
                rep.error("comments", "コメントが含まれています", n, "Word で全コメントを削除したコピーを保存してください")
            if short in ("footnotes", "endnotes"):
                # 区切り線だけのパーツは許容（Word 既定）。本文ありは拒否。
                target_path = "word/" + target if not target.startswith("/") else target.lstrip("/")
                if target_path in zf.namelist():
                    try:
                        fx = etree.fromstring(zf.read(target_path))
                        real = [e for e in fx if e.get(W + "type") not in ("separator", "continuationSeparator")]
                        if real:
                            rep.error("footnotes", f"{'脚注' if short == 'footnotes' else '文末脚注'}が含まれています（{len(real)} 件）", target_path, "脚注を本文へ移したコピーを保存してください")
                    except etree.XMLSyntaxError:
                        rep.error("bad_xml", f"{target_path} を解析できません", target_path)
            if short == "glossaryDocument":
                rep.warn("glossary_part", "文書パーツ（glossary）が含まれています。差込対象外です", n)


def check_document(zf: zipfile.ZipFile, rep: Report) -> None:
    parts = ["word/document.xml"] + sorted(n for n in zf.namelist() if re.match(r"word/(header|footer)\d*\.xml$", n))
    rep.stats["parts"] = parts
    seen_tags: list[Tag] = []
    residual: list[dict[str, str]] = []
    sect_count = 0
    for part in parts:
        try:
            root = etree.fromstring(zf.read(part))
        except etree.XMLSyntaxError as e:
            rep.error("bad_xml", f"{part} を解析できません: {e}", part)
            continue
        short = part.split("/")[-1].replace(".xml", "")
        # 対応外要素
        for el in root.iter():
            if not isinstance(el.tag, str):
                continue
            q = etree.QName(el)
            ln, ns = q.localname, q.namespace
            if ns == NS["w"]:
                if ln == "sectPr":
                    sect_count += 1 if part == "word/document.xml" else 0
                elif ln in ("ins", "del", "moveFrom", "moveTo", "rPrChange", "pPrChange", "tblPrChange", "trPrChange", "tcPrChange", "sectPrChange", "numberingChange"):
                    rep.error("tracked_changes", f"変更履歴（w:{ln}）が含まれています", f"{short}", "Word で変更履歴をすべて承諾して保存したコピーを登録してください")
                elif ln in ("commentRangeStart", "commentRangeEnd", "commentReference"):
                    rep.error("comments", "コメント参照が含まれています", f"{short}", "Word で全コメントを削除したコピーを保存してください")
                elif ln == "txbxContent":
                    rep.error("textbox", "テキストボックスは対応外です", f"{short}", "テキストボックスの文字を本文または表へ移したコピーを保存してください")
                elif ln == "object":
                    rep.error("ole_object", "埋込オブジェクト（w:object）は対応外です", f"{short}")
                elif ln in ("footnoteReference", "endnoteReference"):
                    rep.error("footnotes", "脚注参照が含まれています", f"{short}")
                elif ln == "fldSimple":
                    instr = el.get(W + "instr", "")
                    if not ALLOWED_FIELD_INSTR.match(instr):
                        rep.error("unsupported_field", f"フィールド {instr.strip()[:40]} は対応外です（PAGE/NUMPAGES のみ許可）", f"{short}", "フィールドを固定文字列に変換したコピーを保存してください")
                elif ln == "instrText":
                    instr = (el.text or "").strip()
                    if instr and not ALLOWED_FIELD_INSTR.match(instr):
                        rep.error("unsupported_field", f"フィールド {instr[:40]} は対応外です（PAGE/NUMPAGES のみ許可）", f"{short}", "フィールドを固定文字列に変換したコピーを保存してください")
                elif ln == "sdt":
                    rep.warn("content_control", "コンテンツコントロール（w:sdt）があります。差込対象外です", f"{short}")
                elif ln == "altChunk":
                    rep.error("alt_chunk", "外部コンテンツ（altChunk）は対応外です", f"{short}")
            elif ns == NS["v"] and ln in ("textbox", "shape", "imagedata"):
                if ln == "textbox":
                    rep.error("textbox", "VML テキストボックスは対応外です", f"{short}")
                elif ln == "imagedata" and el.get("{%s}href" % NS["r"]) is None and el.get("src"):
                    rep.error("external_relationship", "外部 VML 画像参照は対応外です", f"{short}")
            elif ns == NS["o"] and ln == "OLEObject":
                rep.error("ole_object", "OLE オブジェクトは対応外です", f"{short}")
            elif ns == NS["wps"] and ln == "txbx":
                rep.error("textbox", "図形内テキストは対応外です", f"{short}")
            elif ns == NS["a"] and ln == "blip":
                if el.get("{%s}link" % NS["r"]):
                    rep.error("external_relationship", "リンク画像（埋込でない）は対応外です", f"{short}")
                else:
                    rep.info("embedded_image", "固定画像（埋込）を保持します。印影や実署名が含まれていないか確認してください", f"{short}")
        # 段落ごとのタグ検出
        body = root
        p_index = 0
        for p in body.iter(W + "p"):
            p_index += 1
            text, runs = paragraph_text(p)
            if not text:
                continue
            loc = f"{short}/p{p_index}"
            in_table = any(etree.QName(a).localname == "tc" for a in p.iterancestors() if isinstance(a.tag, str))
            depth = 0
            i = 0
            had_tag = False
            while i < len(text):
                o = text.find("{", i)
                if o < 0:
                    if "}" in text[i:]:
                        rep.error("stray_close_brace", f"対応しない「}}」があります: {text[i:i+40]!r}", loc, "タグは {key} の形式です")
                    break
                c = text.find("}", o + 1)
                if c < 0:
                    rep.error("paragraph_spanning_tag", f"段落内で閉じられていないタグ: {text[o:o+40]!r}", loc, "タグは 1 つの段落（1 行）内で閉じてください。改行や段落記号で分断しないでください")
                    break
                inner = text[o + 1 : c]
                if "{" in inner:
                    rep.error("nested_brace", f"入れ子の波括弧: {text[o:c+1]!r}", loc)
                    i = c + 1
                    continue
                kind, key, valid, reason = parse_tag_body(inner)
                t = Tag(raw="{" + inner + "}", kind=kind, key=key, valid=valid, location=loc, reason=reason)
                seen_tags.append(t)
                had_tag = True
                if not valid:
                    rep.error(reason or "invalid_tag", f"許可されないタグ {t.raw}（{reason}）", loc, "タグは ASCII 小文字/数字/_ のキーのみ。式・ドット・パイプは使えません")
                if kind in ("loop_open", "inverted_open"):
                    depth += 1
                    if in_table:
                        # 行ループの縦結合検査
                        tr = next((a for a in p.iterancestors() if isinstance(a.tag, str) and etree.QName(a).localname == "tr"), None)
                        if tr is not None and tr.findall(".//" + W + "vMerge"):
                            rep.error("vmerge_in_loop", f"繰返し行 {t.raw} に縦結合（vMerge）があります。初版は未対応です", loc, "縦結合を解除した表に変更したコピーを保存してください")
                elif kind == "loop_close":
                    depth -= 1
                i = c + 1
            if had_tag and runs > 1:
                rep.stats["splitRunParagraphs"] = rep.stats.get("splitRunParagraphs", 0) + 1
            # 残存テキスト候補（タグ以外の、個人情報らしい文字列）
            plain = re.sub(r"\{[^}]*\}", "", text).strip()
            if plain and (re.search(r"〒?\d{3}[-－]\d{4}", plain) or re.search(r"\d{2,4}[-－]\d{2,4}[-－]\d{3,4}", plain) or re.search(r"(東京都|北海道|(?:京都|大阪)府|[^\s]{2,3}県)[^\s]{1,20}(市|区|郡)", plain) or re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", plain)):
                residual.append({"location": loc, "text": plain[:120], "reason": "住所・電話・郵便番号・メールらしき残存文字列（他案件の実名/住所が残っていないか確認）"})
    if sect_count > 1:
        rep.error("multiple_sections", f"複数セクション（{sect_count}）は初版未対応です", "document", "セクション区切りを削除し単一セクション A4 横書きにしたコピーを保存してください")
    # ループ対応
    stack: list[Tag] = []
    for t in seen_tags:
        if not t.valid:
            continue
        if t.kind in ("loop_open", "inverted_open"):
            stack.append(t)
        elif t.kind == "loop_close":
            if not stack or stack[-1].key != t.key:
                rep.error("unbalanced_loop", f"対応しないループ終了 {t.raw}", t.location, "{#key} と {/key} を対で配置してください")
            else:
                stack.pop()
    for t in stack:
        rep.error("unbalanced_loop", f"閉じられていないループ {t.raw}", t.location, "{/" + t.key + "} を追加してください")
    rep.tags = seen_tags
    rep.residualTextCandidates = residual[:50]
    rep.stats["tagCount"] = len(seen_tags)
    rep.stats["uniqueKeys"] = sorted({t.key for t in seen_tags if t.valid})
    # セクション設定（A4 横書きの確認）
    try:
        doc = etree.fromstring(zf.read("word/document.xml"))
        sp = doc.find(".//" + W + "body/" + W + "sectPr")
        if sp is not None:
            pg = sp.find(W + "pgSz")
            if pg is not None:
                wv = int(pg.get(W + "w", "0"))
                hv = int(pg.get(W + "h", "0"))
                rep.stats["pageSizeTwips"] = [wv, hv]
                if not (11600 <= wv <= 12100 and 16600 <= hv <= 17000):
                    rep.warn("not_a4_portrait", f"用紙が A4 縦（11906×16838 twips）ではありません: {wv}×{hv}", "document/sectPr")
            if sp.find(W + "textDirection") is not None and sp.find(W + "textDirection").get(W + "val", "") not in ("lrTb", ""):
                rep.error("vertical_text", "縦書きセクションは対応外です", "document/sectPr", "横書きに変更したコピーを保存してください")
            if sp.find(W + "cols") is not None and int(sp.find(W + "cols").get(W + "num", "1")) > 1:
                rep.warn("multi_column", "段組みがあります。出力崩れを確認してください", "document/sectPr")
    except Exception as e:  # noqa: BLE001
        rep.warn("sect_check_failed", f"セクション確認に失敗: {e}", "document")
    # コア/アプリプロパティ
    for n in ("docProps/core.xml", "docProps/app.xml", "docProps/custom.xml"):
        if n in zf.namelist():
            try:
                x = etree.fromstring(zf.read(n))
                for el in x.iter():
                    ln = etree.QName(el).localname if isinstance(el.tag, str) else ""
                    if ln in ("creator", "lastModifiedBy", "title", "company", "description", "subject") and (el.text or "").strip():
                        rep.warn("metadata_present", f"文書プロパティ {ln}=「{(el.text or '').strip()[:40]}」が残っています（正式出力では除去）", n)
            except etree.XMLSyntaxError:
                pass


def inspect(path: str) -> Report:
    rep = Report()
    zf = check_zip(path, rep)
    if zf is None:
        return rep
    try:
        check_content_types(zf, rep)
        check_rels(zf, rep)
        check_document(zf, rep)
    finally:
        zf.close()
    return rep


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: inspect_docx.py <file.docx>", file=sys.stderr)
        return 2
    rep = inspect(argv[1])
    out = asdict(rep)
    out["tags"] = [{k: v for k, v in t.items() if v is not None} for t in out["tags"]]
    out["issues"] = [{k: v for k, v in i.items() if v != ""} for i in out["issues"]]
    json.dump(out, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
