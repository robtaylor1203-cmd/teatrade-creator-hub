-- ═══════════════════════════════════════════════════════════════════
-- TeaTrade — Stripe Connect & Escrow Schema
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- This migration is fully idempotent — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────
-- 1. Stripe Connected Accounts (creators)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connected_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id          UUID NOT NULL UNIQUE REFERENCES creators(id) ON DELETE CASCADE,
  stripe_account_id   TEXT NOT NULL UNIQUE,
  onboarding_complete BOOLEAN DEFAULT FALSE,
  payouts_enabled     BOOLEAN DEFAULT FALSE,
  charges_enabled     BOOLEAN DEFAULT FALSE,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connected_accounts_creator
  ON connected_accounts(creator_id);

CREATE INDEX IF NOT EXISTS idx_connected_accounts_stripe
  ON connected_accounts(stripe_account_id);

-- ────────────────────────────────────────
-- 2. Escrow Transactions (event ledger)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS escrow_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  type                  TEXT NOT NULL CHECK (type IN ('lock', 'release', 'refund', 'fee')),
  amount                NUMERIC(10,2) NOT NULL,
  currency              TEXT DEFAULT 'gbp',
  stripe_payment_intent TEXT,
  stripe_transfer_id    TEXT,
  stripe_refund_id      TEXT,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  metadata              JSONB DEFAULT '{}',
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escrow_txn_campaign
  ON escrow_transactions(campaign_id);

CREATE INDEX IF NOT EXISTS idx_escrow_txn_status
  ON escrow_transactions(status);

-- ────────────────────────────────────────
-- 3. Enhance campaigns table for Stripe
-- ────────────────────────────────────────
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT,
  ADD COLUMN IF NOT EXISTS stripe_transfer_id    TEXT,
  ADD COLUMN IF NOT EXISTS paid_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_release_at       TIMESTAMPTZ;

-- ────────────────────────────────────────
-- 4. Brand payment methods (Stripe Customer IDs)
-- ────────────────────────────────────────
-- We store the Stripe customer ID against the brand's email/auth so
-- they don't have to re-enter card details for every brief.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS brand_stripe_customer TEXT;

-- Separate table for brand Stripe customer mapping
CREATE TABLE IF NOT EXISTS brand_customers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id        UUID UNIQUE REFERENCES auth.users(id),
  email               TEXT NOT NULL UNIQUE,
  stripe_customer_id  TEXT NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_customers_email
  ON brand_customers(email);

-- ────────────────────────────────────────
-- 5. Row Level Security
-- ────────────────────────────────────────

-- connected_accounts: creators read own, no client writes
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'connected_accounts' AND policyname = 'creators_read_own_account') THEN
    EXECUTE 'CREATE POLICY "creators_read_own_account" ON connected_accounts FOR SELECT USING (creator_id = get_my_creator_id())';
  END IF;
END $$;

-- escrow_transactions: campaign participants only
ALTER TABLE escrow_transactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'escrow_transactions' AND policyname = 'campaign_participants_read_txns') THEN
    EXECUTE 'CREATE POLICY "campaign_participants_read_txns" ON escrow_transactions FOR SELECT USING (
      campaign_id IN (
        SELECT id FROM campaigns WHERE brand_name = (SELECT email FROM auth.users WHERE id = auth.uid())
        UNION
        SELECT id FROM campaigns WHERE creator_id = get_my_creator_id()
      )
    )';
  END IF;
END $$;

-- brand_customers: zero client access (service_role only)
ALTER TABLE brand_customers ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────
-- 6. Triggers
-- ────────────────────────────────────────
DROP TRIGGER IF EXISTS set_connected_accounts_updated ON connected_accounts;
CREATE TRIGGER set_connected_accounts_updated
  BEFORE UPDATE ON connected_accounts
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ═══════════════════════════════════════════════════════════════════
