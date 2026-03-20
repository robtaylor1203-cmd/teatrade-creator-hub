import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';

serve(async (req) => {
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

    const { campaign_id, role } = await req.json();
    if (!campaign_id || !['brand', 'creator'].includes(role)) {
      return new Response(JSON.stringify({ error: 'campaign_id and role (brand|creator) required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = getServiceClient();

    // Fetch campaign data
    const { data: campaign, error: cErr } = await sb
      .from('campaigns')
      .select('*')
      .eq('id', campaign_id)
      .single();

    if (cErr || !campaign) {
      return new Response(JSON.stringify({ error: 'Campaign not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch escrow transactions for this campaign
    const { data: txns } = await sb
      .from('escrow_transactions')
      .select('*')
      .eq('campaign_id', campaign_id)
      .order('created_at', { ascending: true });

    // Calculate financials
    const grossBudget = campaign.total_budget || 0;
    const platformFee = campaign.platform_fee || (grossBudget * 0.12);
    const creatorPayout = campaign.creator_payout || (grossBudget - platformFee);

    const invoiceNumber = `TT-${campaign_id.substring(0, 8).toUpperCase()}`;
    const issueDate = new Date().toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    const paidDate = campaign.updated_at
      ? new Date(campaign.updated_at).toLocaleDateString('en-GB', {
          day: 'numeric', month: 'long', year: 'numeric',
        })
      : issueDate;

    // Build HTML invoice
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Invoice ${invoiceNumber}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    color: #1a1a1a;
    background: #fff;
    padding: 48px;
    max-width: 800px;
    margin: 0 auto;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 48px;
    padding-bottom: 24px;
    border-bottom: 2px solid #0a0c0b;
  }
  .brand { font-size: 28px; font-weight: 900; letter-spacing: -0.5px; }
  .brand span { color: #00FF85; }
  .invoice-meta { text-align: right; font-size: 13px; line-height: 1.8; color: #666; }
  .invoice-meta strong { color: #1a1a1a; }
  .parties {
    display: flex;
    justify-content: space-between;
    margin-bottom: 40px;
  }
  .party { font-size: 13px; line-height: 1.8; }
  .party-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #999;
    margin-bottom: 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 32px;
  }
  th {
    text-align: left;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #999;
    padding: 12px 0;
    border-bottom: 1px solid #e5e5e5;
  }
  th:last-child, td:last-child { text-align: right; }
  td {
    padding: 14px 0;
    font-size: 14px;
    border-bottom: 1px solid #f0f0f0;
  }
  .total-row td {
    border-bottom: 2px solid #0a0c0b;
    font-weight: 700;
    font-size: 16px;
    padding-top: 16px;
  }
  .footer {
    margin-top: 48px;
    padding-top: 24px;
    border-top: 1px solid #e5e5e5;
    font-size: 11px;
    color: #999;
    line-height: 1.8;
    text-align: center;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">TeaTrade<span>.</span></div>
    <div class="invoice-meta">
      <strong>Invoice ${invoiceNumber}</strong><br>
      Issued: ${issueDate}<br>
      Payment Date: ${paidDate}<br>
      Status: PAID
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="party-label">From</div>
      TeaTrade Ltd<br>
      creator.teatrade.co.uk<br>
      contact@teatrade.co.uk
    </div>
    <div class="party">
      <div class="party-label">${role === 'brand' ? 'Brand' : 'Creator'}</div>
      ${role === 'brand' ? (campaign.brand_name || 'Brand') : (campaign.matched_creator_name || campaign.matched_creator || 'Creator')}<br>
      Campaign: ${campaign.brief_title || 'Untitled'}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      ${role === 'brand' ? `
      <tr>
        <td>Campaign escrow — ${campaign.brief_title}</td>
        <td>&pound;${grossBudget.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
      </tr>
      <tr>
        <td>Creator payout</td>
        <td>&pound;${creatorPayout.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
      </tr>
      <tr>
        <td>TeaTrade platform fee (12%)</td>
        <td>&pound;${platformFee.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
      </tr>
      <tr class="total-row">
        <td>Total Charged</td>
        <td>&pound;${grossBudget.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
      </tr>
      ` : `
      <tr>
        <td>Campaign payment — ${campaign.brief_title}</td>
        <td>&pound;${grossBudget.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
      </tr>
      <tr>
        <td>Platform fee deducted (12%)</td>
        <td>-&pound;${platformFee.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
      </tr>
      <tr class="total-row">
        <td>Net Payment to Creator</td>
        <td>&pound;${creatorPayout.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
      </tr>
      `}
    </tbody>
  </table>

  <div class="footer">
    TeaTrade Ltd &mdash; Escrow-protected influencer marketplace<br>
    This is a system-generated invoice. All funds were held in escrow and released upon content approval.
  </div>
</body>
</html>`;

    return new Response(JSON.stringify({ html, invoice_number: invoiceNumber }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
