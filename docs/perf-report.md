# AC26 性能計測（縮小版）

計測日時: 2026-10-06T15:33:12.743Z（UTC）

環境: 開発コンテナ（共有 vCPU、API/worker/web/Postgres/LibreOffice が同一ホスト）。仕様の基準（API 4vCPU/8GB + worker 4vCPU/8GB、2,000 案件、20,000 文書 metadata、20 同時）とは異なる縮小計測であり、本番の保証値ではない。PDF 完了秒数も保証しない。

## データ量

- 計測用に作成した案件: 200 件（seed 3 件 + 既存）。作成所要 3120 ms（20 並列）
- 文書 metadata: 計測前の seed/テスト分 + 一括生成 111 件（送付書）

## 一覧・検索 API（20 並列 × 5 回 = 100 サンプル、ms）

| API | p50 | p95 | max | errors | 目標 |
|---|---|---|---|---|---|
| matters_list | 308 | 430 | 498 | 0 | 一覧 p95 2 秒 |
| matters_search | 268 | 371 | 388 | 0 | 検索 p95 3 秒 |
| documents_list | 74 | 112 | 121 | 0 | 一覧 p95 2 秒 |
| contacts_search | 41 | 69 | 74 | 0 | 検索 p95 3 秒 |
| home | 426 | 506 | 522 | 0 | — |

## 文書生成（一括、T08 送付書、worker 1 プロセス直列、LibreOffice headless）

| 件数 | 成功 | 失敗 | 合計 ms | 1 文書あたり ms | 失敗率 |
|---|---|---|---|---|---|
| 1 | 1 | 0 | 3114 | 3114 | 0 |
| 10 | 10 | 0 | 28103 | 2810 | 0 |
| 100 | 100 | 0 | 269771 | 2698 | 0 |

- 計測クライアント RSS: 89 MB（API/worker のメモリは未計測。worker は soffice を job ごとに起動し、1 job あたりの一時領域は終了時に清掃）
- 1 文書あたり約 2.7〜3.1 秒は DOCX 生成 + soffice 起動 + PDF 変換 + Python preflight の合計。worker を複数プロセスにすれば並列化できる（job claim は SKIP LOCKED）。
- 2,000 案件 / 20,000 文書 / 本番相当 vCPU での計測は未実施（HANDOFF）。

生データ: docs/perf-report.json（scripts/perf.mjs で再計測可）
