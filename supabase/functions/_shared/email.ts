/**
 * Email helper using Resend API.
 * Set RESEND_API_KEY in Supabase secrets.
 * Set EMAIL_FROM to your verified sender (e.g. contracts@teatrade.co.uk).
 */

const RESEND_API = 'https://api.resend.com/emails';

function getResendKey(): string {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) throw new Error('Missing RESEND_API_KEY');
  return key;
}

function getFromAddress(): string {
  return Deno.env.get('EMAIL_FROM') || 'TeaTrade <contracts@teatrade.co.uk>';
}

export async function sendEmail(params: {
  to: string | string[];
  subject: string;
  html: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
}) {
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getResendKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: getFromAddress(),
      to: Array.isArray(params.to) ? params.to : [params.to],
      subject: params.subject,
      html: params.html,
      cc: params.cc ? (Array.isArray(params.cc) ? params.cc : [params.cc]) : undefined,
      bcc: params.bcc ? (Array.isArray(params.bcc) ? params.bcc : [params.bcc]) : undefined,
      reply_to: params.replyTo,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Email error: ${data.message || JSON.stringify(data)}`);
  }
  return data;
}
