# templates/demo — 架空デモ書式 20 種（T01..T20）

`scripts/build_demo_templates.py`（python-docx）が生成する。各ディレクトリ名は `TemplateKindSchema` の値。

初期状態の法務書式は sample_only。草案出力には「サンプル・要確認」を表示。監修済みではない。

各ディレクトリの構成: `template.docx`（A4 縦・単一セクション・横書き・Noto Serif JP 12pt、ヘッダー `{document_status_label}`、フッター PAGE フィールド + `{template_version_label}`）、`schema.json`（TemplateFieldSchema）、`provenance.json`（sampleOnly:true / supervised:false）、`sample_values.json`（架空値）、`ast_sample.json`（本文 DocumentAST）。

本文は `{#body_blocks}` 段落ループ（`{#is_heading}` / `{#is_numbered}` / `{#is_paragraph}` の各条件も段落単位）で見出し・番号付き段落・通常段落を別段落として出力する。添付リストは `{#has_attachments}` → `{#attachments}{name}　{copies}{/attachments}` の段落ループ。表は単純な行繰返しのみ（縦結合なし）。各書式に、意図的に複数 run に分割したタグ（例: `{recip` + `ient_name}`）を 1 つ以上含む。

| kind | 表題 | scope | recipientTypes | 添付 | loops（array / 条件） | 分割 run タグ |
|---|---|---|---|---|---|---|
| `T01_engagement_notice` | 受任通知 | negotiation | opponent_agent, opponent | あり | `acceptance_confirmed`, `attachments`, `body_blocks`, `has_attachments`, `is_heading`, `is_numbered`, `is_paragraph` | `{recipient_name}` |
| `T02_reply_letter` | 回答書 | negotiation | opponent_agent, opponent | あり | `attachments`, `body_blocks`, `has_attachments`, `is_heading`, `is_numbered`, `is_paragraph`, `reply_items` | `{recipient_name}` |
| `T03_inquiry_letter` | 照会書 | negotiation | opponent_agent, opponent, third_party | なし | `body_blocks`, `is_heading`, `is_numbered`, `is_paragraph`, `questions` | `{recipient_name}` |
| `T04_document_request` | 資料提出依頼書 | client | client, third_party | あり | `attachments`, `body_blocks`, `has_attachments`, `is_heading`, `is_numbered`, `is_paragraph`, `requested_items` | `{recipient_name}` |
| `T05_demand_letter` | 催告書 | negotiation | opponent, opponent_agent | なし | `body_blocks`, `is_heading`, `is_numbered`, `is_paragraph` | `{recipient_name}` |
| `T06_settlement_proposal` | 和解提案書 | negotiation | opponent_agent, opponent | あり | `attachments`, `body_blocks`, `has_attachments`, `is_heading`, `is_numbered`, `is_paragraph`, `proposal_terms` | `{recipient_name}` |
| `T07_agreement` | 合意書 | negotiation | none, opponent_agent, opponent | なし | `agreement_parties`, `body_blocks`, `clauses`, `is_heading`, `is_numbered`, `is_paragraph` | `{matter_title}` |
| `T08_cover_letter` | 送付書 | negotiation | opponent_agent, opponent, court, client, third_party | あり | `attachments`, `body_blocks`, `has_attachments`, `is_heading`, `is_numbered`, `is_paragraph` | `{recipient_name}` |
| `T09_client_progress_report` | 依頼者への進捗報告書 | client | client | あり | `attachments`, `body_blocks`, `has_attachments`, `is_heading`, `is_numbered`, `is_paragraph` | `{recipient_name}` |
| `T10_retainer_agreement` | 委任契約書 | client | client | なし | `body_blocks`, `is_heading`, `is_numbered`, `is_paragraph` | `{client_name}` |
| `T11_power_of_attorney_litigation` | 訴訟委任状 | court | court, none | なし | `auth_appeal`, `auth_counterclaim`, `auth_settlement`, `auth_sub_delegation`, `auth_waiver_admission`, `auth_withdrawal`, `body_blocks`, `is_heading`, `is_numbered`, `is_paragraph` | `{principal_name}` |
| `T12_complaint` | 訴状 | court | court | あり | `attachments`, `body_blocks`, `claim_purpose_items`, `evidence_refs`, `has_attachments`, `is_heading`, `is_numbered`, `is_paragraph` | `{plaintiff_name}` |
| `T13_answer` | 答弁書 | court | court | あり | `admissions`, `answer_items`, `attachments`, `body_blocks`, `evidence_refs`, `has_attachments`, `is_heading`, `is_numbered`, `is_paragraph` | `{case_number}` |
| `T14_brief` | 準備書面 | court | court | あり | `attachments`, `body_blocks`, `evidence_refs`, `has_attachments`, `is_heading`, `is_numbered`, `is_paragraph` | `{case_number}` |
| `T15_party_list` | 当事者目録 | court | court | なし | `body_blocks`, `is_heading`, `is_numbered`, `is_paragraph`, `parties` | `{court_name}` |
| `T16_evidence_description` | 証拠説明書 | court | court | なし | `body_blocks`, `evidence_rows`, `is_heading`, `is_numbered`, `is_paragraph` | `{case_number}` |
| `T17_electronic_evidence_description` | 電子証拠説明書 | court | court | なし | `body_blocks`, `electronic_evidence_rows`, `is_heading`, `is_numbered`, `is_paragraph` | `{case_number}` |
| `T18_documentary_evidence_submission` | 書証提出書 | court | court | あり | `applicability_confirmed`, `attachments`, `body_blocks`, `has_attachments`, `is_heading`, `is_numbered`, `is_paragraph`, `submitted_evidence` | `{case_number}` |
| `T19_withdrawal_of_action` | 訴え取下書 | court | court | なし | `body_blocks`, `is_heading`, `is_numbered`, `is_paragraph` | `{case_number}` |
| `T20_termination_of_engagement` | 委任終了通知 | client | client, opponent_agent, court | あり | `attachments`, `body_blocks`, `handover_items`, `has_attachments`, `is_heading`, `is_numbered`, `is_paragraph` | `{recipient_name}` |

## 法的判断を含む項目（legalJudgement:true・既定値なし）

- T02 `reply_policy`（回答方針）: 既定の認諾等を入れない。
- T11 `auth_*`（特別授権）: 既定 OFF。弁護士確認必須。
- T12 `claim_purpose_items`（請求の趣旨）、T13 `answer_items` / `admissions`（認否: 未入力/認める/否認/不知/自由記載。サンプルは未入力のまま）。
- T19 `withdrawal_scope` / `withdrawal_scope_detail` / `consent_status`。

## 注意

- 架空の「青葉法律事務所」「青葉　花子」「株式会社ミドリ商事」「髙﨑産業株式会社」および同姓同名の相手方代理人「佐藤　一郎」（所属が異なる 2 名）を使用。実在の人物・団体・事件とは無関係。
- 全角数字・全角空白・異体字（髙・﨑）・30 grapheme 超の名称・証拠枝番「甲第３号証の１」を含む。原文を変換しない。
- 文例は明らかにサンプルであり、法的結論を事実として記載しない。T05 の利息・時効、T12 の訴額・印紙額は自動算定しない。
- 出典・適用範囲・確認日・利用条件は `provenance.json`。裁判所の公開書式は使用していない。
- 再生成: `python3 -I scripts/build_demo_templates.py`（冪等。`--check` で差分検査のみ）。
