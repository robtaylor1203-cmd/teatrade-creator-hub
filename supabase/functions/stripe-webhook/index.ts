import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase.ts';
import { verifyWebhookSignature } from '../_shared/stripe.ts';

serve(async (req) => {
  // Webhooks are POST only — no CORS needed (Stripe → server)
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload = await req.text();
    const sigHeader = req.headers.get('stripe-signature');

    if (!sigHeader) {
      return new Response('Missing signature', { status: 400 });
    }

    // Verify webhook authenticity
    const valid = await verifyWebhookSignature(payload, sigHeader);
    if (!valid) {
      return new Response('Invalid signature', { status: 400 });
    }

    const event = JSON.parse(payload);
    const db = getServiceClient();

    // ── Idempotency guard: skip if event already processed ──
    const { data: existing } = await db
      .from('processed_webhook_events')
      .select('event_id')
      .eq('event_id', event.id)
      .single();

    if (existing) {
      return new Response(JSON.stringify({ received: true, skipped: 'duplicate' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Record this event as processed BEFORE handling (claim it)
    await db.from('processed_webhook_events').insert({
      event_id: event.id,
      event_type: event.type,
    });

    switch (event.type) {
      // ─── Checkout completed → Lock escrow OR confirm entry fee ───
      case 'checkout.session.completed': {
        const session = event.data.object;
        const metadataType = session.metadata?.type;
        const paymentIntentId = session.payment_intent;

        // ── Entry fee payment ──
        if (metadataType === 'entry_fee') {
          const creatorId = session.metadata?.creator_id;
          if (!creatorId) break;

          await db.from('creators').update({
            has_paid: true,
            stripe_payment_intent: paymentIntentId,
            paid_at: new Date().toISOString(),
          }).eq('id', creatorId);

          // Record in escrow_transactions for audit
          await db.from('escrow_transactions').insert({
            campaign_id: null,
            type: 'entry_fee',
            amount: 49.00,
            currency: 'gbp',
            stripe_payment_intent: paymentIntentId,
            status: 'succeeded',
            metadata: { creator_id: creatorId },
          });

          break;
        }

        // ── Campaign escrow lock ──
        const campaignId = session.metadata?.campaign_id;
        if (!campaignId) break;

        // Update campaign with payment confirmation
        await db.from('campaigns').update({
          status: 'escrow_locked',
          stripe_payment_intent: paymentIntentId,
          auto_release_at: null, // set when content is submitted
        }).eq('id', campaignId);

        // Record the lock transaction
        const { data: campaign } = await db.from('campaigns').select('escrow_amount').eq('id', campaignId).single();
        
        await db.from('escrow_transactions').insert({
          campaign_id: campaignId,
          type: 'lock',
          amount: campaign?.escrow_amount || 0,
          stripe_payment_intent: paymentIntentId,
          status: 'succeeded',
        });

        break;
      }

      // ─── Payment failed ───
      case 'checkout.session.expired':
      case 'payment_intent.payment_failed': {
        const obj = event.data.object;
        const campaignId = obj.metadata?.campaign_id;
        if (!campaignId) break;

        await db.from('campaigns').update({
          status: 'payment_failed',
        }).eq('id', campaignId);

        break;
      }

      // ─── Transfer completed (creator paid) ───
      case 'transfer.created': {
        const transfer = event.data.object;
        const campaignId = transfer.metadata?.campaign_id;
        if (!campaignId) break;

        // Update the escrow transaction status
        await db.from('escrow_transactions').update({
          status: 'succeeded',
        }).eq('stripe_transfer_id', transfer.id);

        break;
      }

      // ─── Payout to creator bank completed ───
      case 'payout.paid': {
        // Informational — could trigger a notification
        break;
      }

      // ─── Refund succeeded ───
      case 'charge.refunded': {
        const charge = event.data.object;
        const piId = charge.payment_intent;
        if (!piId) break;

        // Find the campaign — only mark refunded if funds haven't been released
        const { data: campaign } = await db
          .from('campaigns')
          .select('id, status, stripe_transfer_id')
          .eq('stripe_payment_intent', piId)
          .single();

        if (campaign && !campaign.stripe_transfer_id && campaign.status !== 'paid') {
          await db.from('campaigns').update({
            status: 'refunded',
            refunded_at: new Date().toISOString(),
          }).eq('id', campaign.id);
        }

        break;
      }

      // ─── Account updated (creator onboarding) ───
      case 'account.updated': {
        const account = event.data.object;
        const stripeAccountId = account.id;

        await db.from('connected_accounts').update({
          onboarding_complete: account.details_submitted || false,
          payouts_enabled: account.payouts_enabled || false,
          charges_enabled: account.charges_enabled || false,
        }).eq('stripe_account_id', stripeAccountId);

        break;
      }

      default:
        // Unhandled event type — that's fine
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    // Always return 200 to Stripe to avoid retries on our processing errors.
    // Log the error server-side for debugging.
    console.error('Webhook processing error:', err);
    return new Response(JSON.stringify({ received: true, error: err.message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
