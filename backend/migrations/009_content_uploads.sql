-- ═══════════════════════════════════════════════════════════════════
-- TeaTrade — Content uploads table + Storage bucket
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Fully idempotent — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────
-- 1. Content uploads table
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_uploads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  creator_id      UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  file_name       TEXT NOT NULL,
  file_type       TEXT NOT NULL,
  file_size       BIGINT NOT NULL,
  storage_path    TEXT NOT NULL,
  thumbnail_path  TEXT,
  uploaded_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_uploads_campaign ON content_uploads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_content_uploads_creator ON content_uploads(creator_id);

ALTER TABLE content_uploads ENABLE ROW LEVEL SECURITY;

-- Creators can read/write their own uploads
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'content_uploads_creator_read' AND tablename = 'content_uploads') THEN
    EXECUTE 'CREATE POLICY content_uploads_creator_read ON content_uploads FOR SELECT USING (creator_id = auth.uid())';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'content_uploads_creator_insert' AND tablename = 'content_uploads') THEN
    EXECUTE 'CREATE POLICY content_uploads_creator_insert ON content_uploads FOR INSERT WITH CHECK (creator_id = auth.uid())';
  END IF;
END $$;

-- Service role (edge functions) can do anything
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'content_uploads_service' AND tablename = 'content_uploads') THEN
    EXECUTE 'CREATE POLICY content_uploads_service ON content_uploads FOR ALL USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- ────────────────────────────────────────
-- 2. Create Storage bucket for campaign content
--    NOTE: Run these two commands in Supabase SQL Editor:
-- ────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('campaign-content', 'campaign-content', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their own folder
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'campaign_content_upload' 
    AND tablename = 'objects' 
    AND schemaname = 'storage'
  ) THEN
    EXECUTE 'CREATE POLICY campaign_content_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = ''campaign-content'')';
  END IF;
END $$;

-- Allow public reads (brands need to view content)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'campaign_content_read' 
    AND tablename = 'objects' 
    AND schemaname = 'storage'
  ) THEN
    EXECUTE 'CREATE POLICY campaign_content_read ON storage.objects FOR SELECT USING (bucket_id = ''campaign-content'')';
  END IF;
END $$;

-- Allow creators to delete their own uploads
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'campaign_content_delete' 
    AND tablename = 'objects' 
    AND schemaname = 'storage'
  ) THEN
    EXECUTE 'CREATE POLICY campaign_content_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = ''campaign-content'')';
  END IF;
END $$;

-- ────────────────────────────────────────
-- 3. Add content_submitted flag on campaigns
-- ────────────────────────────────────────
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS content_submitted BOOLEAN DEFAULT false;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS content_submitted_at TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ═══════════════════════════════════════════════════════════════════
