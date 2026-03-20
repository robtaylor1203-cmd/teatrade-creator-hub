/**
 * dispute-escrow — Brand raises a dispute on a campaign
 *
 * POST /functions/v1/dispute-escrow
 * Auth: Bearer <brand JWT>
 * Body: { campaign_id, reason }
 *
 * Flow:
 *   1. Verify brand owns the campaign
 *   2. Only allow dispute if status is 'review' or 'escrow_locked'
 *   3. Freeze campaign status to 'disputed'
 *   4. Insert admin_alerts record for mediation
 *   5. Email both brand and creator
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { sendEmail } from '../_shared/email.ts';

serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const user = await getAuthUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { campaign_id, reason } = await req.json();
    if (!campaign_id || !reason || reason.trim().length < 10) {
      return new Response(JSON.stringify({ error: 'campaign_id and reason (min 10 chars) are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const db = getServiceClient();

    // Get campaign
    const { data: campaign, error: campErr } = await db
      .from('campaigns')
      .select('*, creators(email, display_name)')
      .eq('id', campaign_id)
      .single();

    if (campErr || !campaign) {
      return new Response(JSON.stringify({ error: 'Campaign not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify brand ownership
    if (campaign.brand_name !== user.email) {
      return new Response(JSON.stringify({ error: 'Not your campaign' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Only allow dispute on reviewable campaigns
    const disputableStatuses = ['review', 'escrow_locked', 'active'];
    if (!disputableStatuses.includes(campaign.status)) {
      return new Response(JSON.stringify({ error: `Cannot dispute — campaign status is "${campaign.status}"` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Already disputed
    if (campaign.status === 'disputed') {
      return new Response(JSON.stringify({ error: 'This campaign is already under dispute' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Freeze the campaign
    const { error: upErr } = await db
      .from('campaigns')
      .update({ status: 'disputed' })
      .eq('id', campaign_id);

    if (upErr) {
      return new Response(JSON.stringify({ error: 'Failed to update campaign status' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create admin alert for mediation
    const creatorEmail = campaign.creators?.email || 'unknown';
    const creatorName = campaign.creators?.display_name || creatorEmail;

    await db.from('admin_alerts').insert({
      alert_type: 'dispute',
      campaign_id,
      brand_email: user.email,
      creator_email: creatorEmail,
      reason: reason.trim(),
    });

    // Email both parties
    const brandHtml = `
      <div style="font-family:sans-serif; max-width:500px;">
        <h2 style="color:#FF5E00;">Dispute Received</h2>
        <p>Your dispute for campaign <strong>"${campaign.brief_title}"</strong> has been received and is now under review.</p>
        <p><strong>Your reason:</strong> ${reason.trim()}</p>
        <p>Escrow funds are frozen until our team completes the review. We aim to resolve all disputes within 48 hours.</p>
        <p style="opacity:0.5; font-size:0.85rem;">— TeaTrade Mediation Team</p>
      </div>
    `;

    const creatorHtml = `
      <div style="font-family:sans-serif; max-width:500px;">
        <h2 style="color:#FF5E00;">Campaign Under Review</h2>
        <p>The brand has raised a concern regarding campaign <strong>"${campaign.brief_title}"</strong>.</p>
        <p>Escrow funds are temporarily frozen while our independent mediation team reviews the submission. You do not need to take any action at this time.</p>
        <p>We aim to resolve all reviews within 48 hours and will notify you of the outcome.</p>
        <p style="opacity:0.5; font-size:0.85rem;">— TeaTrade Mediation Team</p>
      </div>
    `;

    // Send emails (don't fail the request if email fails)
    try {
      await sendEmail({ to: user.email, subject: `Dispute Received — ${campaign.brief_title}`, html: brandHtml });
      if (creatorEmail !== 'unknown') {
        await sendEmail({ to: creatorEmail, subject: `Campaign Under Review — ${campaign.brief_title}`, html: creatorHtml });
      }
    } catch (emailErr) {
      console.error('Dispute email failed:', emailErr);
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Dispute filed. Both parties have been notified. Mediation will begin within 48 hours.',
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
