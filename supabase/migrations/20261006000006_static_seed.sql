-- RayLaw v2 migration 0006: 静的シード（org に依存しない）
-- 裁判所 profile: 初期は generic（形式上の確認のみ）。mints 完全対応と表示しない。
INSERT INTO public.court_profiles (id, org_id, version, name, source_url, checked_at, applicable_procedure, file_rules, page_rules, naming_rules)
VALUES (
  '00000000-0000-4000-8000-000000000001', NULL, 1, 'generic（形式確認のみ）',
  'https://www.courts.go.jp/saiban/minjidejitaruka/minso_shiryou/index.html', '2026-10-06', 'generic',
  '{"allowedFormats":["pdf"],"maxFileBytes":52428800,"note":"公式仕様は利用する手続ごとに確認してから追加する。全国共通としない。"}'::jsonb,
  '{"paper":"A4","orientation":"portrait","note":"頁数・用紙の形式確認のみ"}'::jsonb,
  '{"pattern":"{seq:03}_{display}.pdf","maxNameGraphemes":60}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- 文書書式 profile（試作用既定。裁判所の統一規定ではない）
INSERT INTO public.renderer_profiles (id, org_id, name, settings)
VALUES (
  '00000000-0000-4000-8000-000000000011', NULL, 'default-a4-portrait',
  '{"paper":"A4","orientation":"portrait","marginsMm":{"top":30,"bottom":25,"left":25,"right":25},"bodyFont":"Noto Serif JP","bodyPt":12,"lineHeightPt":20,"paragraphIndentEm":1,"headingPt":14,"pageNumber":"bottom-center","writingMode":"horizontal","note":"試作用既定。固定字数/行数は検証済み profile のみ追加可。"}'::jsonb
) ON CONFLICT (id) DO NOTHING;
