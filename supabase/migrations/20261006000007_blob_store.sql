-- RayLaw v2 migration 0007: BLOB_STORE=postgres 用の原本保存（private.blobs）
-- ファイルシステムが揮発する単一コンテナ配備（Render 等の PaaS）向け。service_role でのみ到達し、INSERT 後は変更・削除できない（immutable）。
CREATE TABLE private.blobs (
  key uuid PRIMARY KEY,
  bytes bytea NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size bigint NOT NULL CHECK (size >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.blobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON private.blobs TO service_role;
ALTER TABLE private.blobs ENABLE ROW LEVEL SECURITY;
-- ポリシー無し = service_role(BYPASSRLS) 以外はアクセス不可
CREATE TRIGGER blobs_immutable BEFORE UPDATE OR DELETE ON private.blobs FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_row();
