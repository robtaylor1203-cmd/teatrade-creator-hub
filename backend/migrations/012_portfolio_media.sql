-- Migration 012: Portfolio media for creator showcase
-- Creators upload up to 5 videos/images as their profile preview
-- Brands see these in the talent pool carousel instead of placeholders

CREATE TABLE IF NOT EXISTS portfolio_media (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    storage_path TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_media_creator ON portfolio_media(creator_id);

-- RLS
ALTER TABLE portfolio_media ENABLE ROW LEVEL SECURITY;

-- Creators can manage their own portfolio
CREATE POLICY portfolio_media_creator_select ON portfolio_media FOR SELECT USING (true);
CREATE POLICY portfolio_media_creator_insert ON portfolio_media FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY portfolio_media_creator_delete ON portfolio_media FOR DELETE USING (auth.uid() = creator_id);

-- Storage bucket for portfolio media (run in Supabase dashboard if needed)
INSERT INTO storage.buckets (id, name, public) VALUES ('portfolio-media', 'portfolio-media', true) ON CONFLICT DO NOTHING;

-- Allow authenticated users to upload to their own folder
CREATE POLICY portfolio_media_upload ON storage.objects FOR INSERT WITH CHECK (
    bucket_id = 'portfolio-media' AND auth.role() = 'authenticated'
);
CREATE POLICY portfolio_media_select ON storage.objects FOR SELECT USING (
    bucket_id = 'portfolio-media'
);
CREATE POLICY portfolio_media_delete ON storage.objects FOR DELETE USING (
    bucket_id = 'portfolio-media' AND auth.role() = 'authenticated'
);
