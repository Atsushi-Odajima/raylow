#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_fixtures.py — tests/fixtures 配下のテスト資料を決定的に生成する（python-docx + 生 XML 操作）

生成物
  docx/split_run_tags.docx            {office_name} を 3 run（"{off" / "ice_" / "name}"）に分割 + 表の行ループ（T01 のキーと互換）
  docx/forbidden/*.docx|.docm         禁止要素をちょうど 1 種類ずつ含む（inspector を個別に試験するため）
  docx/forbidden/clean_minimal.docx   問題のない最小 DOCX
  docx/zip_bomb.docx                  展開後 50MB（0 埋め）/ 圧縮後 ~50KB の entry を含む ZIP（圧縮率 100 倍超）
  docx/fake_mime.docx                 実体は PNG（拡張子偽装）
  unicode_cases.json / unicode_fixture.txt  検索キー ver1 の検算ケース（期待値は手書き）
  csv/*.csv, csv/contacts_bad_encoding.bin  インポート検証用 CSV

実行:  python3 -I tests/fixtures/build_fixtures.py [--check]
冪等: 生成バイト列が既存ファイルと一致する場合は書き換えない（ZIP のタイムスタンプ固定・entry 順固定）。
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import struct
import sys
import zipfile
import zlib
from pathlib import Path
from typing import Any

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt
from lxml import etree

HERE = Path(__file__).resolve().parent
FONT = "Noto Serif JP"

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "wps": "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    "v": "urn:schemas-microsoft-com:vml",
    "o": "urn:schemas-microsoft-com:office:office",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}
RT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
CT_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
CT_MACRO_MAIN = "application/vnd.ms-word.document.macroEnabled.main+xml"
FIXED_DATE = "2026-10-06T00:00:00Z"


# ---------------------------------------------------------------------------
# 共通: 決定的 ZIP / 書き込み
# ---------------------------------------------------------------------------
def rezip(entries: dict[str, bytes]) -> bytes:
    order = sorted(entries, key=lambda n: (n != "[Content_Types].xml", n))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for n in order:
            zi = zipfile.ZipInfo(n, date_time=(1980, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, entries[n])
    return out.getvalue()


def unzip(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return {i.filename: z.read(i.filename) for i in z.infolist()}


def write_if_changed(path: Path, data: bytes, check_only: bool) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() == data:
        return "unchanged"
    if check_only:
        return "DIFFERS"
    path.write_bytes(data)
    return "written"


def xml_bytes(root: Any) -> bytes:
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


# ---------------------------------------------------------------------------
# python-docx ベース文書
# ---------------------------------------------------------------------------
def _set_rfonts(rpr: Any) -> None:
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    for a in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
        rfonts.attrib.pop(qn(a), None)
    for a in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rfonts.set(qn(a), FONT)


def base_document(paragraphs: list[str] | None = None, header: bool = True) -> Any:
    """最小の A4 単一セクション文書。既定テンプレートの thumbnail/customXml/stylesWithEffects を外す。"""
    doc = Document()
    pkg = doc.part.package
    for rid, rel in list(pkg.rels.items()):
        if rel.reltype.endswith("/thumbnail"):
            del pkg.rels[rid]
    for rid, rel in list(doc.part.rels.items()):
        if rel.reltype.endswith("/customXml") or rel.reltype.endswith("/stylesWithEffects"):
            del doc.part.rels[rid]
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Mm(210), Mm(297)
    for m in ("top_margin", "bottom_margin", "left_margin", "right_margin"):
        setattr(sec, m, Mm(25))
    normal = doc.styles["Normal"]
    normal.font.name = FONT
    normal.font.size = Pt(12)
    _set_rfonts(normal.element.get_or_add_rPr())
    cp = doc.core_properties
    cp.author = "RayLaw fixtures"
    cp.last_modified_by = "RayLaw fixtures"
    cp.title = "RayLaw test fixture"
    cp.description = "generated by tests/fixtures/build_fixtures.py"
    import datetime as _dt
    cp.created = cp.modified = _dt.datetime(2026, 10, 6)
    cp.revision = 1
    body = doc.element.body
    for p in list(body.findall(qn("w:p"))):
        body.remove(p)
    if header:
        h = sec.header
        h.is_linked_to_previous = False
        hp = h.paragraphs[0]
        hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        hp.add_run("{document_status_label}")
    for text in paragraphs if paragraphs is not None else ["{office_name}", "{recipient_name}{recipient_honorific}", "件名：{subject}", "{body_text}"]:
        doc.add_paragraph(text)
    return doc


def doc_entries(doc: Any) -> dict[str, bytes]:
    buf = io.BytesIO()
    doc.save(buf)
    return unzip(buf.getvalue())


# ---------------------------------------------------------------------------
# ZIP レベルの part / relationship / content-type 操作
# ---------------------------------------------------------------------------
def add_override(entries: dict[str, bytes], part_name: str, content_type: str) -> None:
    root = etree.fromstring(entries["[Content_Types].xml"])
    for el in root.findall("{%s}Override" % NS["ct"]):
        if el.get("PartName") == part_name:
            el.set("ContentType", content_type)
            entries["[Content_Types].xml"] = xml_bytes(root)
            return
    el = etree.SubElement(root, "{%s}Override" % NS["ct"])
    el.set("PartName", part_name)
    el.set("ContentType", content_type)
    entries["[Content_Types].xml"] = xml_bytes(root)


def add_default(entries: dict[str, bytes], extension: str, content_type: str) -> None:
    root = etree.fromstring(entries["[Content_Types].xml"])
    for el in root.findall("{%s}Default" % NS["ct"]):
        if el.get("Extension") == extension:
            return
    el = etree.Element("{%s}Default" % NS["ct"])
    el.set("Extension", extension)
    el.set("ContentType", content_type)
    root.insert(0, el)
    entries["[Content_Types].xml"] = xml_bytes(root)


def add_relationship(entries: dict[str, bytes], rel_type: str, target: str, external: bool = False, rels_part: str = "word/_rels/document.xml.rels") -> str:
    root = etree.fromstring(entries[rels_part])
    ids = {el.get("Id") for el in root}
    n = 1
    while f"rId{n}" in ids:
        n += 1
    rid = f"rId{n}"
    el = etree.SubElement(root, "{%s}Relationship" % NS["rel"])
    el.set("Id", rid)
    el.set("Type", rel_type)
    el.set("Target", target)
    if external:
        el.set("TargetMode", "External")
    entries[rels_part] = xml_bytes(root)
    return rid


def document_root(entries: dict[str, bytes]) -> Any:
    return etree.fromstring(entries["word/document.xml"])


def set_document(entries: dict[str, bytes], root: Any) -> None:
    entries["word/document.xml"] = xml_bytes(root)


def first_paragraph(root: Any) -> Any:
    return root.find(".//w:body/w:p", NS)


def w(tag: str) -> str:
    return "{%s}%s" % (NS["w"], tag)


def make_run(text: str) -> Any:
    r = etree.Element(w("r"))
    t = etree.SubElement(r, w("t"))
    t.text = text
    t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    return r


def tiny_png() -> bytes:
    """1x1 の不透明 PNG（有効なファイル）。"""
    def chunk(tag: bytes, data: bytes) -> bytes:
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b"\x00" + b"\x40\x80\xc0"
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


# ---------------------------------------------------------------------------
# DOCX fixtures
# ---------------------------------------------------------------------------
def fx_split_run_tags() -> bytes:
    doc = base_document(paragraphs=[])
    p = doc.add_paragraph()
    r1 = p.add_run("{off")
    r1.bold = True
    r2 = p.add_run("ice_")
    r2.italic = True
    r3 = p.add_run("name}")
    r3.underline = True
    p2 = doc.add_paragraph()
    a = p2.add_run("{recip")
    a.bold = True
    p2.add_run("ient_name}")
    p2.add_run("{recipient_honorific}")
    doc.add_paragraph("件名：{subject}")
    doc.add_paragraph("案件：{matter_title}")
    doc.add_paragraph("依頼者：{client_name}　相手方：{opponent_name}")
    doc.add_paragraph("{body_text}")
    doc.add_paragraph("{#has_attachments}")
    doc.add_paragraph("添付書類")
    t = doc.add_table(rows=2, cols=2)
    t.style = doc.styles["Table Grid"]
    t.rows[0].cells[0].text = "書類名"
    t.rows[0].cells[1].text = "通数"
    c0 = t.rows[1].cells[0]
    c0.text = ""
    c0.paragraphs[0].add_run("{#attach")
    c0.paragraphs[0].add_run("ments}{name}")
    t.rows[1].cells[1].text = "{copies}{/attachments}"
    doc.add_paragraph("{/has_attachments}")
    doc.add_paragraph("{issue_date_wareki}　{office_name}　弁護士　{lawyer_name}")
    return rezip(doc_entries(doc))


def fx_clean_minimal() -> bytes:
    return rezip(doc_entries(base_document()))


def fx_textbox() -> bytes:
    entries = doc_entries(base_document())
    root = document_root(entries)
    p = first_paragraph(root)
    r = etree.SubElement(p, w("r"))
    drawing = etree.SubElement(r, w("drawing"))
    inline = etree.SubElement(drawing, "{%s}inline" % NS["wp"], distT="0", distB="0", distL="0", distR="0")
    etree.SubElement(inline, "{%s}extent" % NS["wp"], cx="1828800", cy="914400")
    etree.SubElement(inline, "{%s}docPr" % NS["wp"], id="1", name="Text Box 1")
    graphic = etree.SubElement(inline, "{%s}graphic" % NS["a"], nsmap={"a": NS["a"]})
    gdata = etree.SubElement(graphic, "{%s}graphicData" % NS["a"], uri=NS["wps"])
    wsp = etree.SubElement(gdata, "{%s}wsp" % NS["wps"], nsmap={"wps": NS["wps"]})
    etree.SubElement(wsp, "{%s}cNvSpPr" % NS["wps"], txBox="1")
    sppr = etree.SubElement(wsp, "{%s}spPr" % NS["wps"])
    xfrm = etree.SubElement(sppr, "{%s}xfrm" % NS["a"])
    etree.SubElement(xfrm, "{%s}off" % NS["a"], x="0", y="0")
    etree.SubElement(xfrm, "{%s}ext" % NS["a"], cx="1828800", cy="914400")
    geom = etree.SubElement(sppr, "{%s}prstGeom" % NS["a"], prst="rect")
    etree.SubElement(geom, "{%s}avLst" % NS["a"])
    txbx = etree.SubElement(wsp, "{%s}txbx" % NS["wps"])
    content = etree.SubElement(txbx, w("txbxContent"))
    tp = etree.SubElement(content, w("p"))
    tp.append(make_run("テキストボックス内の文字 {office_name}"))
    etree.SubElement(wsp, "{%s}bodyPr" % NS["wps"])
    set_document(entries, root)
    return rezip(entries)


def fx_comments() -> bytes:
    entries = doc_entries(base_document())
    comments = etree.Element(w("comments"), nsmap={"w": NS["w"]})
    c = etree.SubElement(comments, w("comment"))
    c.set(w("id"), "0")
    c.set(w("author"), "fixture")
    c.set(w("date"), FIXED_DATE)
    c.set(w("initials"), "fx")
    cp = etree.SubElement(c, w("p"))
    cp.append(make_run("所内コメント（公開前に除去すべき）"))
    entries["word/comments.xml"] = xml_bytes(comments)
    add_override(entries, "/word/comments.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml")
    add_relationship(entries, RT + "comments", "comments.xml")
    root = document_root(entries)
    p = first_paragraph(root)
    runs = p.findall(w("r"))
    start = etree.Element(w("commentRangeStart"))
    start.set(w("id"), "0")
    end = etree.Element(w("commentRangeEnd"))
    end.set(w("id"), "0")
    runs[0].addprevious(start)
    runs[-1].addnext(end)
    ref_run = etree.Element(w("r"))
    ref = etree.SubElement(ref_run, w("commentReference"))
    ref.set(w("id"), "0")
    end.addnext(ref_run)
    set_document(entries, root)
    return rezip(entries)


def fx_footnotes() -> bytes:
    entries = doc_entries(base_document())
    fn = etree.Element(w("footnotes"), nsmap={"w": NS["w"]})
    for fid, ftype in (("-1", "separator"), ("0", "continuationSeparator")):
        f = etree.SubElement(fn, w("footnote"))
        f.set(w("type"), ftype)
        f.set(w("id"), fid)
        fp = etree.SubElement(f, w("p"))
        fr = etree.SubElement(fp, w("r"))
        etree.SubElement(fr, w("separator") if ftype == "separator" else w("continuationSeparator"))
    f = etree.SubElement(fn, w("footnote"))
    f.set(w("id"), "1")
    fp = etree.SubElement(f, w("p"))
    fr = etree.SubElement(fp, w("r"))
    rpr = etree.SubElement(fr, w("rPr"))
    va = etree.SubElement(rpr, w("vertAlign"))
    va.set(w("val"), "superscript")
    etree.SubElement(fr, w("footnoteRef"))
    fp.append(make_run(" 脚注本文（fixture）"))
    entries["word/footnotes.xml"] = xml_bytes(fn)
    add_override(entries, "/word/footnotes.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml")
    add_relationship(entries, RT + "footnotes", "footnotes.xml")
    root = document_root(entries)
    p = first_paragraph(root)
    r = etree.SubElement(p, w("r"))
    rpr = etree.SubElement(r, w("rPr"))
    va = etree.SubElement(rpr, w("vertAlign"))
    va.set(w("val"), "superscript")
    ref = etree.SubElement(r, w("footnoteReference"))
    ref.set(w("id"), "1")
    set_document(entries, root)
    return rezip(entries)


def fx_tracked_changes() -> bytes:
    entries = doc_entries(base_document())
    root = document_root(entries)
    p = first_paragraph(root)
    ins = etree.SubElement(p, w("ins"))
    ins.set(w("id"), "1")
    ins.set(w("author"), "fixture")
    ins.set(w("date"), FIXED_DATE)
    ins.append(make_run("挿入された文"))
    dele = etree.SubElement(p, w("del"))
    dele.set(w("id"), "2")
    dele.set(w("author"), "fixture")
    dele.set(w("date"), FIXED_DATE)
    dr = etree.SubElement(dele, w("r"))
    dt = etree.SubElement(dr, w("delText"))
    dt.text = "削除された文"
    set_document(entries, root)
    return rezip(entries)


def fx_multiple_sections() -> bytes:
    doc = base_document()
    doc.add_section()
    doc.add_paragraph("２つ目のセクション {office_name}")
    entries = doc_entries(doc)
    assert entries["word/document.xml"].count(b"<w:sectPr") == 2
    return rezip(entries)


def fx_external_rel() -> bytes:
    entries = doc_entries(base_document())
    rid = add_relationship(entries, RT + "image", "http://example.invalid/x.png", external=True)
    root = document_root(entries)
    p = first_paragraph(root)
    r = etree.SubElement(p, w("r"))
    drawing = etree.SubElement(r, w("drawing"))
    inline = etree.SubElement(drawing, "{%s}inline" % NS["wp"], distT="0", distB="0", distL="0", distR="0")
    etree.SubElement(inline, "{%s}extent" % NS["wp"], cx="914400", cy="914400")
    etree.SubElement(inline, "{%s}docPr" % NS["wp"], id="2", name="external image")
    graphic = etree.SubElement(inline, "{%s}graphic" % NS["a"], nsmap={"a": NS["a"]})
    gdata = etree.SubElement(graphic, "{%s}graphicData" % NS["a"], uri=NS["pic"])
    pic = etree.SubElement(gdata, "{%s}pic" % NS["pic"], nsmap={"pic": NS["pic"]})
    nv = etree.SubElement(pic, "{%s}nvPicPr" % NS["pic"])
    etree.SubElement(nv, "{%s}cNvPr" % NS["pic"], id="0", name="x.png")
    etree.SubElement(nv, "{%s}cNvPicPr" % NS["pic"])
    bf = etree.SubElement(pic, "{%s}blipFill" % NS["pic"])
    blip = etree.SubElement(bf, "{%s}blip" % NS["a"])
    blip.set("{%s}link" % NS["r"], rid)
    st = etree.SubElement(bf, "{%s}stretch" % NS["a"])
    etree.SubElement(st, "{%s}fillRect" % NS["a"])
    sppr = etree.SubElement(pic, "{%s}spPr" % NS["pic"])
    xfrm = etree.SubElement(sppr, "{%s}xfrm" % NS["a"])
    etree.SubElement(xfrm, "{%s}off" % NS["a"], x="0", y="0")
    etree.SubElement(xfrm, "{%s}ext" % NS["a"], cx="914400", cy="914400")
    geom = etree.SubElement(sppr, "{%s}prstGeom" % NS["a"], prst="rect")
    etree.SubElement(geom, "{%s}avLst" % NS["a"])
    set_document(entries, root)
    return rezip(entries)


def fx_ole() -> bytes:
    entries = doc_entries(base_document())
    # 埋込 OLE（ダミー: OLE2 compound file のシグネチャ + 0 埋め）
    entries["word/embeddings/oleObject1.bin"] = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 504
    add_default(entries, "bin", "application/vnd.openxmlformats-officedocument.oleObject")
    rid_ole = add_relationship(entries, RT + "oleObject", "embeddings/oleObject1.bin")
    entries["word/media/image1.png"] = tiny_png()
    add_default(entries, "png", "image/png")
    rid_img = add_relationship(entries, RT + "image", "media/image1.png")
    root = document_root(entries)
    p = first_paragraph(root)
    r = etree.SubElement(p, w("r"))
    obj = etree.SubElement(r, w("object"))
    obj.set(w("dxaOrig"), "1440")
    obj.set(w("dyaOrig"), "1440")
    shape = etree.SubElement(obj, "{%s}shape" % NS["v"], nsmap={"v": NS["v"], "o": NS["o"]})
    shape.set("id", "_x0000_i1025")
    shape.set("type", "#_x0000_t75")
    shape.set("style", "width:72pt;height:72pt")
    shape.set("{%s}ole" % NS["o"], "")
    img = etree.SubElement(shape, "{%s}imagedata" % NS["v"])
    img.set("{%s}id" % NS["r"], rid_img)
    img.set("{%s}title" % NS["o"], "")
    ole = etree.SubElement(obj, "{%s}OLEObject" % NS["o"], nsmap={"o": NS["o"]})
    ole.set("Type", "Embed")
    ole.set("ProgID", "Package")
    ole.set("ShapeID", "_x0000_i1025")
    ole.set("DrawAspect", "Content")
    ole.set("ObjectID", "_1")
    ole.set("{%s}id" % NS["r"], rid_ole)
    set_document(entries, root)
    return rezip(entries)


def fx_unsupported_field() -> bytes:
    entries = doc_entries(base_document())
    root = document_root(entries)
    p = first_paragraph(root)
    fld = etree.SubElement(p, w("fldSimple"))
    fld.set(w("instr"), 'INCLUDETEXT "C:\\\\fixtures\\\\inc.docx"')
    fld.append(make_run("（取り込まれるテキスト）"))
    set_document(entries, root)
    return rezip(entries)


def fx_vmerge_in_loop() -> bytes:
    doc = base_document(paragraphs=["{office_name}"])
    t = doc.add_table(rows=3, cols=2)
    t.style = doc.styles["Table Grid"]
    t.rows[0].cells[0].text = "区分"
    t.rows[0].cells[1].text = "内容"
    t.rows[1].cells[0].text = "{#rows}{a}"
    t.rows[1].cells[1].text = "{b}{/rows}"
    t.rows[2].cells[0].text = ""
    t.rows[2].cells[1].text = "（縦結合の続き）"
    # 繰返し行の先頭セルを vMerge restart、次の行を continue にする（繰返し行を跨ぐ縦結合）
    tc1 = t.rows[1].cells[0]._tc
    tcpr1 = tc1.get_or_add_tcPr()
    vm1 = OxmlElement("w:vMerge")
    vm1.set(qn("w:val"), "restart")
    tcpr1.append(vm1)
    tc2 = t.rows[2].cells[0]._tc
    tcpr2 = tc2.get_or_add_tcPr()
    tcpr2.append(OxmlElement("w:vMerge"))
    return rezip(doc_entries(doc))


def fx_paragraph_spanning_tag() -> bytes:
    return rezip(doc_entries(base_document(paragraphs=["{office_", "name}", "{recipient_name}{recipient_honorific}"])))


def fx_unbalanced_loop() -> bytes:
    return rezip(doc_entries(base_document(paragraphs=["{#rows}", "{a}", "{office_name}"])))


def fx_dot_tag() -> bytes:
    return rezip(doc_entries(base_document(paragraphs=["{a.b}", "{office_name}"])))


def fx_dangerous_key() -> bytes:
    return rezip(doc_entries(base_document(paragraphs=["{__proto__}", "{office_name}"])))


def fx_expression_tag() -> bytes:
    return rezip(doc_entries(base_document(paragraphs=["{office_name | upper}", "{recipient_name}"])))


def fx_macro_enabled() -> bytes:
    entries = doc_entries(base_document())
    add_override(entries, "/word/document.xml", CT_MACRO_MAIN)
    entries["word/vbaProject.bin"] = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 504  # ダミーの OLE2 ヘッダ
    add_override(entries, "/word/vbaProject.bin", "application/vnd.ms-office.vbaProject")
    add_relationship(entries, "http://schemas.microsoft.com/office/2006/relationships/vbaProject", "vbaProject.bin")
    return rezip(entries)


def fx_zip_bomb() -> bytes:
    """[Content_Types] と document.xml は正常だが、50MB の 0 埋め entry を含む（圧縮率 > 100 倍）。"""
    entries = doc_entries(base_document(paragraphs=["{office_name}"], header=False))
    entries["word/media/bomb.bin"] = bytes(50 * 1024 * 1024)
    add_default(entries, "bin", "application/octet-stream")
    data = rezip(entries)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        total_uncompressed = sum(i.file_size for i in z.infolist())
        total_compressed = sum(i.compress_size for i in z.infolist())
    assert total_uncompressed / max(1, total_compressed) > 100, (total_uncompressed, total_compressed)
    assert len(data) < 200 * 1024, len(data)
    return data


def fx_fake_mime() -> bytes:
    return tiny_png()


DOCX_FIXTURES: dict[str, Any] = {
    "docx/split_run_tags.docx": fx_split_run_tags,
    "docx/zip_bomb.docx": fx_zip_bomb,
    "docx/fake_mime.docx": fx_fake_mime,
    "docx/forbidden/clean_minimal.docx": fx_clean_minimal,
    "docx/forbidden/with_textbox.docx": fx_textbox,
    "docx/forbidden/with_comments.docx": fx_comments,
    "docx/forbidden/with_footnotes.docx": fx_footnotes,
    "docx/forbidden/with_tracked_changes.docx": fx_tracked_changes,
    "docx/forbidden/with_multiple_sections.docx": fx_multiple_sections,
    "docx/forbidden/with_external_rel.docx": fx_external_rel,
    "docx/forbidden/with_ole.docx": fx_ole,
    "docx/forbidden/with_unsupported_field.docx": fx_unsupported_field,
    "docx/forbidden/with_vmerge_in_loop.docx": fx_vmerge_in_loop,
    "docx/forbidden/with_paragraph_spanning_tag.docx": fx_paragraph_spanning_tag,
    "docx/forbidden/with_unbalanced_loop.docx": fx_unbalanced_loop,
    "docx/forbidden/with_dot_tag.docx": fx_dot_tag,
    "docx/forbidden/with_dangerous_key.docx": fx_dangerous_key,
    "docx/forbidden/with_expression_tag.docx": fx_expression_tag,
    "docx/forbidden/macro_enabled.docm": fx_macro_enabled,
}

# 各 fixture が「ちょうど 1 種類」の禁止要素を含むことの自己検査（部分文字列 → 期待する fixture 名）
FORBIDDEN_MARKERS: dict[str, tuple[str, str]] = {
    "with_textbox": ("word/document.xml", "w:txbxContent"),
    "with_comments": ("word/document.xml", "w:commentRangeStart"),
    "with_footnotes": ("word/document.xml", "w:footnoteReference"),
    "with_tracked_changes": ("word/document.xml", "<w:ins "),
    "with_external_rel": ("word/_rels/document.xml.rels", 'TargetMode="External"'),
    "with_ole": ("word/document.xml", "o:OLEObject"),
    "with_unsupported_field": ("word/document.xml", "INCLUDETEXT"),
    "with_vmerge_in_loop": ("word/document.xml", "w:vMerge"),
    "macro_enabled": ("[Content_Types].xml", "macroEnabled"),
}


def check_forbidden_isolation(name: str, data: bytes) -> list[str]:
    """forbidden/ 配下: 自分のマーカーだけを含み、他 fixture のマーカーを含まない。"""
    problems: list[str] = []
    if name.endswith("fake_mime.docx"):
        return problems
    entries = unzip(data)
    stem = Path(name).stem
    texts = {k: v.decode("utf-8", "replace") for k, v in entries.items() if k.endswith(".xml") or k.endswith(".rels")}
    for key, (part, marker) in FORBIDDEN_MARKERS.items():
        present = marker in texts.get(part, "")
        if key == stem and not present:
            problems.append(f"{name}: expected marker {marker!r} missing")
        if key != stem and present:
            problems.append(f"{name}: unexpected marker {marker!r} from {key}")
    sect = texts.get("word/document.xml", "").count("<w:sectPr")
    if stem == "with_multiple_sections" and sect != 2:
        problems.append(f"{name}: sectPr count {sect}")
    if stem != "with_multiple_sections" and sect != 1 and "word/document.xml" in texts:
        problems.append(f"{name}: sectPr count {sect}")
    for part in ("word/comments.xml", "word/footnotes.xml", "word/vbaProject.bin"):
        has = part in entries
        expected = (stem == "with_comments" and part.endswith("comments.xml")) or (stem == "with_footnotes" and part.endswith("footnotes.xml")) or (stem == "macro_enabled" and part.endswith("vbaProject.bin"))
        if has != expected:
            problems.append(f"{name}: part {part} present={has}")
    if stem == "macro_enabled":
        # python-docx は macroEnabled の main part を拒否する（それ自体が期待どおりの検出）。ZIP として開けることだけ確認する。
        assert "word/vbaProject.bin" in entries
    else:
        try:
            Document(io.BytesIO(data))
        except Exception as e:  # noqa: BLE001
            problems.append(f"{name}: python-docx cannot open: {e}")
    return problems


# ---------------------------------------------------------------------------
# unicode_cases.json / unicode_fixture.txt
#   expectedSearchKey は手書き（独立した期待値）。normalization_reference.py --check で検算する。
# ---------------------------------------------------------------------------
UNICODE_CASES: list[tuple[str, str, str, str | None, str]] = [
    # id, raw, expectedSearchKey, mustNotEqualKeyOf, note
    ("fullwidth_alnum", "ＡＢＣ１２３", "abc123", None, "全角英数字(U+FF21..)→ASCII 小文字。ascii_alnum と同じキー"),
    ("ascii_alnum", "ABC123", "abc123", None, "ASCII 大文字→小文字"),
    ("halfwidth_kana_voiced", "ｶﾞ", "ガ", None, "半角カナ U+FF76 + 半角濁点 U+FF9E の区間だけ NFKC → ガ U+30AC"),
    ("fullwidth_katakana_ga", "ガ", "ガ", None, "全角カナはそのまま。halfwidth_kana_voiced と同じキー"),
    ("hiragana_combining_dakuten", "か\u3099", "か\u3099", "hiragana_precomposed_ga", "か U+304B + 結合濁点 U+3099。NFC/NFKC を行わないので が U+304C に合成しない"),
    ("hiragana_precomposed_ga", "が", "が", None, "合成済み が U+304C"),
    ("circled_one", "①", "①", "ascii_one", "丸数字 U+2460 を 1 に畳まない（NFKC なら 1 になる）"),
    ("ascii_one", "1", "1", None, "ASCII 数字"),
    ("roman_numeral_one", "Ⅰ", "Ⅰ", "ascii_letter_i", "ローマ数字 U+2160 を I に畳まない（NFKC なら I になる）"),
    ("ascii_letter_i", "I", "i", None, "ASCII 大文字 I → i"),
    ("square_kabushiki", "㈱", "㈱", "paren_kabu_ascii", "U+3231 を (株) に畳まない（NFKC なら (株) になる）"),
    ("paren_kabu_ascii", "(株)", "(株)", None, "ASCII 括弧"),
    ("paren_kabu_fullwidth", "（株）", "(株)", "square_kabushiki", "全角丸括弧 U+FF08/U+FF09 → ASCII 括弧。paren_kabu_ascii と同じキーだが ㈱ とは異なる"),
    ("takahashi_variant", "髙橋", "髙橋", "takahashi_standard", "髙 U+9AD9（はしごだか）を 高 U+9AD8 に畳まない"),
    ("takahashi_standard", "高橋", "高橋", None, "高 U+9AD8"),
    ("saki_variant", "﨑", "﨑", "saki_standard", "﨑 U+FA11（CJK 互換漢字・分解なし）を 崎 U+5D0E に畳まない。別名辞書は明示登録のみ"),
    ("saki_standard", "崎", "崎", None, "崎 U+5D0E"),
    ("yoshi_sip", "𠮷", "𠮷", "yoshi_standard", "𠮷 U+20BB7（SIP・UTF-16 ではサロゲートペア）を 吉 U+5409 に畳まない。分割もしない"),
    ("yoshi_standard", "吉", "吉", None, "吉 U+5409"),
    ("katsu_ivs", "葛\U000E0100", "葛\U000E0100", "katsu_plain", "葛 U+845B + IVS U+E0100。異体字セレクタを削除しない"),
    ("katsu_plain", "葛", "葛", None, "葛 U+845B のみ"),
    ("ideographic_space_between", "佐藤　一郎", "佐藤 一郎", None, "U+3000 → U+0020。ascii_space_between と同じキー"),
    ("ascii_space_between", "佐藤 一郎", "佐藤 一郎", None, "ASCII 空白 1 つ"),
    ("dash_fullwidth_hyphen_minus", "－", "－", "dash_katakana_prolonged", "U+FF0D FULLWIDTH HYPHEN-MINUS は全角英数字の範囲外なので変換しない"),
    ("dash_katakana_prolonged", "ー", "ー", "dash_minus_sign", "U+30FC 長音記号"),
    ("dash_minus_sign", "−", "−", "dash_horizontal_bar", "U+2212 MINUS SIGN"),
    ("dash_horizontal_bar", "―", "―", "dash_fullwidth_hyphen_minus", "U+2015 HORIZONTAL BAR"),
    ("dash_em", "—", "—", "dash_horizontal_bar", "U+2014 EM DASH（cp932 では encode 不能）"),
    ("wave_dash", "〜", "〜", "fullwidth_tilde", "U+301C WAVE DASH"),
    ("fullwidth_tilde", "～", "～", None, "U+FF5E FULLWIDTH TILDE は変換しない（NFKC なら ~ になる）"),
    ("yen_sign", "¥", "¥", "backslash", "U+00A5 YEN SIGN"),
    ("backslash", "\\", "\\", None, "U+005C REVERSE SOLIDUS"),
    ("fullwidth_yen", "￥", "￥", "yen_sign", "U+FFE5 FULLWIDTH YEN SIGN は変換しない"),
    ("reiwa_gannen_valid_start", "令和元年５月１日", "令和元年5月1日", None, "令和の開始日 2019-05-01。全角数字のみ ASCII 化、元年は文字列のまま"),
    ("reiwa_gannen_invalid_boundary", "令和元年４月３０日", "令和元年4月30日", None, "元号境界の不整合例（令和は 2019-05-01 開始）。検索キーは正誤を判定しない"),
    ("heisei31_invalid_boundary", "平成３１年５月１日", "平成31年5月1日", None, "元号境界の不整合例（平成は 2019-04-30 まで）"),
    ("reiwa_approximate_year", "令和８年頃", "令和8年頃", None, "「頃」は precision=year の候補。キー化では文字列のまま"),
    ("evidence_branch_label_fullwidth", "甲第３号証の１", "甲第3号証の1", None, "証拠枝番。3.1 の浮動小数にしない。evidence_branch_label_ascii と同じキー"),
    ("evidence_branch_label_ascii", "甲第3号証の1", "甲第3号証の1", None, "ASCII 数字の枝番"),
    ("evidence_label_otsu", "乙第１０号証", "乙第10号証", None, "乙号証・2 桁"),
    ("leading_zero_fullwidth", "０１２", "012", None, "先頭 0 を保持。leading_zero_ascii と同じキー"),
    ("leading_zero_ascii", "012", "012", "twelve", "012 ≠ 12（先頭 0 を数値化しない）"),
    ("twelve", "１２", "12", None, "全角 １２ → 12"),
    ("case_number_leading_zero", "令和８年（ワ）第００１２号", "令和8年(ワ)第0012号", None, "事件番号は文字列。括弧は ASCII 化、先頭 0 は保持"),
    ("surrounding_ideographic_space", "　前後空白　", "前後空白", None, "前後の U+3000 は trim（検索キーのみ。原文は保持）"),
    ("mixed_whitespace_collapse", "  佐藤 　 一郎  ", "佐藤 一郎", None, "連続空白（ASCII 空白と U+3000 の混在）を 1 つにまとめ、前後を trim"),
    ("tab_collapse", "佐藤\t一郎", "佐藤 一郎", None, "TAB U+0009 は ASCII 空白として 1 つの U+0020 に"),
    ("nbsp_not_collapsed", "佐藤\u00a0一郎", "佐藤\u00a0一郎", "ascii_space_between", "U+00A0 NO-BREAK SPACE は ASCII 空白ではないので変換しない"),
    ("halfwidth_kana_run_with_space", "ﾀﾅｴ ﾋﾞﾙ", "タナエ ビル", None, "半角カナ区間 + ASCII 空白 + 半角カナ区間"),
    ("halfwidth_kana_handakuten", "ﾊﾟﾋﾞ", "パビ", None, "半濁点 U+FF9F / 濁点 U+FF9E"),
    ("halfwidth_kana_u_voiced", "ｳﾞ", "ヴ", None, "ｳ U+FF73 + ﾞ → ヴ U+30F4"),
    ("halfwidth_prolonged_mark", "ｺｰﾋｰ", "コーヒー", None, "半角長音 U+FF70 → ー U+30FC"),
    ("lone_halfwidth_dakuten", "ﾞ", "\u3099", None, "単独の半角濁点 U+FF9E は NFKC で結合濁点 U+3099 になる（TS 実装と同じ）"),
    ("fullwidth_mixed_case", "ＴｏＫｙＯ", "tokyo", None, "全角英字の大小混在"),
    ("ascii_url_lowercased", "HTTPS://Example.COM/Path", "https://example.com/path", None, "大文字→小文字は URL にも及ぶ（検索キーのみ。原文は保持）"),
    ("fullwidth_paren_colon", "（旧姓：田中）", "(旧姓：田中)", None, "全角コロン U+FF1A は変換しない"),
    ("fullwidth_symbols_not_folded", "＠＃％", "＠＃％", None, "全角記号 U+FF20/U+FF03/U+FF05 は範囲外"),
    ("emoji_zwj", "👨\u200d👩\u200d👧", "👨\u200d👩\u200d👧", None, "ZWJ 列を分割しない"),
    ("halfwidth_kana_with_fullwidth_alnum", "ｶﾌﾟｾﾙＡ１", "カプセルa1", None, "半角カナ区間と全角英数字の混在"),
    ("long_name_30_graphemes", "一般社団法人全国中小企業取引適正化推進協議会関東甲信越支部事務局", "一般社団法人全国中小企業取引適正化推進協議会関東甲信越支部事務局", None, "31 grapheme の長い名称。変更なし"),
]


def unicode_cases_json() -> bytes:
    cases = []
    for cid, raw, key, other, note in UNICODE_CASES:
        c: dict[str, Any] = {"id": cid, "raw": raw, "expectedSearchKey": key}
        if other:
            c["mustNotEqualKeyOf"] = other
        c["note"] = note
        cases.append(c)
    ids = [c["id"] for c in cases]
    assert len(ids) == len(set(ids))
    for c in cases:
        if "mustNotEqualKeyOf" in c:
            assert c["mustNotEqualKeyOf"] in ids, c
    return (json.dumps(cases, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def unicode_fixture_txt() -> bytes:
    header = [
        "# unicode_fixture.txt — RayLaw 検索キー ver1 / 原文保持（§19 U08）の fixture",
        "# エンコード: UTF-8（BOM なし）。改行は LF（U+000A）のみ。CRLF は使用しない。",
        "# '#' で始まる行はコメント。残りの各行は tests/fixtures/unicode_cases.json の raw を同じ順序で 1 行ずつ収めたもの。",
        "# 各行の bytes は save → reload → JSON/TXT export で 1 バイトも変わってはならない（先頭/末尾の空白・全角空白・TAB・結合文字・IVS を含む）。",
        "# エディタの trailing-whitespace 削除や改行コード変換を適用してはならない。",
    ]
    lines = header + [raw for _, raw, _, _, _ in UNICODE_CASES]
    for raw in (r for _, r, _, _, _ in UNICODE_CASES):
        assert "\n" not in raw and "\r" not in raw and not raw.startswith("#"), raw
    data = ("\n".join(lines) + "\n").encode("utf-8")
    assert b"\r" not in data
    return data


# ---------------------------------------------------------------------------
# CSV fixtures
# ---------------------------------------------------------------------------
CONTACT_COLUMNS = ["external_id", "type", "name_raw", "kana", "organization_name_raw", "address_raw", "postcode_raw", "phone_raw", "email_raw"]
MATTER_COLUMNS = ["external_id", "title_raw", "case_number_raw", "court_raw", "status", "scope_raw"]
PARTY_COLUMNS = ["matter_external_id", "contact_external_id", "role"]

CONTACT_ROWS_UTF8 = [
    ["C001", "lawyer", "佐藤　一郎", "サトウ　イチロウ", "さくら総合法律事務所", "東京都港区虎ノ門二丁目２番２号　虎ノ門デモビル３階", "１０５－０００１", "０３－００００－０１０１", "sato.a@sakura-law.example"],
    ["C002", "lawyer", "佐藤　一郎", "サトウ　イチロウ", "港中央法律事務所", "神奈川県横浜市中区日本大通１２番地　港デモ会館７階", "２３１－００２１", "０４５－０００－０２０２", "sato.b@minato-law.example"],
    ["C003", "organization", "株式会社ミドリ商事", "ミドリショウジ", "", "東京都中央区日本橋デモ町一丁目２番３号", "１０３－００２７", "０３－００００－０２０１", "info@midori.example"],
    ["C004", "organization", "髙﨑産業株式会社", "タカサキサンギョウ", "", "埼玉県さいたま市大宮区デモ本町四丁目５番６号　髙﨑ビル２階", "３３０－０８４６", "０４８－０００－０３０３", "info@takasaki.example"],
    ["C005", "person", "髙橋　﨑太郎", "ﾀｶﾊｼ ｻｷﾀﾛｳ", "㈱テスト①号店", "東京都新宿区西新宿デモ二丁目８番１号　デモタワー３０階", "１６３－８００１", "０９０－００００－０００５", "takahashi@example.invalid"],
    ["C006", "person", "𠮷田　葛\U000E0100男", "ヨシダ　カツオ", "", "大阪府大阪市北区デモ町１－２－３〜５（¥記号テスト）", "５３０－０００１", "０６－００００－０００６", "yoshida@example.invalid"],
    ["C007", "organization", "一般社団法人全国中小企業取引適正化推進協議会関東甲信越支部事務局", "ゼンコクチュウショウキギョウトリヒキテキセイカスイシンキョウギカイ", "", "東京都千代田区デモ町０１２番地", "１０１－０００１", "０３－００００－０００７", "office@kyogikai.example"],
]
# cp932 で strict に encode できる文字だけ（𠮷・IVS・¥(U+00A5)・〜(U+301C) を含む行を除き、髙 ① 﨑 ㈱ Ⅰ は含める）
CONTACT_ROWS_CP932 = [
    CONTACT_ROWS_UTF8[0], CONTACT_ROWS_UTF8[1], CONTACT_ROWS_UTF8[2], CONTACT_ROWS_UTF8[3], CONTACT_ROWS_UTF8[4],
    ["C008", "person", "渡邊　Ⅰ郎", "ワタナベ　イチロウ", "㈱デモ髙島屋①", "東京都台東区デモ１－１－１", "１１０－０００１", "０３－００００－０００８", "watanabe@example.invalid"],
]


def csv_bytes(columns: list[str], rows: list[list[str]], encoding: str, bom: bool, lineterminator: str = "\r\n") -> bytes:
    buf = io.StringIO()
    wr = csv.writer(buf, lineterminator=lineterminator, quoting=csv.QUOTE_MINIMAL)
    wr.writerow(columns)
    for r in rows:
        assert len(r) == len(columns), r
        wr.writerow(r)
    data = buf.getvalue().encode(encoding, errors="strict")
    if bom:
        data = b"\xef\xbb\xbf" + data
    return data


def csv_fixtures() -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    out["csv/contacts_utf8_bom.csv"] = csv_bytes(CONTACT_COLUMNS, CONTACT_ROWS_UTF8, "utf-8", True)
    out["csv/contacts_cp932.csv"] = csv_bytes(CONTACT_COLUMNS, CONTACT_ROWS_CP932, "cp932", False)
    # cp932 の往復確認（strict decode で元に戻る）
    assert out["csv/contacts_cp932.csv"].decode("cp932", errors="strict").startswith("external_id")
    out["csv/contacts_formula_injection.csv"] = csv_bytes(CONTACT_COLUMNS, [
        ["F001", "person", "=1+1", "イコール", "", "東京都", "１００－０００１", "", ""],
        ["F002", "person", "+1234", "プラス", "", "東京都", "１００－０００１", "", ""],
        ["F003", "person", "-5", "マイナス", "", "東京都", "１００－０００１", "", ""],
        ["F004", "person", "@SUM(A1:A9)", "アット", "", "東京都", "１００－０００１", "", ""],
        ["F005", "person", "\t=cmd|' /C calc'!A0", "タブ始まり", "", "東京都", "１００－０００１", "", ""],
        ["F006", "organization", "=HYPERLINK(\"http://example.invalid\",\"click\")", "ハイパーリンク", "", "東京都", "１００－０００１", "", ""],
        ["F007", "person", "－山田（全角ハイフン始まり・式ではない）", "ヤマダ", "", "東京都", "１００－０００１", "", ""],
    ], "utf-8", True)
    out["csv/contacts_quoted_newlines.csv"] = csv_bytes(CONTACT_COLUMNS, [
        ["Q001", "organization", "株式会社デモ, 商事", "デモショウジ", "", "東京都千代田区１－１－１\nデモビル５階", "１００－０００１", "０３－００００－０００１", ""],
        ["Q002", "person", "佐藤 \"通称\" 一郎", "サトウ", "", "東京都千代田区２－２－２\r\nデモビル６階", "１００－０００２", "", ""],
        ["Q003", "person", "引用符なし", "", "", "住所,カンマ付き", "１００－０００３", "", ""],
    ], "utf-8", True)
    out["csv/contacts_dup_external_id.csv"] = csv_bytes(CONTACT_COLUMNS, [
        ["C001", "lawyer", "佐藤　一郎", "サトウ　イチロウ", "さくら総合法律事務所", "東京都港区虎ノ門二丁目２番２号", "１０５－０００１", "", ""],
        ["C002", "organization", "株式会社ミドリ商事", "ミドリショウジ", "", "東京都中央区日本橋デモ町一丁目２番３号", "１０３－００２７", "", ""],
        ["C001", "lawyer", "佐藤　一郎", "サトウ　イチロウ", "港中央法律事務所", "神奈川県横浜市中区日本大通１２番地", "２３１－００２１", "", ""],
    ], "utf-8", True)
    out["csv/matters_utf8.csv"] = csv_bytes(MATTER_COLUMNS, [
        ["M001", "売買代金請求事件（株式会社ミドリ商事）", "令和８年（ワ）第１２３４号", "東京地方裁判所", "active", "髙﨑産業株式会社に対する売買代金請求に関する交渉及び訴訟（サンプル）"],
        ["M002", "貸金返還請求事件（サンプル）", "令和８年（ワ）第００１２号", "横浜地方裁判所", "closed", "先頭 0 の事件番号を文字列として保持する"],
        ["M003", "交渉案件（事件番号なし・サンプル）", "", "", "archived", ""],
    ], "utf-8", False)
    out["csv/matter_parties_utf8.csv"] = csv_bytes(PARTY_COLUMNS, [
        ["M001", "C003", "client"],
        ["M001", "C004", "opponent"],
        ["M002", "C003", "client"],
        ["M002", "C999", "opponent"],  # 未登録の外部 ID → batch 全体を止める
        ["M003", "C005", "third_party"],
    ], "utf-8", False)
    bad = b"\xef\xbb\xbf" + ",".join(CONTACT_COLUMNS).encode("utf-8") + b"\r\n"
    bad += b"B001,person,\xff\xfe\x83\x41\x93\x63,," + "東京都".encode("utf-8") + b",,,\r\n"  # 不正な UTF-8（cp932 の bytes を混入）
    bad += b"B002,person," + "佐藤".encode("utf-8")[:-1] + b",,,,,,\r\n"  # 途中で切れたマルチバイト
    out["csv/contacts_bad_encoding.bin"] = bad
    return out


def cp932_report() -> list[str]:
    lines = []
    for ch in ["髙", "①", "﨑", "㈱", "Ⅰ", "𠮷", "\U000E0100", "¥", "〜", "～", "−", "－", "―", "—", "￥"]:
        try:
            enc = ch.encode("cp932")
            back = enc.decode("cp932")
            lines.append(f"cp932 {'U+%04X' % ord(ch)} {ch!r}: ok {enc.hex()}" + ("" if back == ch else f" (round-trip changes to {back!r} U+{ord(back):04X})"))
        except UnicodeEncodeError:
            lines.append(f"cp932 {'U+%04X' % ord(ch)} {ch!r}: FAIL (strict encode impossible)")
    return lines


# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="書き込まず差分の有無だけ報告する")
    ap.add_argument("--out", type=Path, default=HERE)
    a = ap.parse_args(argv)
    out: Path = a.out
    problems: list[str] = []
    statuses: list[tuple[str, str, int]] = []
    for rel, fn in DOCX_FIXTURES.items():
        data = fn()
        if rel.startswith("docx/forbidden/"):
            problems += check_forbidden_isolation(rel, data)
        statuses.append((rel, write_if_changed(out / rel, data, a.check), len(data)))
    for rel, data in csv_fixtures().items():
        statuses.append((rel, write_if_changed(out / rel, data, a.check), len(data)))
    statuses.append(("unicode_cases.json", write_if_changed(out / "unicode_cases.json", unicode_cases_json(), a.check), len(unicode_cases_json())))
    statuses.append(("unicode_fixture.txt", write_if_changed(out / "unicode_fixture.txt", unicode_fixture_txt(), a.check), len(unicode_fixture_txt())))
    print("== RayLaw test fixtures ==")
    for rel, st, size in statuses:
        print(f"{rel:50} {st:9} {size:>10,d} bytes")
    for line in cp932_report():
        print(line)
    for p in problems:
        print("ERROR:", p)
    changed = [r for r, st, _ in statuses if st != "unchanged"]
    print(f"files: {len(statuses)}  unicode cases: {len(UNICODE_CASES)}  errors: {len(problems)}  changed: {len(changed)}" + (" (idempotent: nothing to write)" if not changed else ""))
    if problems:
        return 1
    if a.check and changed:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
