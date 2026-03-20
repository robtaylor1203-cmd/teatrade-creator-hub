import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';
import { sendEmail } from '../_shared/email.ts';

/**
 * notify-brand-upload — Sends email to brand when creator submits content for review.
 *
 * Body: { campaign_id }
 * Auth: Creator must be authenticated.
 */
serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const user = await getAuthUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { campaign_id } = await req.json();
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: 'campaign_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = getServiceClient();

    // Get campaign + brand info
    const { data: campaign } = await sb
      .from('campaigns')
      .select('title, budget, brand_name, brand_id')
      .eq('id', campaign_id)
      .single();

    if (!campaign) {
      return new Response(JSON.stringify({ error: 'Campaign not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get brand email — brand_name field stores the brand email
    const brandEmail = campaign.brand_name;
    if (!brandEmail) {
      return new Response(JSON.stringify({ error: 'Brand email not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get creator info
    const { data: creator } = await sb
      .from('creators')
      .select('display_name, email')
      .eq('id', user.id)
      .single();

    // Get upload count
    const { count } = await sb
      .from('content_uploads')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaign_id)
      .eq('creator_id', user.id);

    const creatorName = creator?.display_name || creator?.email || 'A creator';
    const fileCount = count || 0;
    const dashUrl = Deno.env.get('FRONTEND_URL') || 'https://creator.teatrade.co.uk';

    // Mark campaign as content submitted
    await sb.from('campaigns').update({
      content_submitted: true,
      content_submitted_at: new Date().toISOString(),
    }).eq('id', campaign_id);

    await sendEmail({
      to: brandEmail,
      subject: `Content Submitted: ${campaign.title || 'Campaign'}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; background: #0A0C0B; color: #fff;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-size: 1.8rem; margin: 0; font-family: Georgia, serif;">TeaTrade<span style="color: #FF5E00;">.</span></h1>
          </div>
          <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,94,0,0.15); border-radius: 16px; padding: 32px;">
            <p style="color: #FF5E00; font-size: 0.65rem; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; margin: 0 0 16px;">CONTENT READY FOR REVIEW</p>
            <h2 style="font-size: 1.4rem; margin: 0 0 8px; font-family: Georgia, serif;">${campaign.title || 'Campaign'}</h2>
            <p style="opacity: 0.5; font-size: 0.9rem; margin: 0 0 20px;">${creatorName} has submitted ${fileCount} file${fileCount !== 1 ? 's' : ''} for your review.</p>
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 16px; margin-bottom: 24px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="opacity: 0.4; font-size: 0.85rem;">Files</span>
                <span style="font-weight: 700;">${fileCount}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="opacity: 0.4; font-size: 0.85rem;">Budget</span>
                <span style="font-weight: 700; color: #FF5E00;">£${Number(campaign.budget || 0).toLocaleString()}</span>
              </div>
            </div>
            <p style="font-size: 0.78rem; opacity: 0.4; line-height: 1.6; margin-bottom: 24px;">You have 24 hours to review. Content can only be rejected for factual inaccuracies or policy violations. If no action is taken, payment auto-releases.</p>
            <a href="${dashUrl}/brand-dash.html" style="display: block; text-align: center; background: #FF5E00; color: #fff; font-weight: 800; font-size: 0.7rem; letter-spacing: 2px; text-transform: uppercase; text-decoration: none; padding: 14px 0; border-radius: 40px;">REVIEW CONTENT NOW</a>
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
