-- ═══════════════════════════════════════════════════════════════════
-- TeaTrade — Campaign Brief Details + Entry Fee Schema
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

-- ────────────────────────────────────────
-- 2. Creator entry fee tracking
-- ────────────────────────────────────────
ALTER TABLE creators
  ADD COLUMN IF NOT EXISTS has_paid              BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT,
  ADD COLUMN IF NOT EXISTS paid_at               TIMESTAMPTZ;

-- ────────────────────────────────────────
-- 3. Allow 'withdrawal' type in escrow_transactions
--    and make campaign_id nullable (withdrawals aren't campaign-specific)
-- ────────────────────────────────────────
ALTER TABLE escrow_transactions
  ALTER COLUMN campaign_id DROP NOT NULL;

-- Drop and recreate the type check to include 'withdrawal'
ALTER TABLE escrow_transactions DROP CONSTRAINT IF EXISTS escrow_transactions_type_check;
ALTER TABLE escrow_transactions
  ADD CONSTRAINT escrow_transactions_type_check
  CHECK (type IN ('lock', 'release', 'refund', 'fee', 'withdrawal', 'entry_fee'));

-- ═══════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ═══════════════════════════════════════════════════════════════════
