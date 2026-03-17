/**
 * social-auth-start — Generates the OAuth redirect URL and creates a CSRF state entry.
 *
 * POST /functions/v1/social-auth-start
 * Body: { "platform": "instagram" | "tiktok" }
 * Auth: Bearer token (Supabase JWT)
 *
 * Returns: { "url": "https://api.instagram.com/oauth/authorize?..." }
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';
import { getPlatform } from '../_shared/platforms.ts';

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    // 1. Authenticate the user
    const user = await getAuthUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Parse request
    const { platform } = await req.json();
    if (!platform || !['instagram', 'tiktok'].includes(platform)) {
      return new Response(JSON.stringify({ error: 'Invalid platform. Use "instagram" or "tiktok".' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Look up creator_id from auth user
    const db = getServiceClient();
    const { data: creator, error: creatorErr } = await db
      .from('creators')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    if (creatorErr || !creator) {
      // Fallback: look up by email
      const { data: creatorByEmail } = await db
        .from('creators')
        .select('id')
        .eq('email', user.email)
        .single();

      if (!creatorByEmail) {
        return new Response(JSON.stringify({ error: 'Creator profile not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Backfill auth_user_id while we're here
      await db.from('creators').update({ auth_user_id: user.id }).eq('id', creatorByEmail.id);
      creator = creatorByEmail;
    }

    // 4. Generate CSRF state token
    const stateBytes = crypto.getRandomValues(new Uint8Array(32));
    const state = Array.from(stateBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    // 5. Build the callback URL (this Edge Function's sibling)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const redirectUri = `${supabaseUrl}/functions/v1/social-auth-callback`;

    // 6. Where to send the user after OAuth completes
    const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://teatrade.co';
    const finalRedirect = `${frontendUrl}/creator-dash.html`;

    // 7. Store state in DB for validation on callback
    await db.from('oauth_states').insert({
      state,
      creator_id: creator.id,
      platform,
      redirect_url: finalRedirect,
    });

    // Clean up any expired states while we're here
    await db.rpc('cleanup_expired_oauth_states');

    // 8. Build the OAuth authorization URL
    const platformCfg = getPlatform(platform);
    const params = platformCfg.buildAuthParams(state, redirectUri);
    const authUrl = `${platformCfg.authUrl}?${params.toString()}`;

    return new Response(JSON.stringify({ url: authUrl }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('social-auth-start error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
