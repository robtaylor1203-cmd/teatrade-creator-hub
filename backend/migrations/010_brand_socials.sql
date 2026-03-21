-- Migration 010: Add socials JSONB column to brand_profiles
-- Stores social media handles: { instagram, tiktok, twitter, youtube }

ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS socials JSONB DEFAULT '{}';
