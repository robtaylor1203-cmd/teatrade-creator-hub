import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabase.ts';
import { sendEmail } from '../_shared/email.ts';

/**
 * notify-creator-paid — Sends a celebration email when content is approved and escrow released.
 *
 * Body: { campaign_id }
 */
serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { campaign_id } = await req.json();
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: 'campaign_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = getServiceClient();

    // Get campaign
    const { data: campaign } = await sb
      .from('campaigns')
      .select('title, budget')
      .eq('id', campaign_id)
      .single();

    if (!campaign) {
      return new Response(JSON.stringify({ error: 'Campaign not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the accepted creator for this campaign
    const { data: invite } = await sb
      .from('campaign_invites')
      .select('creator_id, creators(email, display_name)')
      .eq('campaign_id', campaign_id)
      .eq('status', 'accepted')
      .maybeSingle();

    if (!invite?.creators?.email) {
      return new Response(JSON.stringify({ error: 'No accepted creator found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const creator = invite.creators as { email: string; display_name?: string };
    const creatorName = creator.display_name || 'Creator';
    const budget = campaign.budget ? `£${Number(campaign.budget).toLocaleString()}` : '';
    const dashUrl = Deno.env.get('FRONTEND_URL') || 'https://creator.teatrade.co.uk';

    await sendEmail({
      to: creator.email,
      subject: `🎉 Content Approved — Payment Released!`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; background: #0A0C0B; color: #fff;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-size: 1.8rem; margin: 0; font-family: Georgia, serif;">TeaTrade<span style="color: #00FF85;">.</span></h1>
          </div>
          <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(0,255,133,0.15); border-radius: 16px; padding: 32px; text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 12px;">🎉</div>
            <p style="color: #00FF85; font-size: 0.65rem; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; margin: 0 0 16px;">CONTENT APPROVED</p>
            <h2 style="font-size: 1.4rem; margin: 0 0 8px; font-family: Georgia, serif;">${campaign.title || 'Campaign'}</h2>
            <p style="opacity: 0.5; font-size: 0.9rem; margin: 0 0 24px;">Congratulations ${creatorName}! The brand has approved your content and payment has been released.</p>
            ${budget ? `<div style="font-size: 2.4rem; font-weight: 900; color: #00FF85; margin-bottom: 8px;">${budget}</div><div style="opacity: 0.3; font-size: 0.8rem; margin-bottom: 24px;">Released to your connected Stripe account</div>` : ''}
            <a href="${dashUrl}/creator-dash.html" style="display: inline-block; background: #00FF85; color: #000; font-weight: 800; font-size: 0.7rem; letter-spacing: 2px; text-transform: uppercase; text-decoration: none; padding: 14px 32px; border-radius: 40px;">VIEW IN DASHBOARD</a>
          </div>
          <p style="text-align: center; opacity: 0.2; font-size: 0.75rem; margin-top: 24px;">TeaTrade — Vetted Creator Network</p>
        </div>
      `,
    });

    return new Response(JSON.stringify({ sent: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
