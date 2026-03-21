import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabase.ts';
import { sendEmail } from '../_shared/email.ts';

/**
 * notify-creator-shipped — Sends email to the accepted creator when a brand dispatches product.
 * Body: { campaign_id, carrier, tracking_number }
 */
serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { campaign_id, carrier, tracking_number } = await req.json();
    if (!campaign_id || !carrier || !tracking_number) {
      return new Response(JSON.stringify({ error: 'campaign_id, carrier, and tracking_number required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = getServiceClient();

    // Get campaign details
    const { data: campaign } = await sb
      .from('campaigns')
      .select('brief_title, total_budget')
      .eq('id', campaign_id)
      .single();

    if (!campaign) {
      return new Response(JSON.stringify({ error: 'Campaign not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find the accepted creator for this campaign
    const { data: invite } = await sb
      .from('campaign_invites')
      .select('creator_id')
      .eq('campaign_id', campaign_id)
      .eq('status', 'accepted')
      .limit(1)
      .single();

    if (!invite) {
      return new Response(JSON.stringify({ error: 'No accepted creator for this campaign' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get creator email
    const { data: creator } = await sb
      .from('creators')
      .select('email, display_name')
      .eq('id', invite.creator_id)
      .single();

    if (!creator?.email) {
      return new Response(JSON.stringify({ error: 'Creator email not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const creatorName = creator.display_name || 'Creator';
    const title = campaign.brief_title || 'Campaign';
    const dashUrl = Deno.env.get('FRONTEND_URL') || 'https://creator.teatrade.co.uk';

    await sendEmail({
      to: creator.email,
      subject: `Product Dispatched: ${title}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; background: #0A0C0B; color: #fff;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-size: 1.8rem; margin: 0; font-family: Georgia, serif;">TeaTrade<span style="color: #00FF85;">.</span></h1>
          </div>
          <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 32px;">
            <p style="color: #60a5fa; font-size: 0.65rem; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; margin: 0 0 16px;">PRODUCT SHIPPED</p>
            <h2 style="font-size: 1.4rem; margin: 0 0 8px; font-family: Georgia, serif;">${title}</h2>
            <p style="opacity: 0.5; font-size: 0.9rem; margin: 0 0 20px;">Hi ${creatorName}, the brand has dispatched your product. Keep an eye out for delivery!</p>
            <div style="display: grid; gap: 12px; margin-bottom: 24px;">
              <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                <span style="opacity: 0.4; font-size: 0.85rem;">Carrier</span>
                <span style="font-weight: 700;">${carrier}</span>
              </div>
              <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                <span style="opacity: 0.4; font-size: 0.85rem;">Tracking Number</span>
                <span style="font-weight: 700; font-size: 0.85rem;">${tracking_number}</span>
              </div>
            </div>
            <a href="${dashUrl}/creator-dash.html" style="display: block; text-align: center; background: #60a5fa; color: #000; font-weight: 800; font-size: 0.7rem; letter-spacing: 2px; text-transform: uppercase; text-decoration: none; padding: 14px 0; border-radius: 40px;">OPEN DASHBOARD</a>
          </div>
          <p style="text-align: center; opacity: 0.2; font-size: 0.75rem; margin-top: 24px;">TeaTrade — Vetted Creator Network</p>
        </div>
      `,
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
