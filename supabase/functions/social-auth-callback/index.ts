/**
 * social-auth-callback — Handles the OAuth redirect from Instagram / TikTok.
 *
 * GET /functions/v1/social-auth-callback?code=XXX&state=XXX
 *
 * This function:
 * 1. Validates the CSRF state
 * 2. Exchanges the code for access + refresh tokens
 * 3. Encrypts and stores the tokens
 * 4. Fetches the user's profile info and initial metrics
 * 5. Updates creator_socials + metric_snapshots
 * 6. Redirects the user back to the creator dashboard
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabase.ts';
import { getPlatform } from '../_shared/platforms.ts';
import { encrypt } from '../_shared/crypto.ts';

serve(async (req: Request) => {
  const url = new URL(req.url);

  // Handle error responses from the OAuth provider
  const errorParam = url.searchParams.get('error');
  if (errorParam) {
    const errorDesc = url.searchParams.get('error_description') || 'Authorization denied';
    console.error('OAuth provider error:', errorParam, errorDesc);

    const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://teatrade.co';
    return Response.redirect(
      `${frontendUrl}/creator-dash.html?oauth_error=${encodeURIComponent(errorDesc)}`,
      302,
    );
  }

  try {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
      const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://teatrade.co';
      return Response.redirect(
        `${frontendUrl}/creator-dash.html?oauth_error=${encodeURIComponent('Invalid callback. Please try connecting again.')}`,
        302,
      );
    }

    const db = getServiceClient();

    // ── 1. Validate CSRF state ──
    const { data: oauthState, error: stateErr } = await db
      .from('oauth_states')
      .select('*')
      .eq('state', state)
      .single();

    if (stateErr || !oauthState) {
      console.error('Invalid or expired state:', state);
      const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://teatrade.co';
      return Response.redirect(
        `${frontendUrl}/creator-dash.html?oauth_error=${encodeURIComponent('Session expired. Please try again.')}`,
        302,
      );
    }

    // Check expiry
    if (new Date(oauthState.expires_at) < new Date()) {
      await db.from('oauth_states').delete().eq('state', state);
      const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://teatrade.co';
      return Response.redirect(
        `${frontendUrl}/creator-dash.html?oauth_error=${encodeURIComponent('Session expired. Please try again.')}`,
        302,
      );
    }

    // Delete the state immediately (single use)
    await db.from('oauth_states').delete().eq('state', state);

    const { creator_id, platform, redirect_url } = oauthState;

    // ── 2. Exchange code for tokens ──
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const redirectUri = `${supabaseUrl}/functions/v1/social-auth-callback`;

    const platformCfg = getPlatform(platform);
    const tokenResponse = await platformCfg.exchangeToken(code, redirectUri);

    // ── 3. Encrypt and store tokens ──
    const encryptedAccess = await encrypt(tokenResponse.access_token);
    const encryptedRefresh = tokenResponse.refresh_token
      ? await encrypt(tokenResponse.refresh_token)
      : null;

    const expiresAt = tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
      : null;

    await db.from('social_tokens').upsert({
      creator_id,
      platform,
      access_token: encryptedAccess,
      refresh_token: encryptedRefresh,
      token_expires_at: expiresAt,
      scopes: tokenResponse.scopes || [],
      platform_user_id: tokenResponse.platform_user_id,
    }, { onConflict: 'creator_id, platform' });

    // ── 4. Fetch user info ──
    const userInfo = await platformCfg.fetchUserInfo(tokenResponse.access_token);

    // ── 5. Fetch initial metrics ──
    const metrics = await platformCfg.fetchMetrics(
      tokenResponse.access_token,
      tokenResponse.platform_user_id,
    );

    // ── 6. Update creator_socials ──
    await db.from('creator_socials').upsert({
      creator_id,
      platform,
      handle: `@${userInfo.username}`,
      follower_count: metrics.follower_count,
      engagement_rate: metrics.engagement_rate,
      avg_views: metrics.avg_views,
      secondary_metric: metrics.secondary_metric,
      profile_picture_url: userInfo.profile_picture_url || null,
      platform_user_id: userInfo.id,
      last_synced_at: new Date().toISOString(),
      is_verified: true,
    }, { onConflict: 'creator_id, platform' });

    // ── 7. Record metric snapshot ──
    await db.from('metric_snapshots').insert({
      creator_id,
      platform,
      follower_count: metrics.follower_count,
      engagement_rate: metrics.engagement_rate,
      avg_views: metrics.avg_views,
      secondary_metric: metrics.secondary_metric,
    });

    // ── 8. Redirect back to dashboard ──
    const successUrl = `${redirect_url}?oauth_success=${encodeURIComponent(platform)}&handle=${encodeURIComponent(userInfo.username)}`;
    return Response.redirect(successUrl, 302);

  } catch (err) {
    console.error('social-auth-callback error:', err);

    const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://teatrade.co';
    return Response.redirect(
      `${frontendUrl}/creator-dash.html?oauth_error=${encodeURIComponent('Connection failed. Please try again.')}`,
      302,
    );
  }
});
