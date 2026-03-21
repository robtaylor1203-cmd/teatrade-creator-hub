-- Migration 013: Ensure creators table has proper RLS for public profiles
-- Fixes public profile page returning "not found" due to missing policies
-- Safe to run multiple times (fully idempotent)

-- Ensure RLS is enabled on creators
ALTER TABLE creators ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own row
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'creators_self_select' AND tablename = 'creators') THEN
    EXECUTE 'CREATE POLICY creators_self_select ON creators FOR SELECT USING (auth.uid() = id)';
  END IF;
END $$;

-- Authenticated users can update their own row
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'creators_self_update' AND tablename = 'creators') THEN
    EXECUTE 'CREATE POLICY creators_self_update ON creators FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id)';
  END IF;
END $$;

-- Anyone (including anon) can read public profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'creators_public_read' AND tablename = 'creators') THEN
    EXECUTE 'CREATE POLICY creators_public_read ON creators FOR SELECT USING (public_profile_enabled = true)';
  END IF;
END $$;

-- Ensure creator_badges and badges are readable for public profiles
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_badges ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'badges_public_read' AND tablename = 'badges') THEN
    EXECUTE 'CREATE POLICY badges_public_read ON badges FOR SELECT USING (true)';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'creator_badges_public_read' AND tablename = 'creator_badges') THEN
    EXECUTE 'CREATE POLICY creator_badges_public_read ON creator_badges FOR SELECT USING (true)';
  END IF;
END $$;

-- Ensure portfolio_media is readable for public profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'portfolio_media_creator_select' AND tablename = 'portfolio_media') THEN
    EXECUTE 'CREATE POLICY portfolio_media_creator_select ON portfolio_media FOR SELECT USING (true)';
  END IF;
END $$;
