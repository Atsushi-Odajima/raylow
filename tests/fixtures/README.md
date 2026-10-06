# tests/fixtures — テスト資料の索引（§19 U08 / AC05 / AC20 / AC21）

すべて `tests/fixtures/build_fixtures.py` が決定的に生成する（`python3 -I tests/fixtures/build_fixtures.py`、`--check` で差分検査のみ）。
架空データのみ。実在の人物・団体・事件とは無関係。

## Unicode / 検索キー ver1（§19 U02・U08）

| ファイル | 内容 |
|---|---|
| `unicode_cases.json` | 60 ケースの配列 `{id, raw, expectedSearchKey, mustNotEqualKeyOf?, note}`。期待値は手書き。ＡＢＣ１２３/ABC123、ｶﾞ/ガ、か+結合濁点/が、①/1、Ⅰ/I、㈱/(株)、髙橋/高橋、﨑/崎、𠮷/吉、葛+IVS/葛、全角空白、－/ー/−/―/—、〜/～、¥/\\/￥、令和元年境界（令和元年４月３０日・平成３１年５月１日）、証拠枝番「甲第３号証の１」、先頭 0「０１２」/「012」≠「12」、前後空白 trim、TAB・NBSP、半角カナ区間、ZWJ 絵文字、31 grapheme の長い名称 |
| `normalization_reference.py` | 検索キー ver1 の**独立した純 Python 再実装**（本番コードではない）。`--check unicode_cases.json` でキーを計算し不一致があれば非 0 終了。`--fixture unicode_fixture.txt` で TXT の往復一致も検査。NFKC は半角カナ区間にのみ使用し、①/㈱/Ⅰ が全文 NFKC なら変化することを assert して info 表示する（全文 NFKC を意図的に避けていることのレビュー用） |
| `unicode_fixture.txt` | UTF-8（BOM なし）・LF のみ。`#` コメント行の後に各 raw を 1 行ずつ。save → reload → export で bytes が変わらないこと（先頭/末尾の空白・全角空白・TAB・結合文字・IVS を含む） |

実行例:

```
python3 -I tests/fixtures/normalization_reference.py --check tests/fixtures/unicode_cases.json --fixture tests/fixtures/unicode_fixture.txt
python3 -I tests/fixtures/normalization_reference.py --self-test
```

## DOCX（§5.2 / AC05 / AC06 / AC20）

| ファイル | 内容 | 期待される結果 |
|---|---|---|
| `docx/split_run_tags.docx` | `{office_name}` を 3 run（`{off` 太字 / `ice_` 斜体 / `name}` 下線）に分割、`{recip`+`ient_name}` の分割、表の行ループ `{#attachments}{name}` / `{copies}{/attachments}`（`{#attach`+`ments}` も分割）、ヘッダー `{document_status_label}`。T01 のキーと互換 | 登録成功。分割 run を跨ぐタグを 1 タグとして検出し、表の行繰返しを認識する |
| `docx/zip_bomb.docx` | 正常な `[Content_Types].xml` / `document.xml` に加えて `word/media/bomb.bin`（展開後 50MB の 0 埋め、圧縮後 ~70KB）。圧縮率 > 100 倍 | **拒否**（展開後サイズ/圧縮率上限）。展開せずに `ZipInfo` の宣言サイズで判定する |
| `docx/fake_mime.docx` | 実体は 1×1 PNG | **拒否**（magic bytes / MIME / 拡張子の不整合） |

### `docx/forbidden/` — 禁止要素をちょうど 1 種類ずつ含む（inspector の個別試験用）

`build_fixtures.py` が、各ファイルが自分のマーカーだけを含み他のマーカーを含まないことを自己検査する。

| ファイル | 禁止要素 | 位置 |
|---|---|---|
| `clean_minimal.docx` | なし（対照群） | — |
| `with_textbox.docx` | `w:drawing` 内の `wps:txbx` → `w:txbxContent`（テキストボックス） | document.xml 1 段落目 |
| `with_comments.docx` | `word/comments.xml` part + `w:commentRangeStart/End` + `w:commentReference` | document.xml 1 段落目 |
| `with_footnotes.docx` | `word/footnotes.xml`（separator 2 件 + 実脚注 id=1）+ `w:footnoteReference w:id="1"` | document.xml 1 段落目 |
| `with_tracked_changes.docx` | `w:ins` と `w:del`（`w:delText`） | document.xml 1 段落目 |
| `with_multiple_sections.docx` | `w:sectPr` が 2 つ（段落内 sectPr + 本文末 sectPr） | document.xml |
| `with_external_rel.docx` | `document.xml.rels` に `TargetMode="External"` の image relationship（`http://example.invalid/x.png`）と、それを `a:blip r:link` で参照する `w:drawing` | rels + document.xml |
| `with_ole.docx` | `w:object` → `v:shape` + `o:OLEObject`（`word/embeddings/oleObject1.bin` を参照）。`v:imagedata` 用の小さな PNG も同梱（画像自体は許可要素） | document.xml 1 段落目 |
| `with_unsupported_field.docx` | `w:fldSimple w:instr='INCLUDETEXT "C:\\fixtures\\inc.docx"'`（PAGE 以外のフィールド） | document.xml 1 段落目 |
| `with_vmerge_in_loop.docx` | 行ループ `{#rows}{a}` / `{b}{/rows}` の繰返し行に `w:vMerge w:val="restart"`、次行に `w:vMerge`（繰返し行を跨ぐ縦結合） | 表 |
| `with_paragraph_spanning_tag.docx` | `{office_` と `name}` が別段落 | 段落 1–2 |
| `with_unbalanced_loop.docx` | `{#rows}` に対応する `{/rows}` がない | 段落 1 |
| `with_dot_tag.docx` | `{a.b}`（dot によるオブジェクト探索） | 段落 1 |
| `with_dangerous_key.docx` | `{__proto__}` | 段落 1 |
| `with_expression_tag.docx` | `{office_name \| upper}`（式・フィルタ） | 段落 1 |
| `macro_enabled.docm` | `[Content_Types].xml` の main part が `application/vnd.ms-word.document.macroEnabled.main+xml`、`word/vbaProject.bin`（ダミー）とその relationship | content types / part |

期待される結果: `clean_minimal.docx` 以外は登録を拒否し、理由と位置（part / 段落）および「Word 側で対応外要素を除いたコピーを保存」の手順を表示する。元ファイルは変更しない。

## CSV（§12 / AC21）

`csv/README.md` を参照（UTF-8 BOM / cp932 / 式注入 / 引用符内改行 / 外部 ID 競合 / 未登録参照 / 不正 encoding）。

## デモ書式

20 書式の架空デモ DOCX・schema・サンプル値は `templates/demo/`（`scripts/build_demo_templates.py`）。
