import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';
import { sendEmail } from '../_shared/email.ts';

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

    const { contract_id } = await req.json();
    if (!contract_id) {
      return new Response(JSON.stringify({ error: 'contract_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const db = getServiceClient();

    // 2. Get contract
    const { data: contract, error: conErr } = await db
      .from('contracts')
      .select('*')
      .eq('id', contract_id)
      .single();

    if (conErr || !contract) {
      return new Response(JSON.stringify({ error: 'Contract not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (contract.status === 'fully_executed') {
      return new Response(JSON.stringify({ error: 'Contract already fully signed', status: 'fully_executed' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (contract.status === 'voided') {
      return new Response(JSON.stringify({ error: 'Contract has been voided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Determine signer role
    const { data: creator } = await db
      .from('creators')
      .select('id, email')
      .eq('id', contract.creator_id)
      .single();

    let signerRole: string;
    const matchesCreator = creator && user.email === creator.email;
    const matchesBrand = user.email === contract.brand_email;

    if (matchesCreator && matchesBrand) {
      // Same person is both creator and brand (e.g. testing) — pick whichever hasn't signed yet
      const { data: creatorSigExists } = await db
        .from('contract_signatures').select('id')
        .eq('contract_id', contract_id).eq('signer_role', 'creator').single();
      signerRole = creatorSigExists ? 'brand' : 'creator';
    } else if (matchesCreator) {
      signerRole = 'creator';
    } else if (matchesBrand) {
      signerRole = 'brand';
    } else {
      return new Response(JSON.stringify({ error: 'You are not a party to this contract' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Check if already signed by this role
    const { data: existingSig } = await db
      .from('contract_signatures')
      .select('id')
      .eq('contract_id', contract_id)
      .eq('signer_role', signerRole)
      .single();

    if (existingSig) {
      return new Response(JSON.stringify({ error: `Already signed as ${signerRole}`, status: contract.status }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Record signature with forensic metadata
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip')
      || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    await db.from('contract_signatures').insert({
      contract_id,
      signer_role: signerRole,
      signer_email: user.email,
      ip_address: clientIp,
      user_agent: userAgent,
    });

    // 6. Check if both parties have now signed
    const { data: allSigs } = await db
      .from('contract_signatures')
      .select('signer_role, signer_email, signed_at, ip_address')
      .eq('contract_id', contract_id);

    const creatorSig = allSigs?.find(s => s.signer_role === 'creator');
    const brandSig = allSigs?.find(s => s.signer_role === 'brand');
    const fullyExecuted = !!(creatorSig && brandSig);

    let newStatus = contract.status;
    if (fullyExecuted) {
      newStatus = 'fully_executed';
    } else if (signerRole === 'creator') {
      newStatus = 'creator_signed';
    }

    // 7. Stamp all available signatures into the contract HTML
    //    This runs on EVERY signature so the other party can see
    //    the existing signature(s) when they view the contract.
    let stampedHtml = contract.contract_html;
    if (creatorSig) {
      stampedHtml = stampedHtml.replace(
        '<div class="sig-meta" id="sig-creator">Awaiting signature…</div>',
        `<div class="sig-meta" id="sig-creator">Signed by ${escHtml(creatorSig.signer_email)}<br>
        ${new Date(creatorSig.signed_at).toLocaleString('en-GB')}<br>
        IP: ${escHtml(creatorSig.ip_address)}</div>`,
      );
    }
    if (brandSig) {
      stampedHtml = stampedHtml.replace(
        '<div class="sig-meta" id="sig-brand">Awaiting signature…</div>',
        `<div class="sig-meta" id="sig-brand">Signed by ${escHtml(brandSig.signer_email)}<br>
        ${new Date(brandSig.signed_at).toLocaleString('en-GB')}<br>
        IP: ${escHtml(brandSig.ip_address)}</div>`,
      );
    }

    // 8. Update contract status + stamped HTML
    const updateData: Record<string, unknown> = { status: newStatus, contract_html: stampedHtml };
    if (fullyExecuted) updateData.fully_executed_at = new Date().toISOString();

    await db.from('contracts').update(updateData).eq('id', contract_id);

    // 9. If fully executed — store final copy and email all parties
    if (fullyExecuted) {
      // Store in Supabase Storage
      const storagePath = `${contract.contract_ref}.html`;
      const { error: storageErr } = await db.storage
        .from('contracts')
        .upload(storagePath, new Blob([stampedHtml], { type: 'text/html' }), {
          contentType: 'text/html',
          upsert: true,
        });

      if (!storageErr) {
        await db.from('contracts').update({ storage_path: storagePath }).eq('id', contract_id);
      }

      // Send email to all parties
      try {
        const emailSubject = `Fully Executed Contract — ${contract.contract_ref}`;
        const emailHtml = buildNotificationEmail(contract.contract_ref, stampedHtml);

        // Send to creator
        await sendEmail({
          to: creatorSig.signer_email,
          subject: emailSubject,
          html: emailHtml,
        });

        // Send to brand
        await sendEmail({
          to: brandSig.signer_email,
          subject: emailSubject,
          html: emailHtml,
        });

        // Send copy to TeaTrade
        await sendEmail({
          to: 'contact@teatrade.co.uk',
          subject: `[COPY] ${emailSubject}`,
          html: emailHtml,
        });
      } catch (emailErr) {
        // Don't fail the whole request if email fails
        console.error('Email send failed:', emailErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      signer_role: signerRole,
      contract_status: newStatus,
      fully_executed: fullyExecuted,
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

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildNotificationEmail(contractRef: string, contractHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; color: #333; padding: 24px; max-width: 640px; margin: 0 auto;">
  <div style="text-align: center; margin-bottom: 24px;">
    <h2 style="color: #FF5E00; margin: 0;">TeaTrade</h2>
    <p style="color: #999; font-size: 13px;">Creator Content Agreement</p>
  </div>
  <p>The following contract has been <strong>fully executed</strong> by both parties:</p>
  <p style="font-size: 18px; font-weight: bold; color: #FF5E00;">${escHtml(contractRef)}</p>
  <p>A copy of the signed contract is included below. You can also print this email or save the HTML as a PDF for your records.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  ${contractHtml}
  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="font-size: 11px; color: #999; text-align: center;">
    This is an automated message from TeaTrade. Do not reply to this email.<br>
    For support, contact <a href="mailto:contact@teatrade.co.uk">contact@teatrade.co.uk</a>
  </p>
</body>
</html>`;
}
