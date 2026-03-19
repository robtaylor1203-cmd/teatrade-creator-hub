import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';
import { createTransfer } from '../_shared/stripe.ts';

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    // 1. Authenticate brand
    const user = await getAuthUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { campaign_id } = await req.json();
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: 'campaign_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const db = getServiceClient();

    // 2. Get campaign
    const { data: campaign, error: campErr } = await db
      .from('campaigns')
      .select('*')
      .eq('id', campaign_id)
      .single();

    if (campErr || !campaign) {
      return new Response(JSON.stringify({ error: 'Campaign not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify ownership
    if (campaign.brand_name !== user.email) {
      return new Response(JSON.stringify({ error: 'Not your campaign' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Must be in reviewable state (idempotency: block if already paid/refunded)
    if (!['review', 'active', 'escrow_locked'].includes(campaign.status)) {
      return new Response(JSON.stringify({ error: `Cannot release escrow — campaign status is "${campaign.status}"` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Idempotency: block if transfer already made
    if (campaign.stripe_transfer_id) {
      return new Response(JSON.stringify({ error: 'Funds have already been released for this campaign' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!campaign.creator_id) {
      return new Response(JSON.stringify({ error: 'No creator assigned to this campaign' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Get creator's connected Stripe account
    const { data: connectedAccount } = await db
      .from('connected_accounts')
      .select('stripe_account_id, payouts_enabled')
      .eq('creator_id', campaign.creator_id)
      .single();

    if (!connectedAccount) {
      return new Response(JSON.stringify({ error: 'Creator has not connected their Stripe account. They must complete onboarding before funds can be released.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!connectedAccount.payouts_enabled) {
      return new Response(JSON.stringify({ error: 'Creator has not completed Stripe onboarding. Payouts are not yet enabled on their account.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Transfer creator payout to their connected account
    const payoutAmountPence = Math.round(campaign.creator_payout * 100);

    const transfer = await createTransfer({
      amount: payoutAmountPence,
      destinationAccountId: connectedAccount.stripe_account_id,
      campaignId: campaign_id,
    });

    // 5. Record escrow transaction — release
    await db.from('escrow_transactions').insert({
      campaign_id,
      type: 'release',
      amount: campaign.creator_payout,
      stripe_transfer_id: transfer.id,
      status: 'succeeded',
      metadata: { creator_id: campaign.creator_id },
    });

    // 6. Record fee transaction
    await db.from('escrow_transactions').insert({
      campaign_id,
      type: 'fee',
      amount: campaign.platform_fee,
      status: 'succeeded',
      metadata: { rate: '12%' },
    });

    // 7. Update campaign status
    await db.from('campaigns').update({
      status: 'paid',
      stripe_transfer_id: transfer.id,
      paid_at: new Date().toISOString(),
    }).eq('id', campaign_id);

    return new Response(JSON.stringify({
      success: true,
      transfer_id: transfer.id,
      creator_payout: campaign.creator_payout,
      platform_fee: campaign.platform_fee,
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
