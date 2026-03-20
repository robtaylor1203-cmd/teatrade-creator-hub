-- ═══════════════════════════════════════════════════════════════════
-- TeaTrade — Creator Profiles, Brand Profiles, Matching & Invites
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Fully idempotent — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────
-- 1. Creator profile columns
-- ────────────────────────────────────────
ALTER TABLE creators ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS tea_niches TEXT[] DEFAULT '{}';
ALTER TABLE creators ADD COLUMN IF NOT EXISTS content_types TEXT[] DEFAULT '{}';
ALTER TABLE creators ADD COLUMN IF NOT EXISTS showcase_links TEXT[] DEFAULT '{}';
ALTER TABLE creators ADD COLUMN IF NOT EXISTS profile_complete BOOLEAN DEFAULT false;

-- ────────────────────────────────────────
-- 2. Brand profiles table
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brand_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  email           TEXT NOT NULL UNIQUE,
  company_name    TEXT,
  website         TEXT,
  bio             TEXT,
  product_categories TEXT[] DEFAULT '{}',
  profile_complete BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────
-- 3. Campaign brief expansion columns
-- ────────────────────────────────────────
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS tea_category TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS delivery_deadline DATE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS creators_needed INT DEFAULT 1;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS talking_points TEXT;

-- ────────────────────────────────────────
-- 4. Campaign invitations table
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  creator_id      UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  match_score     NUMERIC(5,2),
  invited_at      TIMESTAMPTZ DEFAULT now(),
  responded_at    TIMESTAMPTZ,
  UNIQUE(campaign_id, creator_id)
);

CREATE INDEX IF NOT EXISTS idx_invites_campaign ON campaign_invites(campaign_id);
CREATE INDEX IF NOT EXISTS idx_invites_creator ON campaign_invites(creator_id);
CREATE INDEX IF NOT EXISTS idx_invites_status ON campaign_invites(status);

-- ────────────────────────────────────────
-- 5. RLS policies
-- ────────────────────────────────────────
ALTER TABLE brand_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_invites ENABLE ROW LEVEL SECURITY;

-- Brand profiles: owners can read/write their own
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'brand_profiles_owner' AND tablename = 'brand_profiles') THEN
    EXECUTE 'CREATE POLICY brand_profiles_owner ON brand_profiles FOR ALL USING (auth.uid() = auth_user_id)';
  END IF;
END $$;

-- Campaign invites: creators can read their own invites
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'invites_creator_read' AND tablename = 'campaign_invites') THEN
    EXECUTE 'CREATE POLICY invites_creator_read ON campaign_invites FOR SELECT USING (
      creator_id IN (SELECT id FROM creators WHERE auth_user_id = auth.uid())
    )';
  END IF;
END $$;

-- Campaign invites: creators can update (accept/decline) their own
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'invites_creator_update' AND tablename = 'campaign_invites') THEN
    EXECUTE 'CREATE POLICY invites_creator_update ON campaign_invites FOR UPDATE USING (
      creator_id IN (SELECT id FROM creators WHERE auth_user_id = auth.uid())
    )';
  END IF;
END $$;

-- Campaign invites: brands can read invites for their campaigns
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'invites_brand_read' AND tablename = 'campaign_invites') THEN
    EXECUTE 'CREATE POLICY invites_brand_read ON campaign_invites FOR SELECT USING (
      campaign_id IN (SELECT id FROM campaigns WHERE brand_name = (SELECT email FROM auth.users WHERE id = auth.uid()))
    )';
  END IF;
END $$;

-- Service role can do everything (for edge functions)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'brand_profiles_service' AND tablename = 'brand_profiles') THEN
    EXECUTE 'CREATE POLICY brand_profiles_service ON brand_profiles FOR ALL USING (true) WITH CHECK (true)';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'invites_service' AND tablename = 'campaign_invites') THEN
    EXECUTE 'CREATE POLICY invites_service ON campaign_invites FOR ALL USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- ────────────────────────────────────────
-- 6. Helper index for matching queries
-- ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_creators_profile ON creators(profile_complete) WHERE profile_complete = true;
CREATE INDEX IF NOT EXISTS idx_creators_niches ON creators USING GIN(tea_niches);

-- ═══════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ═══════════════════════════════════════════════════════════════════
