import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabase.ts';
import { sendEmail } from '../_shared/email.ts';

/**
 * notify-creator — Sends email notification to a creator when they receive a campaign invite.
 * Called from brand-dash after inserting an invite.
 *
 * Body: { creator_id, campaign_id }
 */
serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { creator_id, campaign_id } = await req.json();
    if (!creator_id || !campaign_id) {
      return new Response(JSON.stringify({ error: 'creator_id and campaign_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = getServiceClient();

    // Get creator email
    const { data: creator } = await sb
      .from('creators')
      .select('email, display_name')
      .eq('id', creator_id)
      .single();

    if (!creator?.email) {
      return new Response(JSON.stringify({ error: 'Creator not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get campaign details
    const { data: campaign } = await sb
      .from('campaigns')
      .select('title, budget, deliverables, tea_category')
      .eq('id', campaign_id)
      .single();

    const title = campaign?.title || 'New Campaign';
    const budget = campaign?.budget ? `£${Number(campaign.budget).toLocaleString()}` : 'TBC';
    const deliverables = campaign?.deliverables || 'See dashboard for details';
    const creatorName = creator.display_name || 'Creator';
    const dashUrl = Deno.env.get('FRONTEND_URL') || 'https://creator.teatrade.co.uk';

    await sendEmail({
      to: creator.email,
      subject: `New Campaign Invite: ${title}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; background: #0A0C0B; color: #fff;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-size: 1.8rem; margin: 0; font-family: Georgia, serif;">TeaTrade<span style="color: #00FF85;">.</span></h1>
          </div>
          <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 32px;">
            <p style="color: #00FF85; font-size: 0.65rem; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; margin: 0 0 16px;">NEW CAMPAIGN INVITE</p>
            <h2 style="font-size: 1.4rem; margin: 0 0 8px; font-family: Georgia, serif;">${title}</h2>
            <p style="opacity: 0.5; font-size: 0.9rem; margin: 0 0 20px;">Hi ${creatorName}, a brand has invited you to collaborate.</p>
            <div style="display: grid; gap: 12px; margin-bottom: 24px;">
              <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                <span style="opacity: 0.4; font-size: 0.85rem;">Budget</span>
                <span style="font-weight: 700; color: #00FF85;">${budget}</span>
              </div>
              <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                <span style="opacity: 0.4; font-size: 0.85rem;">Deliverables</span>
                <span style="font-weight: 700; font-size: 0.85rem;">${deliverables}</span>
              </div>
            </div>
            <a href="${dashUrl}/creator-dash.html" style="display: block; text-align: center; background: #00FF85; color: #000; font-weight: 800; font-size: 0.7rem; letter-spacing: 2px; text-transform: uppercase; text-decoration: none; padding: 14px 0; border-radius: 40px;">VIEW INVITE IN DASHBOARD</a>
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
