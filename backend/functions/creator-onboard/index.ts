import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';
import { createConnectedAccount, createAccountLink } from '../_shared/stripe.ts';

serve(async (req) => {
  // CORS preflight
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

    const db = getServiceClient();
    const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://teatrade.co';

    // 2. Find creator
    let { data: creator } = await db
      .from('creators')
      .select('id, email')
      .eq('auth_user_id', user.id)
      .single();

    if (!creator) {
      // Fallback by email
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

    // 3. Check if already has a connected account
    const { data: existing } = await db
      .from('connected_accounts')
      .select('*')
      .eq('creator_id', creator.id)
      .single();

    if (existing?.onboarding_complete) {
      // Already onboarded — return a login link for dashboard access
      return new Response(JSON.stringify({
        already_onboarded: true,
        message: 'Your Stripe account is already connected and active.',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let stripeAccountId: string;

    if (existing) {
      // Has account but onboarding not complete — create new link
      stripeAccountId = existing.stripe_account_id;
    } else {
      // 4. Create new Stripe Connect Express account
      const account = await createConnectedAccount(creator.email, creator.id);
      stripeAccountId = account.id;

      // Save to DB
      await db.from('connected_accounts').insert({
        creator_id: creator.id,
        stripe_account_id: stripeAccountId,
      });
    }

    // 5. Create onboarding link
    const accountLink = await createAccountLink(
      stripeAccountId,
      `${frontendUrl}/creator-dash.html?stripe_refresh=true`,
      `${frontendUrl}/creator-dash.html?stripe_success=true`,
    );

    return new Response(JSON.stringify({
      url: accountLink.url,
      stripe_account_id: stripeAccountId,
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
