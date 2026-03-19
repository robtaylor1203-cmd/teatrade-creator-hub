import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';
import { createCheckoutSession } from '../_shared/stripe.ts';

const ENTRY_FEE_PENCE = 4900; // £49

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
    const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://teatrade.co';

    // 2. Find creator profile
    const { data: creator, error: crErr } = await db
      .from('creators')
      .select('id, email, has_paid, is_verified')
      .eq('email', user.email)
      .single();

    if (crErr || !creator) {
      return new Response(JSON.stringify({ error: 'Creator profile not found. Please pass the vetting exam first.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!creator.is_verified) {
      return new Response(JSON.stringify({ error: 'You must pass the vetting exam before paying the entry fee.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Idempotency: already paid
    if (creator.has_paid) {
      return new Response(JSON.stringify({ error: 'Entry fee already paid', already_paid: true }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Create Stripe Checkout Session for £49 entry fee
    const session = await createEntryCheckout({
      email: user.email,
      creatorId: creator.id,
      frontendUrl,
    });

    return new Response(JSON.stringify({
      checkout_url: session.url,
      session_id: session.id,
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

/**
 * Create a Checkout Session specifically for the £49 creator entry fee.
 * Uses inline price_data (no Stripe Product needed).
 */
async function createEntryCheckout(params: {
  email: string;
  creatorId: string;
  frontendUrl: string;
}) {
  const STRIPE_API = 'https://api.stripe.com/v1';
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new Error('Missing STRIPE_SECRET_KEY');

  const body = new URLSearchParams();
  body.append('mode', 'payment');
  body.append('customer_email', params.email);
  body.append('currency', 'gbp');
  body.append('line_items[0][price_data][currency]', 'gbp');
  body.append('line_items[0][price_data][unit_amount]', String(ENTRY_FEE_PENCE));
  body.append('line_items[0][price_data][product_data][name]', 'TeaTrade Creator Network — Entry Fee');
  body.append('line_items[0][quantity]', '1');
  body.append('metadata[creator_id]', params.creatorId);
  body.append('metadata[type]', 'entry_fee');
  body.append('payment_intent_data[metadata][creator_id]', params.creatorId);
  body.append('payment_intent_data[metadata][type]', 'entry_fee');
  body.append('success_url', `${params.frontendUrl}/creator-dash.html?entry_success=true`);
  body.append('cancel_url', `${params.frontendUrl}/creator-dash.html?entry_cancelled=true`);

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data = await res.json();
  if (data.error) throw new Error(`Stripe error: ${data.error.message}`);
  return data;
}
