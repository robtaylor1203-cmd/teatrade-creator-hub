import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';
import { createRefund } from '../_shared/stripe.ts';

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    // 1. Authenticate
    const user = await getAuthUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { campaign_id, reason } = await req.json();
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

    // 3. Verify the requesting user owns this campaign
    if (campaign.brand_name !== user.email) {
      return new Response(JSON.stringify({ error: 'Not your campaign' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Block refund on terminal statuses AND after funds have been released
    if (['paid', 'refunded', 'payment_failed'].includes(campaign.status)) {
      return new Response(JSON.stringify({ error: `Cannot refund — campaign status is "${campaign.status}"` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Block refund if a transfer has already been made (funds already with creator)
    if (campaign.stripe_transfer_id) {
      return new Response(JSON.stringify({ error: 'Cannot refund — funds have already been released to the creator' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!campaign.stripe_payment_intent) {
      return new Response(JSON.stringify({ error: 'No payment to refund' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Issue Stripe refund
    const refund = await createRefund(campaign.stripe_payment_intent);

    // 6. Record escrow transaction
    await db.from('escrow_transactions').insert({
      campaign_id,
      type: 'refund',
      amount: campaign.escrow_amount,
      stripe_payment_intent: campaign.stripe_payment_intent,
      stripe_refund_id: refund.id,
      status: 'succeeded',
      metadata: { reason: reason || 'dispute_upheld' },
    });

    // 7. Update campaign
    await db.from('campaigns').update({
      status: 'refunded',
      refunded_at: new Date().toISOString(),
    }).eq('id', campaign_id);

    return new Response(JSON.stringify({
      success: true,
      refund_id: refund.id,
      amount: campaign.escrow_amount,
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
