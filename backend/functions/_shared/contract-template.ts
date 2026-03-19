/**
 * Contract template generator.
 * Produces a self-contained HTML contract from campaign + creator data.
 */

export interface ContractData {
  contractRef: string;
  createdAt: string;

  // Brand
  brandEmail: string;

  // Creator
  creatorEmail: string;

  // Campaign
  briefTitle: string;
  briefDescription: string;
  videoCount: number;
  photoCount: number;
  videoLength: number | null;
  platforms: string[];
  mood: string | null;
  setting: string | null;

  // Financials
  escrowAmount: number;
  platformFee: number;
  creatorPayout: number;
}

export function generateContractHtml(data: ContractData): string {
  const deliverables: string[] = [];
  if (data.videoCount > 0) deliverables.push(`${data.videoCount} video(s)${data.videoLength ? ` (${data.videoLength}s each)` : ''}`);
  if (data.photoCount > 0) deliverables.push(`${data.photoCount} photo(s)`);
  if (deliverables.length === 0) deliverables.push('As specified in the brief');

  const platformList = data.platforms?.length ? data.platforms.join(', ') : 'As agreed';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>TeaTrade Creator Agreement — ${data.contractRef}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Georgia', 'Times New Roman', serif; color: #1a1a1a; line-height: 1.7; padding: 48px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 22px; text-align: center; margin-bottom: 4px; letter-spacing: 1px; }
  .subtitle { text-align: center; font-size: 13px; color: #666; margin-bottom: 32px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 1.5px; color: #FF5E00; margin: 28px 0 10px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  p, li { font-size: 13.5px; margin-bottom: 8px; }
  ol { padding-left: 20px; }
  ol > li { margin-bottom: 12px; }
  .parties { display: flex; gap: 32px; margin: 16px 0 24px; }
  .party { flex: 1; background: #fafafa; border: 1px solid #eee; border-radius: 6px; padding: 14px; }
  .party-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 4px; }
  .party-value { font-size: 14px; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { text-align: left; padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #eee; }
  th { background: #fafafa; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #666; }
  .amount { font-family: 'Courier New', monospace; font-weight: bold; }
  .sig-block { display: flex; gap: 32px; margin-top: 32px; }
  .sig-box { flex: 1; border: 1px solid #ddd; border-radius: 6px; padding: 20px; min-height: 100px; }
  .sig-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 8px; }
  .sig-line { border-bottom: 1px solid #333; margin: 24px 0 4px; }
  .sig-meta { font-size: 10px; color: #999; }
  .footer { text-align: center; margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; font-size: 11px; color: #999; }
  @media print { body { padding: 24px; } }
</style>
</head>
<body>

<h1>CREATOR CONTENT AGREEMENT</h1>
<p class="subtitle">Contract Ref: ${esc(data.contractRef)} &nbsp;|&nbsp; Generated: ${esc(data.createdAt)}</p>

<div class="parties">
  <div class="party">
    <div class="party-label">Brand (Client)</div>
    <div class="party-value">${esc(data.brandEmail)}</div>
  </div>
  <div class="party">
    <div class="party-label">Creator (Provider)</div>
    <div class="party-value">${esc(data.creatorEmail)}</div>
  </div>
</div>

<h2>1. Campaign Brief</h2>
<p><strong>${esc(data.briefTitle)}</strong></p>
${data.briefDescription ? `<p>${esc(data.briefDescription)}</p>` : ''}

<h2>2. Deliverables</h2>
<table>
  <tr><th>Item</th><th>Detail</th></tr>
  <tr><td>Content</td><td>${deliverables.map(esc).join('; ')}</td></tr>
  <tr><td>Platform(s)</td><td>${esc(platformList)}</td></tr>
  ${data.mood ? `<tr><td>Mood / Tone</td><td>${esc(data.mood)}</td></tr>` : ''}
  ${data.setting ? `<tr><td>Setting</td><td>${esc(data.setting)}</td></tr>` : ''}
</table>

<h2>3. Payment Terms</h2>
<table>
  <tr><th>Item</th><th>Amount (GBP)</th></tr>
  <tr><td>Total Campaign Budget</td><td class="amount">&pound;${data.escrowAmount.toFixed(2)}</td></tr>
  <tr><td>Platform Fee (12%)</td><td class="amount">&pound;${data.platformFee.toFixed(2)}</td></tr>
  <tr><td><strong>Creator Payout</strong></td><td class="amount"><strong>&pound;${data.creatorPayout.toFixed(2)}</strong></td></tr>
</table>
<ol>
  <li>The Total Campaign Budget is held in escrow by TeaTrade (via Stripe) upon posting of the brief.</li>
  <li>The Creator Payout shall be released to the Creator's connected Stripe account within 3 business days of the Brand approving the submitted content.</li>
  <li>If the Brand does not approve or reject within 24 hours of content submission, funds are automatically released to the Creator.</li>
</ol>

<h2>4. Content Rights &amp; Usage Licence</h2>
<ol>
  <li>Upon full payment, the Brand is granted a <strong>perpetual, worldwide, non-exclusive licence</strong> to use, reproduce, distribute, and display the delivered content across all media channels, including but not limited to social media, websites, advertising, and print.</li>
  <li>The Creator retains ownership of the original intellectual property and may use the content in their own portfolio, social channels, and promotional materials.</li>
  <li>The Creator warrants that all delivered content is original work and does not infringe any third-party intellectual property rights.</li>
  <li>The Brand may not sub-licence or sell the content to third parties without the Creator's prior written consent.</li>
</ol>

<h2>5. Creator Obligations</h2>
<ol>
  <li>Deliver content that meets the specifications outlined in the brief within 7 calendar days of confirming receipt of any product samples.</li>
  <li>Ensure all content complies with applicable advertising standards (ASA/CAP Code in the UK), including proper disclosure of the commercial relationship (e.g., #ad, #sponsored).</li>
  <li>Not use the Brand's trademarks, logos, or proprietary materials except as required to fulfil this agreement.</li>
  <li>Maintain confidentiality regarding campaign strategy, unreleased products, and any non-public information shared by the Brand.</li>
</ol>

<h2>6. Brand Obligations</h2>
<ol>
  <li>Provide a complete and accurate brief with all necessary information and assets.</li>
  <li>Ship any required product samples within 3 business days of the Creator sharing their delivery address.</li>
  <li>Review submitted content promptly. If no action is taken within 24 hours, payment will auto-release.</li>
  <li>Raise any content disputes through the TeaTrade platform dispute resolution process.</li>
</ol>

<h2>7. Revisions &amp; Rejection</h2>
<ol>
  <li>The Brand may request <strong>one round of minor revisions</strong> (colour grading, text overlays, trim points) at no additional cost.</li>
  <li>Substantive re-shoots or concept changes require mutual agreement and may incur additional fees.</li>
  <li>The Brand may only reject content for: (a) factual inaccuracy, (b) offensive or harmful material, or (c) material misrepresentation of the brand. All rejections must include evidence and are subject to independent review by TeaTrade.</li>
</ol>

<h2>8. Cancellation &amp; Refund</h2>
<ol>
  <li><strong>Before content creation begins:</strong> Either party may cancel. The Brand receives a full escrow refund minus any applicable processing fees.</li>
  <li><strong>After content is submitted:</strong> The Brand may not cancel. Content disputes are resolved via Clause 10.</li>
  <li><strong>Creator withdrawal:</strong> If the Creator fails to deliver within the agreed timeframe, the Brand is entitled to a full refund.</li>
</ol>

<h2>9. Confidentiality</h2>
<p>Both parties agree to keep confidential any non-public information exchanged during this engagement, including but not limited to: product specifications, marketing strategy, pricing, and campaign performance data. This obligation survives termination of this agreement for a period of 12 months.</p>

<h2>10. Dispute Resolution</h2>
<ol>
  <li>Any dispute shall first be submitted to <strong>TeaTrade's independent review panel</strong> for mediation within 48 hours.</li>
  <li>If mediation fails, disputes shall be resolved by binding arbitration under the rules of the Chartered Institute of Arbitrators (CIArb), with proceedings conducted in England.</li>
  <li>Nothing in this clause limits either party's right to seek injunctive relief in a court of competent jurisdiction.</li>
</ol>

<h2>11. Platform Role</h2>
<p>TeaTrade operates as an intermediary marketplace platform. TeaTrade is not a party to the Brand-Creator commercial relationship. TeaTrade's role is limited to: facilitating introductions, holding funds in escrow, processing payments, and providing dispute mediation. TeaTrade does not guarantee the quality of content produced or the commercial success of any campaign.</p>

<h2>12. Limitation of Liability</h2>
<p>To the maximum extent permitted by law, TeaTrade's aggregate liability under or in connection with this agreement shall not exceed the Platform Fee collected for this campaign. Neither party shall be liable for indirect, consequential, or incidental damages.</p>

<h2>13. Governing Law</h2>
<p>This agreement shall be governed by and construed in accordance with the laws of <strong>England and Wales</strong>. The courts of England and Wales shall have exclusive jurisdiction.</p>

<h2>14. Entire Agreement</h2>
<p>This agreement, together with the campaign brief and TeaTrade's Terms of Service, constitutes the entire agreement between the parties. No amendment shall be effective unless agreed in writing by both parties.</p>

<h2>15. Digital Signatures</h2>
<p>Both parties agree that clicking "I Accept &amp; Sign" on the TeaTrade platform constitutes a valid electronic signature under the Electronic Communications Act 2000 and the eIDAS Regulation. Each signature is recorded with a timestamp, IP address, and user agent for evidential purposes.</p>

<div class="sig-block">
  <div class="sig-box">
    <div class="sig-label">Creator Signature</div>
    <div class="sig-line"></div>
    <div class="sig-meta" id="sig-creator">Awaiting signature…</div>
  </div>
  <div class="sig-box">
    <div class="sig-label">Brand Signature</div>
    <div class="sig-line"></div>
    <div class="sig-meta" id="sig-brand">Awaiting signature…</div>
  </div>
</div>

<div class="footer">
  TeaTrade Creator Network &nbsp;|&nbsp; creator.teatrade.co.uk &nbsp;|&nbsp; contact@teatrade.co.uk<br>
  This document was digitally generated and does not require a wet-ink signature.
</div>

</body>
</html>`;
}

/** Escape HTML entities to prevent XSS in rendered contract */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
