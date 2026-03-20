/**
 * refresh-metrics — Refreshes social metrics for one or all creators.
 *
 * POST /functions/v1/refresh-metrics
 * Body (optional): { "creator_id": "uuid" }    — omit to refresh ALL linked accounts
 * Auth: Bearer token (Supabase JWT) or service_role key (for cron)
 *
 * This function:
 * 1. Reads all active social_tokens (or just one creator's)
 * 2. Decrypts access tokens
 * 3. Calls platform APIs to fetch fresh metrics
 * 4. Updates creator_socials + inserts metric_snapshots
 * 5. Refreshes tokens that are nearing expiry
 *
 * Schedule via pg_cron or Supabase Cron Jobs (Dashboard → Edge Functions → Schedules):
 *   Every 24 hours for all creators: POST /functions/v1/refresh-metrics (no body)
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';
import { getPlatform } from '../_shared/platforms.ts';
import { decrypt, encrypt } from '../_shared/crypto.ts';
import { sendEmail } from '../_shared/email.ts';

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const db = getServiceClient();
    let creatorFilter: string | null = null;

    // If called with a body, extract creator_id filter
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        creatorFilter = body?.creator_id || null;
      } catch {
        // No body or invalid JSON — refresh all
      }
    }

    // For user-initiated refresh, verify auth and only refresh their own
    const user = await getAuthUser(req);
    if (user && !creatorFilter) {
      const { data: creator } = await db
        .from('creators')
        .select('id')
        .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
        .single();
      if (creator) creatorFilter = creator.id;
    }

    // ── Fetch all tokens to refresh ──
    let query = db.from('social_tokens').select('*');
    if (creatorFilter) {
      query = query.eq('creator_id', creatorFilter);
    }
    const { data: tokens, error: tokErr } = await query;

    if (tokErr) {
      console.error('Error fetching tokens:', tokErr);
      return new Response(JSON.stringify({ error: 'Failed to fetch tokens' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ message: 'No linked accounts to refresh', refreshed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: Array<{ creator_id: string; platform: string; status: string; error?: string }> = [];

    for (const token of tokens) {
      try {
        const platformCfg = getPlatform(token.platform);
        let accessToken = await decrypt(token.access_token);

        // ── Check if token needs refresh ──
        if (token.token_expires_at) {
          const expiresAt = new Date(token.token_expires_at);
          const refreshThreshold = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days before expiry

          if (expiresAt < refreshThreshold && platformCfg.refreshAccessToken) {
            console.log(`Refreshing ${token.platform} token for creator ${token.creator_id}`);

            const refreshTokenPlain = token.refresh_token
              ? await decrypt(token.refresh_token)
              : accessToken; // Instagram uses access_token for refresh

            const newTokens = await platformCfg.refreshAccessToken(refreshTokenPlain);

            // Encrypt and store new tokens
            const encryptedAccess = await encrypt(newTokens.access_token);
            const encryptedRefresh = newTokens.refresh_token
              ? await encrypt(newTokens.refresh_token)
              : token.refresh_token; // Keep old refresh if not rotated

            const newExpiry = newTokens.expires_in
              ? new Date(Date.now() + newTokens.expires_in * 1000).toISOString()
              : null;

            await db.from('social_tokens').update({
              access_token: encryptedAccess,
              refresh_token: encryptedRefresh,
              token_expires_at: newExpiry,
            }).eq('id', token.id);

            accessToken = newTokens.access_token;
          }
        }

        // ── Fetch fresh metrics ──
        let metrics;
        try {
          metrics = await platformCfg.fetchMetrics(
            accessToken,
            token.platform_user_id || '',
          );
        } catch (apiErr) {
          // Detect expired/revoked tokens (401 Unauthorized)
          const errMsg = apiErr.message || '';
          if (errMsg.includes('401') || errMsg.includes('Unauthorized') || errMsg.includes('expired') || errMsg.includes('invalid_token')) {
            console.warn(`Token expired/revoked for ${token.platform} creator ${token.creator_id}`);

            // Mark token as invalid
            await db.from('social_tokens').update({ is_valid: false }).eq('id', token.id);

            // Get creator email for notification
            const { data: creator } = await db.from('creators').select('email').eq('id', token.creator_id).single();
            if (creator?.email) {
              const platformName = token.platform.charAt(0).toUpperCase() + token.platform.slice(1);
              try {
                await sendEmail({
                  to: creator.email,
                  subject: `Action Required: Reconnect your ${platformName} to TeaTrade`,
                  html: `
                    <div style="font-family:sans-serif; max-width:500px;">
                      <h2 style="color:#FF5E00;">Reconnection Needed</h2>
                      <p>Your <strong>${platformName}</strong> connection to TeaTrade has expired. This means your verified metrics are no longer updating, which may affect your visibility in brand searches.</p>
                      <p><a href="https://creator.teatrade.co.uk/creator-dash.html" style="display:inline-block; background:#00FF85; color:#000; padding:12px 28px; border-radius:100px; text-decoration:none; font-weight:700; font-size:0.85rem;">Reconnect Now</a></p>
                      <p style="opacity:0.5; font-size:0.85rem;">This only takes 30 seconds — just click the ${platformName} card on your Terminal.</p>
                      <p style="opacity:0.4; font-size:0.8rem;">— TeaTrade</p>
                    </div>
                  `,
                });
              } catch (emailErr) {
                console.error('Token expiry email failed:', emailErr);
              }
            }

            results.push({ creator_id: token.creator_id, platform: token.platform, status: 'token_expired' });
            continue;
          }
          throw apiErr; // Re-throw non-auth errors
        }

        // ── Update creator_socials ──
        await db.from('creator_socials').upsert({
          creator_id: token.creator_id,
          platform: token.platform,
          follower_count: metrics.follower_count,
          engagement_rate: metrics.engagement_rate,
          avg_views: metrics.avg_views,
          secondary_metric: metrics.secondary_metric,
          last_synced_at: new Date().toISOString(),
          is_verified: true,
        }, { onConflict: 'creator_id, platform' });

        // ── Record metric snapshot ──
        await db.from('metric_snapshots').insert({
          creator_id: token.creator_id,
          platform: token.platform,
          follower_count: metrics.follower_count,
          engagement_rate: metrics.engagement_rate,
          avg_views: metrics.avg_views,
          secondary_metric: metrics.secondary_metric,
        });

        results.push({
          creator_id: token.creator_id,
          platform: token.platform,
          status: 'success',
        });

      } catch (err) {
        console.error(`Failed to refresh ${token.platform} for ${token.creator_id}:`, err);
        results.push({
          creator_id: token.creator_id,
          platform: token.platform,
          status: 'error',
          error: err.message,
        });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    return new Response(JSON.stringify({
      message: `Refreshed ${successCount} account(s), ${errorCount} error(s)`,
      refreshed: successCount,
      errors: errorCount,
      details: results,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('refresh-metrics error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
