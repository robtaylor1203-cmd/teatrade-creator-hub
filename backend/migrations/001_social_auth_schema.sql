-- ═══════════════════════════════════════════════════════════════════
-- TeaTrade — Social Auth & Metrics Schema Enhancement
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- This migration is fully idempotent — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────
-- 1. Extensions
-- ────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ────────────────────────────────────────
-- 2. Link creators to Supabase Auth
-- ────────────────────────────────────────
-- Adds a direct FK to auth.users so RLS policies can use auth.uid()
ALTER TABLE creators
  ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE REFERENCES auth.users(id);

-- Backfill: link existing creators to their auth accounts by email
UPDATE creators c
SET auth_user_id = au.id
FROM auth.users au
WHERE c.email = au.email
  AND c.auth_user_id IS NULL;

-- ────────────────────────────────────────
-- 3. Enhance creator_socials table
-- ────────────────────────────────────────
ALTER TABLE creator_socials
  ADD COLUMN IF NOT EXISTS handle TEXT,
  ADD COLUMN IF NOT EXISTS avg_views INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS secondary_metric NUMERIC(6,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profile_picture_url TEXT,
  ADD COLUMN IF NOT EXISTS platform_user_id TEXT,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;

-- ────────────────────────────────────────
-- 4. Social Tokens (encrypted, server-only)
-- ────────────────────────────────────────
-- Tokens are AES-256-GCM encrypted by Edge Functions before storage.
-- RLS blocks ALL client access — only service_role can read/write.
CREATE TABLE IF NOT EXISTS social_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id       UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok')),
  access_token     TEXT NOT NULL,            -- encrypted ciphertext
  refresh_token    TEXT,                     -- encrypted ciphertext
  token_expires_at TIMESTAMPTZ,
  scopes           TEXT[] DEFAULT '{}',
  platform_user_id TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(creator_id, platform)
);

COMMENT ON COLUMN social_tokens.access_token IS 'AES-256-GCM encrypted. Decryption key held in Edge Function env (TOKEN_ENCRYPTION_KEY).';

-- ────────────────────────────────────────
-- 5. Metric Snapshots (time-series history)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metric_snapshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id       UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL,
  follower_count   INTEGER,
  engagement_rate  NUMERIC(5,2),
  avg_views        INTEGER,
  secondary_metric NUMERIC(6,2),
  recorded_at      TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────
-- 6. OAuth States (CSRF protection)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS oauth_states (
  state        TEXT PRIMARY KEY,
  creator_id   UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL,
  redirect_url TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  expires_at   TIMESTAMPTZ DEFAULT (now() + interval '10 minutes')
);

-- ────────────────────────────────────────
-- 7. Campaign table enhancements
-- ────────────────────────────────────────
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS creator_id    UUID REFERENCES creators(id),
  ADD COLUMN IF NOT EXISTS escrow_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS platform_fee  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS creator_payout NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT now();

-- ────────────────────────────────────────
-- 8. Indexes for performance
-- ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_social_tokens_creator
  ON social_tokens(creator_id);

CREATE INDEX IF NOT EXISTS idx_metric_snapshots_lookup
  ON metric_snapshots(creator_id, platform, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry
  ON oauth_states(expires_at);

CREATE INDEX IF NOT EXISTS idx_creators_auth_user
  ON creators(auth_user_id);

-- ────────────────────────────────────────
-- 9. Helper function: get creator_id for the signed-in user
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_my_creator_id()
RETURNS UUID AS $$
  SELECT id FROM creators WHERE auth_user_id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ────────────────────────────────────────
-- 10. Row Level Security
-- ────────────────────────────────────────

-- social_tokens: ZERO client access (only service_role bypasses RLS)
ALTER TABLE social_tokens ENABLE ROW LEVEL SECURITY;
-- No policies created = all client access blocked.

-- oauth_states: ZERO client access
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;

-- metric_snapshots: Creators read their own, brands read all (talent pool)
ALTER TABLE metric_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'metric_snapshots' AND policyname = 'creators_read_own_snapshots') THEN
    EXECUTE 'CREATE POLICY "creators_read_own_snapshots" ON metric_snapshots FOR SELECT USING (creator_id = get_my_creator_id())';
  END IF;
END $$;

-- creator_socials: Creators read own, authenticated users read all (talent pool display)
ALTER TABLE creator_socials ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'creator_socials' AND policyname = 'anyone_can_view_socials') THEN
    EXECUTE 'CREATE POLICY "anyone_can_view_socials" ON creator_socials FOR SELECT USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'creator_socials' AND policyname = 'creators_update_own_socials') THEN
    EXECUTE 'CREATE POLICY "creators_update_own_socials" ON creator_socials FOR UPDATE USING (creator_id = get_my_creator_id())';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'creator_socials' AND policyname = 'creators_insert_own_socials') THEN
    EXECUTE 'CREATE POLICY "creators_insert_own_socials" ON creator_socials FOR INSERT WITH CHECK (creator_id = get_my_creator_id())';
  END IF;
END $$;

-- ────────────────────────────────────────
-- 11. Triggers
-- ────────────────────────────────────────

-- Auto-update updated_at on social_tokens
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_social_tokens_updated ON social_tokens;
CREATE TRIGGER set_social_tokens_updated
  BEFORE UPDATE ON social_tokens
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS set_campaigns_updated ON campaigns;
CREATE TRIGGER set_campaigns_updated
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ────────────────────────────────────────
-- 12. Cleanup function for expired OAuth states
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_states()
RETURNS void AS $$
  DELETE FROM oauth_states WHERE expires_at < now();
$$ LANGUAGE SQL SECURITY DEFINER;

-- Schedule cleanup via pg_cron (enable in Supabase Dashboard → Database → Extensions)
-- SELECT cron.schedule('cleanup-oauth-states', '*/5 * * * *', 'SELECT cleanup_expired_oauth_states()');

-- ═══════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ═══════════════════════════════════════════════════════════════════
