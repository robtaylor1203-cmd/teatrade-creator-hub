/**
 * CORS headers for Supabase Edge Functions
 * Allows requests from the TeaTrade frontend domains.
 */

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',                              // Tighten to your domain in production
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

/** Standard CORS preflight response */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}
