-- RayLaw v2 migration 0005: 非公開 schema（server_sessions / ローカル資格情報 / MFA）
-- ブラウザ・authenticated ロールからは SELECT 不可。BFF が service_role でのみ操作する。

CREATE TABLE private.server_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cookie_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  refresh_token_enc text,
  idle_expiry timestamptz NOT NULL,
  absolute_expiry timestamptz NOT NULL,
  last_mfa_at timestamptz,
  mfa_pending boolean NOT NULL DEFAULT true,
  csrf_token_hash text NOT NULL,
  user_agent_hash text,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX server_sessions_user_idx ON private.server_sessions (user_id);

-- AUTH_PROVIDER=local 用（開発/テスト、または Supabase Auth 未接続環境）。scrypt ハッシュ。
CREATE TABLE private.local_credentials (
  user_id uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  must_change boolean NOT NULL DEFAULT false,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- TOTP（BFF が管理。secret は SESSION_ENCRYPTION_KEY で暗号化）
CREATE TABLE private.mfa_totp (
  user_id uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  secret_enc text NOT NULL,
  enrolled_at timestamptz,
  last_used_counter bigint,
  recovery_codes_hash text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Supabase Auth 連携時のユーザー対応（auth.users.id ↔ app_users.id）
CREATE TABLE private.identity_links (
  provider text NOT NULL,
  provider_user_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA private TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;
ALTER TABLE private.server_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.local_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.mfa_totp ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.identity_links ENABLE ROW LEVEL SECURITY;
-- ポリシー無し = service_role(BYPASSRLS) 以外はアクセス不可
