/**
 * claim-founding-spot  –  Auto-activate verified creators within the first 100
 *
 * POST /functions/v1/claim-founding-spot
 * Auth: Bearer <user JWT>
 *
 * Logic:
 *   1. Verify the caller is a verified creator who hasn't paid yet
 *   2. Count how many creators already have has_paid = true
 *   3. If < 100 → set has_paid = true, return { activated: true, spot_number }
 *   4. If >= 100 → return { activated: false, spots_remaining: 0 }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const FOUNDING_LIMIT = 100;

serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const user = await getAuthUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const db = getServiceClient();

    // Get the creator record
    const { data: creator, error: cErr } = await db
      .from('creators')
      .select('id, is_verified, has_paid')
      .eq('email', user.email)
      .single();

    if (cErr || !creator) {
      return new Response(JSON.stringify({ error: 'Creator not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!creator.is_verified) {
      return new Response(JSON.stringify({ error: 'Not verified' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Already activated
    if (creator.has_paid) {
      return new Response(JSON.stringify({ activated: true, already: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Count current founding members (atomically via service role)
    const { count, error: countErr } = await db
      .from('creators')
      .select('id', { count: 'exact', head: true })
      .eq('has_paid', true);

    if (countErr) {
      return new Response(JSON.stringify({ error: 'Count query failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const currentCount = count ?? 0;

    if (currentCount >= FOUNDING_LIMIT) {
      return new Response(
        JSON.stringify({ activated: false, spots_remaining: 0, total_claimed: currentCount }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Activate this creator as a founding member
    const { error: upErr } = await db
      .from('creators')
      .update({
        has_paid: true,
        paid_at: new Date().toISOString(),
        stripe_payment_intent: `founding_member_${currentCount + 1}`,
      })
      .eq('id', creator.id);

    if (upErr) {
      return new Response(JSON.stringify({ error: 'Activation failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const spotNumber = currentCount + 1;

    return new Response(
      JSON.stringify({
        activated: true,
        spot_number: spotNumber,
        spots_remaining: FOUNDING_LIMIT - spotNumber,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
