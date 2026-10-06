-- RayLaw v2 migration 0001: roles, schemas, extensions
-- Supabase では authenticated / service_role / anon が既存。素の Postgres では作成する。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS private;

GRANT USAGE ON SCHEMA app TO authenticated, service_role;
GRANT USAGE ON SCHEMA private TO service_role;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- 現在のユーザー（BFF が request.jwt.claims を set_config で渡す。Supabase と同じ契約）
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_request_id() RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT NULLIF(current_setting('app.request_id', true), '')
$$;
