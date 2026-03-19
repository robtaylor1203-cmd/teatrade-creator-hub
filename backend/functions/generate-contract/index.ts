import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';
import { generateContractHtml } from '../_shared/contract-template.ts';

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

    const { campaign_id } = await req.json();
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: 'campaign_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const db = getServiceClient();

    // 2. Get campaign with all brief details
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

    // 3. Check if contract already exists for this campaign
    const { data: existingContract } = await db
      .from('contracts')
      .select('id, status, contract_ref')
      .eq('campaign_id', campaign_id)
      .single();

    if (existingContract) {
      return new Response(JSON.stringify({
        contract_id: existingContract.id,
        contract_ref: existingContract.contract_ref,
        status: existingContract.status,
        already_exists: true,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Get creator details
    if (!campaign.creator_id) {
      return new Response(JSON.stringify({ error: 'No creator assigned to this campaign' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: creator } = await db
      .from('creators')
      .select('id, email')
      .eq('id', campaign.creator_id)
      .single();

    if (!creator) {
      return new Response(JSON.stringify({ error: 'Creator not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Generate contract reference (TT-YYYYMMDD-XXXX)
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    const contractRef = `TT-${dateStr}-${rand}`;

    // 6. Generate contract HTML
    const contractHtml = generateContractHtml({
      contractRef,
      createdAt: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      brandEmail: campaign.brand_name,
      creatorEmail: creator.email,
      briefTitle: campaign.brief_title || 'Untitled Campaign',
      briefDescription: campaign.brief_description || '',
      videoCount: campaign.video_count || 0,
      photoCount: campaign.photo_count || 0,
      videoLength: campaign.video_length || null,
      platforms: campaign.platforms || [],
      mood: campaign.mood || null,
      setting: campaign.setting || null,
      escrowAmount: Number(campaign.escrow_amount) || 0,
      platformFee: Number(campaign.platform_fee) || 0,
      creatorPayout: Number(campaign.creator_payout) || 0,
    });

    // 7. Store contract in database
    const { data: contract, error: insertErr } = await db
      .from('contracts')
      .insert({
        campaign_id,
        creator_id: creator.id,
        brand_email: campaign.brand_name,
        contract_html: contractHtml,
        contract_ref: contractRef,
        status: 'draft',
      })
      .select()
      .single();

    if (insertErr) throw new Error(`Failed to create contract: ${insertErr.message}`);

    // 8. Link contract to campaign
    await db.from('campaigns').update({ contract_id: contract.id }).eq('id', campaign_id);

    return new Response(JSON.stringify({
      contract_id: contract.id,
      contract_ref: contractRef,
      status: 'draft',
      contract_html: contractHtml,
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
