# tests/fixtures/csv — インポート検証用 CSV（§12 / AC21）

`tests/fixtures/build_fixtures.py` が生成する（決定的・冪等）。すべて架空データ。

## 列定義

| ファイル群 | 列 |
|---|---|
| contacts | `external_id,type,name_raw,kana,organization_name_raw,address_raw,postcode_raw,phone_raw,email_raw`（`type` は `person` / `organization` / `lawyer`） |
| matters | `external_id,title_raw,case_number_raw,court_raw,status,scope_raw`（`status` は `active` / `archived` / `closed`） |
| matter_parties | `matter_external_id,contact_external_id,role`（`role` は `client` / `opponent` / `co_party` / `third_party`） |

行区切りは RFC 4180 どおり CRLF。引用が必要なセルだけ `"` で囲む（`csv.QUOTE_MINIMAL`）。

## 各ファイルと期待される結果

| ファイル | 内容 | 期待される結果 |
|---|---|---|
| `contacts_utf8_bom.csv` | UTF-8 **BOM 付き**。7 行。同姓同名の弁護士 2 名（C001/C002、所属が異なる）、髙・﨑・①・㈱・半角カナ（`ﾀｶﾊｼ ｳｳ`形式）、𠮷（U+20BB7）、葛+IVS（U+E0100）、〜（U+301C）、¥（U+00A5）、先頭 0 の番地「０１２」、31 grapheme の長い名称（C007） | 全行取込成功。BOM を除去し、原文（全角・異体字・IVS・半角カナ）をコードポイント不変で保存。C001 と C002 を名前で名寄せしない |
| `contacts_cp932.csv` | **cp932**（BOM なし）。6 行。髙（0xEEE0）・①（0x8740）・﨑（0xED95）・㈱（0x878A）・Ⅰ（0x8754）・半角カナを含む | 利用者が CP932 を選択すれば strict decode で全行成功。UTF-8 として読むと decode エラー（置換せず停止） |
| `contacts_formula_injection.csv` | `name_raw` が `=1+1` / `+1234` / `-5` / `@SUM(A1:A9)` / TAB 始まり（`\t=cmd...`）/ `=HYPERLINK(...)` の 6 行 + 全角ハイフン始まり「－山田…」1 行 | 取込は原文のまま保存（値を変えない）。**エクスポート時**に `=` `+` `-` `@` `\t` `\r` 始まりのセルへ式注入対策（先頭 `'` 付加または引用）を適用する。全角「－」始まりは ASCII の式先頭文字ではないので対策対象外（対策を適用しても原文保存側 JSON/TXT は無変更） |
| `contacts_quoted_newlines.csv` | 引用符内カンマ（`株式会社デモ, 商事`）、引用符のエスケープ（`佐藤 ""通称"" 一郎`）、引用符内の改行（LF と CRLF の 2 種）、`住所,カンマ付き` | RFC 4180 で 3 行として解釈。セル内改行はそのまま保持（LF/CRLF を正規化しない） |
| `contacts_dup_external_id.csv` | `C001` が 2 回、内容が異なる（所属・住所が別） | **競合エラー**。1 行のエラーで batch 全体を止め、何も commit しない |
| `matters_utf8.csv` | UTF-8（BOM なし）。3 行。先頭 0 の事件番号「令和８年（ワ）第００１２号」、事件番号・裁判所が空の交渉案件 | 全行成功。事件番号は文字列（先頭 0 保持、parse 失敗でも raw を保存して確認待ち） |
| `matter_parties_utf8.csv` | 5 行。`M002,C999,opponent` が未登録の連絡先外部 ID を参照 | **未登録外部 ID 参照エラー**で batch 全体を止める（他の 4 行も commit しない）。人物を名前で結合しない |
| `contacts_bad_encoding.bin` | UTF-8 BOM 付きヘッダーのあとに不正な UTF-8（cp932 の bytes `FF FE 83 41 93 63` と途中で切れたマルチバイト `E4 BD`） | **encoding エラー**。U+FFFD や「?」へ置換せず停止。拡張子 `.bin` は「CSV ではない」判定ではなく中身の検査で判断すること |

## cp932 で strict encode できない／往復しない文字（`build_fixtures.py` が実測して表示）

| 文字 | 結果 |
|---|---|
| 髙 U+9AD9、① U+2460、﨑 U+FA11、㈱ U+3231、Ⅰ U+2160 | encode 可（NEC 特殊文字・NEC 選定 IBM 拡張・IBM 拡張）。往復一致 |
| 𠮷 U+20BB7（SIP） | **encode 不能** → cp932 出力は拒否し、UTF-8 BOM を案内 |
| 葛+IVS U+E0100 | **encode 不能**（異体字セレクタ） |
| ¥ U+00A5 | **encode 不能**（cp932 の 0x5C は U+005C） |
| — U+2014 EM DASH | **encode 不能**（cp932 は 0x815C ↔ U+2015） |
| 〜 U+301C WAVE DASH | encode は 0x8160 で成功するが **decode すると ～ U+FF5E** になる（非可逆） |
| − U+2212 MINUS SIGN | encode は 0x817C で成功するが **decode すると － U+FF0D** になる（非可逆） |

CP932 出力を「全セル strict encode 可の場合だけ許可」とする実装は、encode 成功だけでなく **encode → decode → 原文一致** まで確認しないと 〜/− が黙って別の文字に置き換わる。
