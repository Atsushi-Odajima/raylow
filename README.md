# RayLaw — 法律事務所の書類作成・訴訟準備アプリ

案件情報・書式・証拠を整理し、草案の作成、弁護士による確認・承認、DOCX / PDF出力へつなぐWebアプリです。
表示名は **RayLaw**、リポジトリ・コード識別子は `raylow` です。

## できること

- 案件・関係者・書式・証拠を管理し、入力項目から書類の草案を作る。
- 書式の版管理と承認、編集者と承認者を分けた正式出力の制御。
- 文書処理ワーカーによるDOCX / PDF生成、ファイル検査、出力・送付の記録。
- 組織・案件の権限、MFA、監査、データ入出力とバックアップ。

## デモの範囲

同梱の20書式と初期データは**架空デモ**です。`sample_only` の書式を実務用の承認済み書式と混同しないでください。
法務監修・所内承認、独立したセキュリティ検査、スマートフォン実機確認は、このリポジトリの実装だけで完了したものではありません。
法律相談・法的判断を自動で行うサービスではなく、専門家が確認する業務アプリのポートフォリオです。

## 技術構成

| 部分 | 実装 |
| --- | --- |
| Web | React / TypeScript / Vite、PWA |
| API | Fastify BFF、セッションCookie、CSRF / Origin検査、TOTP |
| データ | PostgreSQL、RLS、状態遷移・承認・ジョブキュー |
| 文書処理 | Node.js worker、Python隔離処理、LibreOffice、ClamAV |

## ローカルで試す

Node.js **22.12以上・23未満**、Docker、開発用PostgreSQLまたはSupabase localが必要です。

```sh
npm ci
```

続いて [README.txt](README.txt) の順序で、専用DB・環境変数・暗号化鍵、マイグレーション、デモseed、scanner / document-workerを設定し、`npm run dev` を実行します。Webは通常 http://localhost:5173 です。
seedが生成するローカル認証情報は `.data/seed-credentials.json` に保存されます。これは公開・共有するファイルではありません。
DB初期化・テストは既存の実務データがあるDBへ向けず、専用環境で行ってください。

単一コンテナのデモ構成もあります：[docs/deploy-demo.md](docs/deploy-demo.md)。配備には環境変数とデモ用認証設定が必要です。

## 実装の見どころ

- [apps/web](apps/web) / [apps/api](apps/api)：画面とAPIの境界。
- [packages](packages)：日本語検索・和暦・証拠番号、書式スキーマ、状態・承認規則。
- [apps/worker](apps/worker) / [workers/documents](workers/documents)：文書生成と隔離処理。
- [supabase/migrations](supabase/migrations)：データ構造・RLS・不変条件。
- [templates/demo](templates/demo)：架空書式と由来・入力サンプル。

## 検証・運用資料

```sh
npm run lint
npm run typecheck
npm test
```

DB・文書生成・セキュリティ・入出力・E2Eには、それぞれ別の試験環境と依存ツールが必要です。コマンドと既存の結果は [README.txt](README.txt)、残項目は [HANDOFF.txt](HANDOFF.txt) を参照してください。

- [API](docs/API.md) / [権限](docs/permissions.md) / [状態遷移](docs/state-transitions.md)
- [脅威モデル](docs/threat-model.md) / [運用](docs/operations.md)
- [テスト](tests) / [参照資料](SOURCE_NOTES.txt)

制作・管理：**Atsushi Odajima**。実装・資料作成にはAI支援を利用しています。ソースと第三者依存物の利用条件はリポジトリ内の表記を参照してください。
