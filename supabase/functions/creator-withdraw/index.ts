import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';
import { createConnectedPayout, getConnectedBalance } from '../_shared/stripe.ts';

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    // 1. Authenticate creator
    const user = await getAuthUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const db = getServiceClient();

    // 2. Find creator
    let { data: creator } = await db
      .from('creators')
      .select('id, email')
      .eq('auth_user_id', user.id)
      .single();

    if (!creator) {
      const { data: byEmail } = await db
        .from('creators')
        .select('id, email')
        .eq('email', user.email)
        .single();
      if (!byEmail) {
        return new Response(JSON.stringify({ error: 'Creator profile not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      creator = byEmail;
    }

    // 3. Get connected account
    const { data: connected } = await db
      .from('connected_accounts')
      .select('stripe_account_id, payouts_enabled')
      .eq('creator_id', creator.id)
      .single();

    if (!connected) {
      return new Response(JSON.stringify({ error: 'No Stripe account connected. Please complete onboarding first.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!connected.payouts_enabled) {
      return new Response(JSON.stringify({ error: 'Payouts not yet enabled. Please complete Stripe onboarding and verify your bank details.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Get available balance on connected account
    const balance = await getConnectedBalance(connected.stripe_account_id);
    const availableGBP = balance.available?.find((b: { currency: string }) => b.currency === 'gbp');
    const availableAmount = availableGBP?.amount || 0; // in pence

    if (availableAmount < 5000) { // £50 minimum
      return new Response(JSON.stringify({
        error: 'Minimum withdrawal is £50.',
        available_balance: availableAmount / 100,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Parse requested amount (or default to full balance)
    let body: { amount?: number } = {};
    try { body = await req.json(); } catch { /* no body is fine */ }
    
    let payoutAmount = availableAmount;
    if (body.amount) {
      const requestedPence = Math.round(body.amount * 100);
      if (requestedPence > availableAmount) {
        return new Response(JSON.stringify({ error: 'Requested amount exceeds available balance' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (requestedPence < 5000) {
        return new Response(JSON.stringify({ error: 'Minimum withdrawal is £50' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      payoutAmount = requestedPence;
    }

    // 6. Create payout to creator's bank
    const payout = await createConnectedPayout({
      amount: payoutAmount,
      stripeAccountId: connected.stripe_account_id,
    });

    return new Response(JSON.stringify({
      success: true,
      payout_id: payout.id,
      amount: payoutAmount / 100,
      currency: 'gbp',
      arrival_date: payout.arrival_date,
      status: payout.status,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
