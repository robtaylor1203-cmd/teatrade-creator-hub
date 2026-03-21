import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';

function getAdminEmails(): string[] {
  const raw = Deno.env.get('ADMIN_EMAILS') || '';
  return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

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

    // Admin gate: verify email against ADMIN_EMAILS env variable
    const adminEmails = getAdminEmails();
    if (adminEmails.length > 0 && !adminEmails.includes((user.email || '').toLowerCase())) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = getServiceClient();

    // ── Creators ──
    const { data: creators } = await sb.from('creators').select('id, has_paid, profile_complete, paid_at, email');
    const totalCreators = creators?.length || 0;
    const paidCreators = creators?.filter((c: any) => c.has_paid)?.length || 0;
    const profileComplete = creators?.filter((c: any) => c.profile_complete)?.length || 0;

    // ── Brand Profiles ──
    const { data: brands } = await sb.from('brand_profiles').select('id, profile_complete, email');
    const totalBrands = brands?.length || 0;
    const brandsComplete = brands?.filter((b: any) => b.profile_complete)?.length || 0;

    // ── Campaigns ──
    const { data: campaigns } = await sb.from('campaigns').select('id, status, escrow_amount, platform_fee, creator_payout, created_at, content_submitted');
    const totalCampaigns = campaigns?.length || 0;

    const statusCounts: Record<string, number> = {};
    let totalBrandSpend = 0;
    let totalPlatformFees = 0;
    let totalCreatorPayouts = 0;
    let contentSubmitted = 0;

    (campaigns || []).forEach((c: any) => {
      statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
      if (c.escrow_amount) totalBrandSpend += Number(c.escrow_amount);
      if (c.platform_fee) totalPlatformFees += Number(c.platform_fee);
      if (c.creator_payout) totalCreatorPayouts += Number(c.creator_payout);
      if (c.content_submitted) contentSubmitted++;
    });

    // ── Campaign Invites ──
    const { data: invites } = await sb.from('campaign_invites').select('id, status');
    const totalInvites = invites?.length || 0;
    const inviteAccepted = invites?.filter((i: any) => i.status === 'accepted')?.length || 0;
    const inviteDeclined = invites?.filter((i: any) => i.status === 'declined')?.length || 0;
    const invitePending = invites?.filter((i: any) => i.status === 'pending')?.length || 0;
    const acceptanceRate = totalInvites > 0 ? ((inviteAccepted / totalInvites) * 100) : 0;

    // ── Content Uploads ──
    const { data: uploads } = await sb.from('content_uploads').select('id, file_type, file_size');
    const totalUploads = uploads?.length || 0;
    const videoUploads = uploads?.filter((u: any) => u.file_type?.startsWith('video'))?.length || 0;
    const photoUploads = uploads?.filter((u: any) => u.file_type?.startsWith('image'))?.length || 0;
    const totalStorageMB = (uploads || []).reduce((sum: number, u: any) => sum + (Number(u.file_size) || 0), 0) / (1024 * 1024);

    // ── Escrow Transactions ──
    const { data: txns } = await sb.from('escrow_transactions').select('id, type, amount, status, created_at');
    let totalEscrowLocked = 0;
    let totalReleased = 0;
    let totalRefunded = 0;
    let entryFees = 0;

    (txns || []).forEach((t: any) => {
      const amt = Number(t.amount) || 0;
      if (t.type === 'lock' && t.status === 'succeeded') totalEscrowLocked += amt;
      if (t.type === 'release' && t.status === 'succeeded') totalReleased += amt;
      if (t.type === 'refund' && t.status === 'succeeded') totalRefunded += amt;
      if (t.type === 'entry_fee' && t.status === 'succeeded') entryFees += amt;
    });

    // ── Connected Accounts (Stripe) ──
    const { data: connectedAccounts } = await sb.from('connected_accounts').select('id, onboarding_complete, payouts_enabled');
    const stripeConnected = connectedAccounts?.filter((a: any) => a.onboarding_complete)?.length || 0;
    const payoutsEnabled = connectedAccounts?.filter((a: any) => a.payouts_enabled)?.length || 0;

    // ── Badges Earned ──
    const { data: earnedBadges } = await sb.from('creator_badges').select('id');
    const totalBadgesEarned = earnedBadges?.length || 0;

    // ── Contracts ──
    const { data: contracts } = await sb.from('contracts').select('id, status');
    const totalContracts = contracts?.length || 0;
    const executedContracts = contracts?.filter((c: any) => c.status === 'fully_executed')?.length || 0;

    // ── Disputes ──
    const { data: disputes } = await sb.from('admin_alerts').select('id, status');
    const totalDisputes = disputes?.length || 0;
    const openDisputes = disputes?.filter((d: any) => d.status === 'open')?.length || 0;

    // ── Social Stats ──
    const { data: socials } = await sb.from('creator_socials').select('id, is_verified');
    const apiVerified = socials?.filter((s: any) => s.is_verified)?.length || 0;
    const selfReported = socials?.filter((s: any) => !s.is_verified)?.length || 0;

    return new Response(JSON.stringify({
      users: {
        totalCreators,
        paidCreators,
        profileComplete,
        totalBrands,
        brandsComplete,
        totalUsers: totalCreators + totalBrands,
      },
      campaigns: {
        total: totalCampaigns,
        statusCounts,
        contentSubmitted,
      },
      invites: {
        total: totalInvites,
        accepted: inviteAccepted,
        declined: inviteDeclined,
        pending: invitePending,
        acceptanceRate: acceptanceRate.toFixed(1),
      },
      financials: {
        totalBrandSpend,
        totalPlatformFees,
        totalCreatorPayouts,
        totalEscrowLocked,
        totalReleased,
        totalRefunded,
        entryFees,
      },
      content: {
        totalUploads,
        videoUploads,
        photoUploads,
        totalStorageMB: totalStorageMB.toFixed(1),
      },
      stripe: {
        connectedAccounts: stripeConnected,
        payoutsEnabled,
      },
      engagement: {
        totalBadgesEarned,
        totalContracts,
        executedContracts,
        totalDisputes,
        openDisputes,
        apiVerified,
        selfReported,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
