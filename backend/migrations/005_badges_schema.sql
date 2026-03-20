-- ═══════════════════════════════════════════════════════════════════
-- TeaTrade — Badges & Pro Academy Schema
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- This migration is fully idempotent — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────
-- 1. Badges master table
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS badges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_name  TEXT NOT NULL UNIQUE,
  badge_key   TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────
-- 2. Creator badges junction table
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_badges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  badge_id    UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  earned_at   TIMESTAMPTZ DEFAULT now(),
  score       INT,
  UNIQUE(creator_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_creator_badges_creator ON creator_badges(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_badges_badge ON creator_badges(badge_id);

-- ────────────────────────────────────────
-- 2b. Backfill columns if table pre-existed
-- ────────────────────────────────────────
ALTER TABLE badges ADD COLUMN IF NOT EXISTS badge_key TEXT UNIQUE;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
ALTER TABLE creator_badges ADD COLUMN IF NOT EXISTS score INT;

-- ────────────────────────────────────────
-- 3. Seed the 5 Pro Academy badges
--    Uses ON CONFLICT to be idempotent
-- ────────────────────────────────────────
INSERT INTO badges (badge_name, badge_key, description, sort_order) VALUES
  ('Chemistry & Oxidation', 'chemistry', 'Mastery of fermentation spectrums & oxidation curves.', 1),
  ('Terroir Certified',     'terroir',   'Verified elevation, climate & soil knowledge.',         2),
  ('Botanical Specialist',  'botanical', 'Expertise in functional tisanes & herbalism.',          3),
  ('Gongfu Ceremony',       'gongfu',    'Specialist in ritual brewing techniques.',              4),
  ('Sourcing & Origin',     'sourcing',  'Supply chain expertise & ethical trade.',               5)
ON CONFLICT (badge_name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ═══════════════════════════════════════════════════════════════════
