-- Migration 011: Add shipping tracking columns to campaigns
-- Stores carrier, tracking number, and dispatch timestamp

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS shipping_carrier TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS shipping_tracking TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
