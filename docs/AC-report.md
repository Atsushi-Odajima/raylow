# RayLaw v2 Acceptance Criteria 結果一覧（AC01〜AC30）

判定日: 2026-10-06。環境: 開発コンテナ（Node 22.22 / PostgreSQL 16.15 / LibreOffice 24.2.7 / Python 3.13、Docker デーモン無し、ClamAV・Tesseract・GoTrue 無し、iPhone 実機無し）。
「成功」は自動テストまたは実行ログで確認したもの。「未検証」は環境・資格情報・実機が無く確認できなかったもの。法務監修は未実施。

| AC | 内容（要約） | 結果 | 検証方法 |
|---|---|---|---|
| AC01 | 案件登録済みの受任通知で代理人を選ぶと自事務所/宛先/依頼者/案件名が入り再入力なしで草案 | 成功 | tests/db/flow.db.test.ts「AC01」（API in-process）、scripts/smoke.mjs、e2e（S04→S05 で自事務所名が自動差込） |
| AC02 | 同姓同名の代理人 2 名を所属で識別、別案件の代理する側を混同しない | 成功 | tests/security/api.security.test.ts「AC02」（佐藤一郎×2、m1/m3 の代理関係） |
| AC03 | 回答書と答弁書が別種類、認否が自動選択されない | 成功 | tests/db/flow.db.test.ts「AC03」（T13 の legalJudgement 項目が未選択）、templates/demo/T13 schema |
| AC04 | 20 書式すべてに schema/サンプル/フォーム/DOCX・PDF 試験。sample_only で正式出力不可 | 成功 | tests/templates/render.templates.test.ts（20×2 + fixture = 44 pass）、tests/security「サンプル書式では正式出力できない」。フォームは FieldForm（schema 駆動） |
| AC05 | DOCX の段落/表/header/footer 差込、run 分割タグ、長文/長い氏名、行 loop、対応外要素の位置付き拒否 | 成功 | tests/templates（split_run_tags.docx、32 グラフェム氏名、forbidden/* 15 種の位置付き拒否）、tests/security（検査 job） |
| AC06 | 未定義タグ/未対応式/循環/危険キーで公開不可。XML/JS 文字列が実行されない | 成功 | tests/security「スキーマに危険キー…」「タグに XML/JS 文字列…」（&lt;script&gt; エスケープ、{office_name} 文字列が差込まれない） |
| AC07 | 原文の全角/半角/異体字/IVS/空白が DB 再読込と JSON/TXT でコードポイント不変 | 成功 | tests/unicode/roundtrip.unicode.test.ts（60 fixture の API 往復、contact_versions snapshot、unicode_fixture.txt byte 往復） |
| AC08 | IME 変換中 Enter で送信せず autosave/変換が走らない。カーソルが飛ばない | 一部（未検証） | 純関数 isComposingEvent/shouldSubmitOnEnter は unit test。web の Input/TextArea/useAutosave に実装（compositionstart〜end を監視）。実ブラウザでの IME 操作は Playwright で再現できず未検証 |
| AC09 | Word と PDF で宛先/事件番号/全角/改頁/表/署名欄を確認。字体不足を置換で通過させない | 一部 | PDF: tests/templates で全 20 書式のフォント埋込（NotoSerifJP/NotoSansJP）と text extraction 往復を確認、Type3/未埋込は error。Windows Word での DOCX 目視は未検証（Word 無し） |
| AC10 | マスター変更が確定版を変えない。草案へは差分選択、手入力上書き保持 | 成功 | tests/db/flow「AC10/AC11」（事務所住所変更→旧承認 revision 不変、refresh-candidates→apply で新 revision、承認失効） |
| AC11 | 書式の新版が過去文書を書き換えない。再生成は明示した新 revision | 成功 | 同上 + template_versions published immutable トリガ（tests/db/rls） |
| AC12 | 一括生成で宛先混入なし、100 件上限、部分失敗の再試行 | 成功 | tests/security「AC12」（上限 422、宛先別 snapshot）。再試行 API（/batch-items/:id/retry）は実装、失敗注入の自動試験は未作成 |
| AC13 | 未置換タグ、必須欄欠落、証拠参照切れ、番号衝突が正式出力を止める | 成功 | tests/db/flow「AC13」（required_missing で request-review 422）、worker の unreplaced_tag（nullGetter + 事前検査）、preflight evidence_ref_broken / brief_number_conflict（コードで実装、単体試験は未作成） |
| AC14 | staff/未割当 lawyer/最終編集者の自己承認を API で拒否。古い hash は 409 | 成功 | tests/db/flow「AC14」+ packages/domain checkApproval unit test |
| AC15 | Word 編集 DOCX 再取込は別版、旧承認で正式出力不可 | 成功 | tests/db/flow「AC15」（kind=external_edit、render final 409） |
| AC16 | 出力と送付/提出が別状態。ダウンロードで提出済みにならない | 成功 | tests/db/flow「AC16」（final ダウンロード後 dispatches=0、手動記録、記録者本人は確認不可） |
| AC17 | 同時保存で expectedVersion 不一致を検知し黙って上書きしない | 成功 | tests/db/flow「AC17」、tests/db/rls（version 自動増分） |
| AC18 | 他 org/未割当/barrier は本文だけでなく候補数・preview・job・file・export・audit も取得不可 | 成功 | tests/security「AC18」、tests/db/rls（RLS 直接） |
| AC19 | 案件情報を含むユーザー書式の公開前確認。案件原資料参照をテンプレートへ引き継がない | 一部 | publish に 3 点確認（residualTextReviewed 等）必須、inspector が残存個人情報候補を列挙、schema に UUID を含むと 422。自動検知の網羅性は保証しない |
| AC20 | DOCM/マクロ/OLE/外部参照/ZIP bomb/偽 MIME/暗号化 PDF を拒否。scan 停止は fail closed | 一部 | DOCM/偽 MIME 415、OLE/外部参照/ZIP bomb は tests/security・tests/templates で拒否確認。暗号化 PDF/JavaScript は check_file.py に実装（fixture 未作成）。ClamAV 未接続のため fail closed（scan_failed）の経路はコードのみ |
| AC21 | CSV の CP932/UTF-8、改行/カンマ、外部 ID 競合、formula injection、全行 rollback | 成功 | tests/export/csv.export.test.ts |
| AC22 | iPhone で書式選択→入力→本文→プレビュー→レビュー→出力 | 未検証（実機）／エミュレーション成功 | Playwright 390×844（iPhone 13 相当、Chromium）で書式選択→入力→本文→PDF プレビュー→形式検査まで pass。レビュー→出力は API 試験（AC14/16）で確認。実機 iPhone Safari・HTTPS 配信・ホーム画面追加は未実施 |
| AC23 | offline/ログアウト/bfcache 復帰で機密を表示せず API を cache しない | 一部 | e2e「ログアウト後に bfcache 復帰…」成功（desktop/mobile）、API no-store ヘッダ（tests/security）、sw.js は /api を cache しない（pwa.e2e）。offline 画面の実機確認は未実施 |
| AC24 | 日次バックアップから空環境へ復元し hash と ACL が一致 | 成功 | tests/export/backup.export.test.ts（pg_dump→空 DB 復元→file_versions sha256 と ACL 行数一致） |
| AC25 | コントラスト 4.5:1、キーボード、200% zoom、スクリーンリーダー、reduced motion | 未検証 | tokens は仕様値を設定、focus-visible/aria を実装。自動検査（axe 等）・実機は未実施 |
| AC26 | 20 同時/2,000 案件/20,000 文書で一覧 p95 2 秒・検索 3 秒。1/10/100 文書生成の時間/メモリ/失敗率 | 一部（縮小計測） | scripts/perf.mjs（docs/perf-report.md）。本番相当の構成・規模ではない |
| AC27 | job 再送・承認再送で二重成果物/二重遷移が起きない。audit/outbox と業務変更が同一 transaction | 成功 | tests/db/rls（claim SKIP LOCKED、input_hash 重複拒否）、承認は FOR UPDATE + status 条件付き UPDATE（flow test で 2 回目の決定は 409）。audit/outbox は同一 tx（services/audit.ts） |
| AC28 | 雛型の承認・ライセンス・適用範囲・確認日を保存。公式公開物の無断転載で埋めない | 成功 | template_versions（approved_by/at, license_note, applicability, source_url, checked_at, provenance）。20 書式は自作デモ（templates/demo/*/provenance.json: supervised=false） |
| AC29 | クリーン環境で npm ci/build/migration/seed/test が再現。lockfile/SBOM/ライセンス、secret 混入 0 | 一部 | 本コンテナで npm ci→build→migrate→seed→test:all を実行。docs/sbom。`.env` は gitignore、seed 資格情報は .data に出力。別のクリーン環境での再実行は未実施 |
| AC30 | 旧 v1 の案件記録ホーム/旧配色が残らず /create が入口。最短導線を実測 | 成功 | / → /create、nav「作成・書類・案件・書式」、配色は tokens.css（旧配色なし）。ログイン→PDF プレビュー→形式検査 12.4 秒（desktop）/ 12.3 秒（mobile、PDF 生成 job 約 3 秒含む） |

## e2e / 計測の実測値

### e2e（Playwright、Chromium 141）

| テスト | desktop-chromium | mobile-390 |
|---|---|---|
| manifest と service worker が配信され、API は cache されない（AC23/PWA） | pass | pass |
| ログイン→MFA→/create→案件→書式→宛先→自動差込→本文→PDF プレビュー→形式検査（AC01/AC22 相当/AC30） | pass（login→preview→check 12.4 秒、PDF 生成 job 含む） | pass（12.3 秒） |
| ログアウト後に bfcache 復帰しても機密画面を表示しない（AC23） | pass | pass |

6 passed / 0 failed（約 40 秒）。実機 iPhone ではなく Chromium 141 の 390×844 エミュレーション。

### AC26 縮小計測（docs/perf-report.md）

| 項目 | 値 |
|---|---|
| 案件 200 件・20 並列での一覧 p95 | 430 ms |
| 案件検索 p95 / 連絡先検索 p95 | ≤120 ms / 69 ms |
| ホーム（/api/home/create）p95 | 506 ms |
| 文書生成 1 / 10 / 100 件（失敗率） | 3.1 s / 28.1 s / 269.8 s（0） |
| 1 文書あたり | 約 2.7〜3.1 s（DOCX + soffice + preflight、worker 1 プロセス） |

本番相当（4vCPU×2、2,000 案件、20,000 文書）は未計測。PDF 完了秒数は保証値ではない。

