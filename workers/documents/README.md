# workers/documents（Python 文書検査 worker）

Node render worker（apps/worker）から `python3 -I <script>` で呼び出される隔離処理。network-off / nonroot コンテナで実行する前提。

| スクリプト | 役割 |
|---|---|
| inspect_docx.py | 書式 DOCX の ZIP/XML 構造検査、run 分割タグ検出、対応外要素（マクロ/OLE/テキストボックス/コメント/変更履歴/脚注/複数セクション/外部参照/未対応フィールド/縦結合ループ）の位置付き拒否、残存個人情報候補 |
| check_file.py | 原資料の magic bytes/MIME/拡張子整合、ZIP bomb、PDF 暗号化/JavaScript/添付/アクション、画像 pixel 上限 |
| pdf_fonts.py | 出力 PDF のフォント埋込確認、ページ数、メタデータ、注釈、text extraction 往復 |
| pdf_sanitize.py | JavaScript/OpenAction/AA/埋込ファイル/危険注釈/メタデータを除いた派生安全版 PDF |

OCR（Tesseract jpn+eng, jpn_vert）は本コンテナに tesseract が無いため未接続（HANDOFF 参照）。
