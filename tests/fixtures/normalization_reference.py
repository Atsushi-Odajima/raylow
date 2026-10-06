#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
normalization_reference.py — 検索キー ver1（§19 U02）の独立した検算用リファレンス実装

これは本番コード（packages/japanese-text/src/searchKey.ts）ではない。TypeScript 実装と同じ規則を
別言語で素直に書き直し、tests/fixtures/unicode_cases.json の期待値と突き合わせるための検算器である。

規則（固定・version 1）
  1. 全角 A-Z / a-z / 0-9（U+FF21-FF3A, U+FF41-FF5A, U+FF10-FF19）だけを ASCII へ
  2. ASCII 大文字を小文字へ
  3. 全角丸括弧 （ ）（U+FF08/U+FF09）を ASCII 括弧 ( ) へ
  4. U+3000（全角空白）を U+0020 へ
  5. 半角カナ（U+FF61-FF9F）は、1 文字＋直後に続く半角濁点/半濁点（U+FF9E/U+FF9F）を 1 区間として
     その区間だけ NFKC で全角カナへ。単独の半角濁点/半濁点もその 1 文字だけ NFKC。
  6. 連続する ASCII 空白（space, \\t, \\n, \\r, \\f, \\v。U+3000 は 4 で space になっている）を 1 つの
     U+0020 にまとめ、先頭・末尾の空白を落とす（検索キーだけに許される）。
上記以外は一切変更しない。全文 NFKC/NFC は意図的に行わない（①≠1、Ⅰ≠I、㈱≠(株)、髙≠高、﨑≠崎、
－≠ー≠−≠―、～≠〜、¥≠\\、結合濁点を合成しない、IVS を落とさない）。

使い方
  python3 -I tests/fixtures/normalization_reference.py --check tests/fixtures/unicode_cases.json
  python3 -I tests/fixtures/normalization_reference.py --check tests/fixtures/unicode_cases.json --fixture tests/fixtures/unicode_fixture.txt
  python3 -I tests/fixtures/normalization_reference.py --self-test
  python3 -I tests/fixtures/normalization_reference.py 'ＡＢＣ　ｶﾞ'      # キーとコードポイントを表示
終了コード: 0=一致, 1=不一致あり, 2=使い方の誤り
"""
from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path

SEARCH_KEY_VERSION = 1
ASCII_WHITESPACE = {" ", "\t", "\n", "\r", "\f", "\v"}


def _is_halfwidth_kana(cp: int) -> bool:
    return 0xFF61 <= cp <= 0xFF9F


def _is_halfwidth_voiced_mark(cp: int) -> bool:
    return cp in (0xFF9E, 0xFF9F)


def _map_code_point(cp: int) -> str:
    # 1. 全角英数字 → ASCII
    if (0xFF21 <= cp <= 0xFF3A) or (0xFF41 <= cp <= 0xFF5A) or (0xFF10 <= cp <= 0xFF19):
        cp -= 0xFEE0
    # 2. ASCII 大文字 → 小文字
    if 0x41 <= cp <= 0x5A:
        cp += 0x20
    # 3. 全角丸括弧
    if cp == 0xFF08:
        return "("
    if cp == 0xFF09:
        return ")"
    # 4. 全角空白
    if cp == 0x3000:
        return " "
    return chr(cp)


def segments_v1(text: str) -> list[str]:
    """原文を規則 1-5 で区間ごとの出力文字列に変換する（空白処理前）。"""
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        cp = ord(text[i])
        if _is_halfwidth_kana(cp) and not _is_halfwidth_voiced_mark(cp):
            j = i + 1
            while j < n and _is_halfwidth_voiced_mark(ord(text[j])):
                j += 1
            # 局所 NFKC: 半角カナ 1 文字 + 直後の濁点/半濁点だけ
            out.append(unicodedata.normalize("NFKC", text[i:j]))
            i = j
            continue
        if _is_halfwidth_voiced_mark(cp):
            out.append(unicodedata.normalize("NFKC", text[i]))
            i += 1
            continue
        out.append(_map_code_point(cp))
        i += 1
    return out


def search_key_v1(text: str) -> str:
    """検索キー ver1。原文は変更しない（戻り値は検索専用キー）。"""
    key: list[str] = []
    last_was_space = True  # 先頭空白を落とす
    for seg in segments_v1(text):
        if len(seg) == 1 and seg in ASCII_WHITESPACE:
            if last_was_space:
                continue
            key.append(" ")
            last_was_space = True
            continue
        key.append(seg)
        last_was_space = False
    s = "".join(key)
    if s.endswith(" "):
        s = s[:-1]
    return s


def codepoints(s: str) -> str:
    return " ".join(f"U+{ord(c):04X}" for c in s)


# --- NFKC を全体適用しないことの確認（情報表示） -------------------------------
NFKC_WOULD_CHANGE = ["①", "㈱", "Ⅰ", "ｶﾞ", "（", "Ａ"]
NFKC_WOULD_KEEP = ["髙", "﨑", "𠮷", "〜", "～", "¥"]


def nfkc_info() -> list[str]:
    lines = []
    for ch in NFKC_WOULD_CHANGE:
        n = unicodedata.normalize("NFKC", ch)
        assert n != ch, f"NFKC should change {ch!r}"
        lines.append(f"info: NFKC({ch!r} {codepoints(ch)}) = {n!r} {codepoints(n)} -> ver1 key = {search_key_v1(ch)!r} (全文NFKCは意図的に不採用)")
    for ch in NFKC_WOULD_KEEP:
        n = unicodedata.normalize("NFKC", ch)
        lines.append(f"info: NFKC({ch!r} {codepoints(ch)}) = {n!r} (NFKC では{'変化しない' if n == ch else '変化する'}) -> ver1 key = {search_key_v1(ch)!r}")
    # ①/㈱/Ⅰ は NFKC だと畳まれるが ver1 では畳まれないことを明示的に assert
    for ch, folded in (("①", "1"), ("㈱", "(株)"), ("Ⅰ", "I")):
        assert unicodedata.normalize("NFKC", ch) == folded, (ch, unicodedata.normalize("NFKC", ch))
        assert search_key_v1(ch) == ch, (ch, search_key_v1(ch))
    return lines


# --- 自己テスト（searchKey.test.ts と同じ期待値） -----------------------------
SELF_TESTS = [
    ("ＡＢＣ１２３", "abc123"),
    ("ABC123", "abc123"),
    ("ｶﾞ", "ガ"),
    ("ﾀﾅｶ ﾋﾞﾙ", "タナカ ビル"),
    ("①", "①"),
    ("Ⅰ", "Ⅰ"),
    ("㈱", "㈱"),
    ("髙橋", "髙橋"),
    ("﨑", "﨑"),
    ("－ー−―", "－ー−―"),
    ("～〜", "～〜"),
    ("¥\\", "¥\\"),
    ("が", "が"),
    ("（株）", "(株)"),
    ("佐藤　一郎", "佐藤 一郎"),
    ("  佐藤 　 一郎  ", "佐藤 一郎"),
    ("ＡＢ ｶﾞ 髙", "ab ガ 髙"),
]


def self_test() -> int:
    bad = 0
    for raw, expected in SELF_TESTS:
        got = search_key_v1(raw)
        ok = got == expected
        bad += 0 if ok else 1
        print(f"{'ok ' if ok else 'NG '} {raw!r} -> {got!r}" + ("" if ok else f" (expected {expected!r})"))
    for line in nfkc_info():
        print(line)
    print("self-test:", "PASS" if bad == 0 else f"FAIL ({bad})")
    return 0 if bad == 0 else 1


# --- unicode_cases.json の検算 ----------------------------------------------
REQUIRED_CASE_KEYS = {"id", "raw", "expectedSearchKey", "note"}
OPTIONAL_CASE_KEYS = {"mustNotEqualKeyOf"}


def check_cases(path: Path, fixture: Path | None) -> int:
    cases = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(cases, list) or not cases:
        print(f"error: {path} must be a non-empty JSON array", file=sys.stderr)
        return 2
    by_id: dict[str, dict] = {}
    failures = 0
    for c in cases:
        extra = set(c) - REQUIRED_CASE_KEYS - OPTIONAL_CASE_KEYS
        missing = REQUIRED_CASE_KEYS - set(c)
        if extra or missing:
            print(f"NG  {c.get('id')}: bad keys (missing={sorted(missing)} extra={sorted(extra)})")
            failures += 1
        if c["id"] in by_id:
            print(f"NG  duplicate id {c['id']}")
            failures += 1
        by_id[c["id"]] = c
    keys: dict[str, str] = {}
    for c in cases:
        got = search_key_v1(c["raw"])
        keys[c["id"]] = got
        ok = got == c["expectedSearchKey"]
        if not ok:
            failures += 1
        print(f"{'ok ' if ok else 'NG '} {c['id']:36} raw={c['raw']!r} [{codepoints(c['raw'])}]")
        print(f"      key={got!r} [{codepoints(got)}]" + ("" if ok else f"  expected={c['expectedSearchKey']!r} [{codepoints(c['expectedSearchKey'])}]"))
    for c in cases:
        other = c.get("mustNotEqualKeyOf")
        if other is None:
            continue
        if other not in by_id:
            print(f"NG  {c['id']}: mustNotEqualKeyOf references unknown id {other}")
            failures += 1
            continue
        if keys[c["id"]] == keys[other]:
            print(f"NG  {c['id']}: key {keys[c['id']]!r} must differ from {other}")
            failures += 1
        else:
            print(f"ok  {c['id']} ≠ {other}  ({keys[c['id']]!r} vs {keys[other]!r})")
    for line in nfkc_info():
        print(line)
    if fixture is not None:
        failures += check_fixture(fixture, cases)
    print(f"cases: {len(cases)}  failures: {failures}  -> {'PASS' if failures == 0 else 'FAIL'}")
    return 0 if failures == 0 else 1


def check_fixture(fixture: Path, cases: list[dict]) -> int:
    """unicode_fixture.txt: UTF-8（BOM なし）・LF のみ。'#' 行を除く各行が cases の raw と bytes 単位で一致する。"""
    data = fixture.read_bytes()
    failures = 0
    if data.startswith(b"\xef\xbb\xbf"):
        print("NG  fixture: UTF-8 BOM present")
        failures += 1
    if b"\r" in data:
        print("NG  fixture: CR found (CRLF must not be used)")
        failures += 1
    text = data.decode("utf-8")
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    body = [ln for ln in lines if not ln.startswith("#")]
    if len(body) != len(cases):
        print(f"NG  fixture: {len(body)} data lines but {len(cases)} cases")
        failures += 1
    for ln, c in zip(body, cases):
        if ln != c["raw"] or ln.encode("utf-8") != c["raw"].encode("utf-8"):
            print(f"NG  fixture line for {c['id']}: {ln!r} != {c['raw']!r}")
            failures += 1
    if failures == 0:
        print(f"ok  fixture {fixture.name}: {len(body)} lines round-trip byte-for-byte (no BOM, LF only)")
    return failures


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", metavar="JSON", type=Path, help="unicode_cases.json を検算する")
    ap.add_argument("--fixture", metavar="TXT", type=Path, help="--check と併用: unicode_fixture.txt の往復一致も検査する")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("text", nargs="*", help="キー化して表示する文字列")
    a = ap.parse_args(argv)
    if a.self_test:
        return self_test()
    if a.check:
        return check_cases(a.check, a.fixture)
    if a.fixture and not a.check:
        ap.error("--fixture requires --check")
    if not a.text:
        ap.print_help()
        return 2
    for t in a.text:
        k = search_key_v1(t)
        print(f"{t!r} [{codepoints(t)}]\n  -> {k!r} [{codepoints(k)}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
