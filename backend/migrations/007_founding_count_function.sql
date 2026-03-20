-- ═══════════════════════════════════════════════════════════════════
-- TeaTrade — Public founding member count function
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Safe to run multiple times (CREATE OR REPLACE).
-- ═══════════════════════════════════════════════════════════════════

-- Returns the number of activated (paid/founding) creators.
-- SECURITY DEFINER so the anon key can call it from the homepage
-- without needing SELECT access on the creators table.
CREATE OR REPLACE FUNCTION get_founding_count()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer FROM creators WHERE has_paid = true;
$$;

-- Allow the anon role to call this function
GRANT EXECUTE ON FUNCTION get_founding_count() TO anon;
GRANT EXECUTE ON FUNCTION get_founding_count() TO authenticated;
