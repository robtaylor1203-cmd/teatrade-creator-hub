/**
 * Stripe SDK helper for Supabase Edge Functions.
 * Uses Stripe's REST API directly (no Node SDK needed in Deno).
 */

const STRIPE_API = 'https://api.stripe.com/v1';

function getStripeKey(): string {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new Error('Missing STRIPE_SECRET_KEY');
  return key;
}

function authHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${getStripeKey()}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

function encodeParams(params: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (value !== null && value !== undefined) {
      if (typeof value === 'object' && !Array.isArray(value)) {
        parts.push(encodeParams(value as Record<string, unknown>, fullKey));
      } else {
        parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`);
      }
    }
  }
  return parts.filter(Boolean).join('&');
}

async function stripeRequest(method: string, endpoint: string, params?: Record<string, unknown>) {
  const url = `${STRIPE_API}${endpoint}`;
  const opts: RequestInit = {
    method,
    headers: authHeaders(),
  };
  if (params && (method === 'POST' || method === 'DELETE')) {
    opts.body = encodeParams(params);
  }
  const res = await fetch(url, opts);
  const data = await res.json();
  if (data.error) {
    throw new Error(`Stripe error: ${data.error.message}`);
  }
  return data;
}

// ─── Customers (Brands) ───

export async function createCustomer(email: string, name?: string) {
  const params: Record<string, unknown> = { email };
  if (name) params.name = name;
  return stripeRequest('POST', '/customers', params);
}

export async function getCustomer(customerId: string) {
  return stripeRequest('GET', `/customers/${customerId}`);
}

// ─── Connected Accounts (Creators) ───

export async function createConnectedAccount(email: string, creatorId: string) {
  return stripeRequest('POST', '/accounts', {
    type: 'express',
    country: 'GB',
    email,
    capabilities: {
      transfers: { requested: 'true' },
    },
    metadata: {
      creator_id: creatorId,
      platform: 'teatrade',
    },
    business_type: 'individual',
    settings: {
      payouts: {
        schedule: { interval: 'manual' },
      },
    },
  });
}

export async function createAccountLink(accountId: string, refreshUrl: string, returnUrl: string) {
  return stripeRequest('POST', '/account_links', {
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
}

export async function getAccount(accountId: string) {
  return stripeRequest('GET', `/accounts/${accountId}`);
}

// ─── Checkout / Payment Intents ───

export async function createCheckoutSession(params: {
  customerId: string;
  amount: number; // in pence
  campaignId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  return stripeRequest('POST', '/checkout/sessions', {
    customer: params.customerId,
    mode: 'payment',
    currency: 'gbp',
    'line_items[0][price_data][currency]': 'gbp',
    'line_items[0][price_data][unit_amount]': String(params.amount),
    'line_items[0][price_data][product_data][name]': 'TeaTrade Campaign Escrow',
    'line_items[0][quantity]': '1',
    payment_intent_data: {
      capture_method: 'automatic',
      metadata: {
        campaign_id: params.campaignId,
        type: 'escrow_lock',
      },
    },
    metadata: {
      campaign_id: params.campaignId,
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
}

export async function createPaymentIntent(params: {
  amount: number;
  customerId: string;
  campaignId: string;
}) {
  return stripeRequest('POST', '/payment_intents', {
    amount: String(params.amount),
    currency: 'gbp',
    customer: params.customerId,
    capture_method: 'automatic',
    metadata: {
      campaign_id: params.campaignId,
      type: 'escrow_lock',
    },
  });
}

export async function getPaymentIntent(piId: string) {
  return stripeRequest('GET', `/payment_intents/${piId}`);
}

// ─── Transfers (to creator connected accounts) ───

export async function createTransfer(params: {
  amount: number; // in pence
  destinationAccountId: string;
  campaignId: string;
  paymentIntentId?: string;
}) {
  const body: Record<string, unknown> = {
    amount: String(params.amount),
    currency: 'gbp',
    destination: params.destinationAccountId,
    metadata: {
      campaign_id: params.campaignId,
      type: 'escrow_release',
    },
  };
  if (params.paymentIntentId) {
    body.source_transaction = params.paymentIntentId;
  }
  return stripeRequest('POST', '/transfers', body);
}

// ─── Payouts (creator withdrawals to bank) ───

export async function createConnectedPayout(params: {
  amount: number;
  stripeAccountId: string;
}) {
  const url = `${STRIPE_API}/payouts`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Stripe-Account': params.stripeAccountId,
    },
    body: encodeParams({
      amount: String(params.amount),
      currency: 'gbp',
      metadata: { platform: 'teatrade' },
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Stripe error: ${data.error.message}`);
  return data;
}

// ─── Refunds ───

export async function createRefund(paymentIntentId: string, amount?: number) {
  const params: Record<string, unknown> = { payment_intent: paymentIntentId };
  if (amount) params.amount = String(amount);
  return stripeRequest('POST', '/refunds', params);
}

// ─── Balance (for connected accounts) ───

export async function getConnectedBalance(stripeAccountId: string) {
  const url = `${STRIPE_API}/balance`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      ...authHeaders(),
      'Stripe-Account': stripeAccountId,
    },
  });
  const data = await res.json();
  if (data.error) throw new Error(`Stripe error: ${data.error.message}`);
  return data;
}

// ─── Webhook Verification ───

export async function verifyWebhookSignature(
  payload: string,
  sigHeader: string,
): Promise<boolean> {
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) throw new Error('Missing STRIPE_WEBHOOK_SECRET');

  const parts = sigHeader.split(',');
  const timestampPart = parts.find(p => p.startsWith('t='));
  const sigPart = parts.find(p => p.startsWith('v1='));

  if (!timestampPart || !sigPart) return false;

  const timestamp = timestampPart.split('=')[1];
  const signature = sigPart.split('=')[1];

  // Check timestamp tolerance (5 minutes)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');

  return expected === signature;
}
