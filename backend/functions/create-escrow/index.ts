import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';
import { createCustomer, createCheckoutSession } from '../_shared/stripe.ts';

const PLATFORM_FEE_RATE = 0.12; // 12%

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
    const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://teatrade.co';

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

    // Verify the logged-in brand owns this campaign
    if (campaign.brand_name !== user.email) {
      return new Response(JSON.stringify({ error: 'Not your campaign' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Don't allow double-locking
    if (campaign.stripe_payment_intent) {
      return new Response(JSON.stringify({ error: 'Escrow already locked for this campaign' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Calculate escrow amounts (server-side — never trust the client)
    const grossBudget = campaign.total_budget;
    const platformFee = Math.round(grossBudget * PLATFORM_FEE_RATE * 100) / 100;
    const creatorPayout = Math.round((grossBudget - platformFee) * 100) / 100;
    const amountInPence = Math.round(grossBudget * 100);

    // 4. Get or create Stripe customer for this brand
    let { data: brandCustomer } = await db
      .from('brand_customers')
      .select('stripe_customer_id')
      .eq('email', user.email)
      .single();

    if (!brandCustomer) {
      const customer = await createCustomer(user.email);
      await db.from('brand_customers').insert({
        auth_user_id: user.id,
        email: user.email,
        stripe_customer_id: customer.id,
      });
      brandCustomer = { stripe_customer_id: customer.id };
    }

    // 5. Create Stripe Checkout Session
    const session = await createCheckoutSession({
      customerId: brandCustomer.stripe_customer_id,
      amount: amountInPence,
      campaignId: campaign_id,
      successUrl: `${frontendUrl}/brand-dash.html?escrow_success=${campaign_id}`,
      cancelUrl: `${frontendUrl}/brand-dash.html?escrow_cancelled=${campaign_id}`,
    });

    // 6. Update campaign with calculated escrow values
    await db.from('campaigns').update({
      escrow_amount: grossBudget,
      platform_fee: platformFee,
      creator_payout: creatorPayout,
      status: 'pending_payment',
    }).eq('id', campaign_id);

    return new Response(JSON.stringify({
      checkout_url: session.url,
      session_id: session.id,
      escrow: {
        gross: grossBudget,
        fee: platformFee,
        creator_payout: creatorPayout,
      },
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
