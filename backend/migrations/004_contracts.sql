-- ═══════════════════════════════════════════════════════════════════
-- TeaTrade — Contract System Schema
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- This migration is fully idempotent — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────
-- 1. Contracts table
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contracts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id),
  creator_id      UUID NOT NULL REFERENCES creators(id),
  brand_email     TEXT NOT NULL,
  contract_html   TEXT NOT NULL,
  contract_ref    TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'creator_signed', 'fully_executed', 'voided')),
  storage_path    TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  fully_executed_at TIMESTAMPTZ,
  voided_at       TIMESTAMPTZ
);

-- ────────────────────────────────────────
-- 2. Contract signatures table
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_signatures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID NOT NULL REFERENCES contracts(id),
  signer_role     TEXT NOT NULL CHECK (signer_role IN ('creator', 'brand')),
  signer_email    TEXT NOT NULL,
  signed_at       TIMESTAMPTZ DEFAULT now(),
  ip_address      TEXT,
  user_agent      TEXT,
  UNIQUE(contract_id, signer_role)
);

-- ────────────────────────────────────────
-- 3. Add contract_id to campaigns for quick lookup
-- ────────────────────────────────────────
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS contract_id UUID REFERENCES contracts(id);

-- ────────────────────────────────────────
-- 4. Indexes
-- ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_contracts_campaign ON contracts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_contracts_creator ON contracts(creator_id);
CREATE INDEX IF NOT EXISTS idx_contracts_brand ON contracts(brand_email);
CREATE INDEX IF NOT EXISTS idx_contracts_ref ON contracts(contract_ref);
CREATE INDEX IF NOT EXISTS idx_signatures_contract ON contract_signatures(contract_id);

-- ────────────────────────────────────────
-- 5. Supabase Storage bucket for contracts
--    Run this separately if it fails (bucket may already exist)
-- ────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('contracts', 'contracts', false)
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ═══════════════════════════════════════════════════════════════════
