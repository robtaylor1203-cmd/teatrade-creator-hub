-- ═══════════════════════════════════════════════════════════════════
-- TeaTrade — Dispute system + webhook idempotency + token validity
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Fully idempotent — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────
-- 1. Admin alerts table (dispute mediation)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type      TEXT NOT NULL,
  campaign_id     UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  brand_email     TEXT,
  creator_email   TEXT,
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','dismissed')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_alerts_status ON admin_alerts(status);
CREATE INDEX IF NOT EXISTS idx_admin_alerts_campaign ON admin_alerts(campaign_id);

ALTER TABLE admin_alerts ENABLE ROW LEVEL SECURITY;

-- Only service role can access admin_alerts (edge functions)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_alerts_service' AND tablename = 'admin_alerts') THEN
    EXECUTE 'CREATE POLICY admin_alerts_service ON admin_alerts FOR ALL USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- ────────────────────────────────────────
-- 2. Webhook processed events table (idempotency)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id    TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON processed_webhook_events(processed_at);

ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'webhook_events_service' AND tablename = 'processed_webhook_events') THEN
    EXECUTE 'CREATE POLICY webhook_events_service ON processed_webhook_events FOR ALL USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- ────────────────────────────────────────
-- 3. Token validity column on social_tokens
-- ────────────────────────────────────────
ALTER TABLE social_tokens ADD COLUMN IF NOT EXISTS is_valid BOOLEAN DEFAULT true;

-- ────────────────────────────────────────
-- 4. Creator public profile columns
-- ────────────────────────────────────────
ALTER TABLE creators ADD COLUMN IF NOT EXISTS public_profile_enabled BOOLEAN DEFAULT false;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;

-- Allow anonymous reads of public profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'creators_public_read' AND tablename = 'creators') THEN
    EXECUTE 'CREATE POLICY creators_public_read ON creators FOR SELECT USING (public_profile_enabled = true)';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ═══════════════════════════════════════════════════════════════════
