/**
 * disconnect-social — Removes a linked social account.
 *
 * POST /functions/v1/disconnect-social
 * Body: { "platform": "instagram" | "tiktok" }
 * Auth: Bearer token (Supabase JWT)
 *
 * This function:
 * 1. Verifies the authenticated user
 * 2. Deletes the encrypted tokens
 * 3. Clears the creator_socials entry
 * 4. Returns confirmation
 *
 * Note: Platform-side token revocation:
 *   - Instagram: Long-lived tokens expire naturally (60 days). No revocation API.
 *   - TikTok: Tokens can be revoked via https://open.tiktokapis.com/v2/oauth/revoke/
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';
import { decrypt } from '../_shared/crypto.ts';

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    // 1. Authenticate user
    const user = await getAuthUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Parse platform
    const { platform } = await req.json();
    if (!platform || !['instagram', 'tiktok'].includes(platform)) {
      return new Response(JSON.stringify({ error: 'Invalid platform' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const db = getServiceClient();

    // 3. Get creator_id
    const { data: creator } = await db
      .from('creators')
      .select('id')
      .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
      .single();

    if (!creator) {
      return new Response(JSON.stringify({ error: 'Creator not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Try to revoke TikTok token on their end
    if (platform === 'tiktok') {
      try {
        const { data: tokenRow } = await db
          .from('social_tokens')
          .select('access_token')
          .eq('creator_id', creator.id)
          .eq('platform', 'tiktok')
          .single();

        if (tokenRow) {
          const accessToken = await decrypt(tokenRow.access_token);
          await fetch('https://open.tiktokapis.com/v2/oauth/revoke/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_key: Deno.env.get('TIKTOK_CLIENT_KEY')!,
              client_secret: Deno.env.get('TIKTOK_CLIENT_SECRET')!,
              token: accessToken,
            }),
          });
        }
      } catch (err) {
        // Non-critical — log and continue
        console.warn('TikTok token revocation failed (non-critical):', err.message);
      }
    }

    // 5. Delete encrypted tokens
    await db
      .from('social_tokens')
      .delete()
      .eq('creator_id', creator.id)
      .eq('platform', platform);

    // 6. Clear creator_socials entry (reset to unlinked state)
    await db
      .from('creator_socials')
      .delete()
      .eq('creator_id', creator.id)
      .eq('platform', platform);

    return new Response(JSON.stringify({
      message: `${platform} account disconnected successfully`,
      platform,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('disconnect-social error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
