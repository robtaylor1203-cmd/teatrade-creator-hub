-- ═══════════════════════════════════════════════════════════════════
-- TeaTrade — Campaign Brief Details Schema
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- This migration is fully idempotent — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────
-- 1. Add brief detail columns to campaigns
-- ────────────────────────────────────────
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS brief_description  TEXT,
  ADD COLUMN IF NOT EXISTS video_count        INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS photo_count        INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_length       INTEGER,
  ADD COLUMN IF NOT EXISTS platforms          TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mood               TEXT,
  ADD COLUMN IF NOT EXISTS setting            TEXT,
  ADD COLUMN IF NOT EXISTS required_badges    TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS min_followers      INTEGER,
  ADD COLUMN IF NOT EXISTS min_engagement     NUMERIC(5,2);

-- ═══════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ═══════════════════════════════════════════════════════════════════
