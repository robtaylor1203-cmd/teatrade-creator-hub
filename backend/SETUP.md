# TeaTrade — Backend Deployment Guide

> Complete setup guide for deploying the social API integration backend.  
> **Estimated time:** 45–60 minutes.

---

## Architecture Overview

```
┌────────────────────────┐      ┌─────────────────────────────┐
│   Creator Dashboard    │      │     Instagram / TikTok      │
│   (creator-dash.html)  │      │     OAuth Servers            │
└────────┬───────────────┘      └──────────┬──────────────────┘
         │ 1. Click "Connect"              │ 3. User authorises
         ▼                                 │
┌────────────────────────┐                 │
│  Edge Function:        │ 2. Redirect ──► │
│  social-auth-start     │                 │
└────────────────────────┘                 │
                                           │ 4. Callback with code
┌────────────────────────┐ ◄───────────────┘
│  Edge Function:        │
│  social-auth-callback  │───► Supabase DB (encrypted tokens + metrics)
└────────┬───────────────┘
         │ 5. Redirect back with ?oauth_success=instagram
         ▼
┌────────────────────────┐
│   Creator Dashboard    │ <── Loads real metrics from creator_socials
└────────────────────────┘

┌────────────────────────┐      Cron (every 24h)
│  Edge Function:        │ ◄─── pg_cron or Supabase Scheduler
│  refresh-metrics       │───► Refreshes all tokens + metrics
└────────────────────────┘

┌────────────────────────┐
│  Edge Function:        │ ◄─── User clicks "Unlink"
│  disconnect-social     │───► Revokes token, deletes records
└────────────────────────┘
```

---

## Prerequisites

1. **Supabase CLI** — [Install guide](https://supabase.com/docs/guides/cli/getting-started)
   ```bash
   npm install -g supabase
   supabase login
   ```

2. **Instagram App** — [Meta for Developers](https://developers.facebook.com/)
   - Create a new app → Add "Instagram Basic Display" product
   - Note your **App ID** and **App Secret**
   - Add redirect URI: `https://hfdjdiduacehchuwvajr.supabase.co/functions/v1/social-auth-callback`

3. **TikTok App** — [TikTok for Developers](https://developers.tiktok.com/)
   - Create a new app → Add "Login Kit" and "User Info" scopes
   - Note your **Client Key** and **Client Secret**
   - Add redirect URI: `https://hfdjdiduacehchuwvajr.supabase.co/functions/v1/social-auth-callback`

---

## Step 1: Run Database Migration

1. Go to **Supabase Dashboard** → **SQL Editor** → **New Query**
2. Paste the contents of `backend/migrations/001_social_auth_schema.sql`
3. Click **Run**

This migration:
- Adds `auth_user_id` to `creators` (links to Supabase Auth)
- Enhances `creator_socials` with handle, avg_views, secondary_metric, verification fields
- Creates `social_tokens` (encrypted, server-only — no client access via RLS)
- Creates `metric_snapshots` (time-series history)
- Creates `oauth_states` (CSRF protection with 10-minute expiry)
- Sets up RLS policies, indexes, and triggers

---

## Step 2: Initialise Supabase Project

If you haven't already:
```bash
cd teatrade-creator-hub-main
supabase init
```

Then link to your project:
```bash
supabase link --project-ref hfdjdiduacehchuwvajr
```

---

## Step 3: Copy Edge Functions

Copy the functions from `backend/functions/` into the Supabase functions directory:

```bash
# Create the standard supabase functions directory
mkdir -p supabase/functions/_shared
mkdir -p supabase/functions/social-auth-start
mkdir -p supabase/functions/social-auth-callback
mkdir -p supabase/functions/refresh-metrics
mkdir -p supabase/functions/disconnect-social

# Copy shared utilities
cp backend/functions/_shared/* supabase/functions/_shared/

# Copy function files
cp backend/functions/social-auth-start/index.ts   supabase/functions/social-auth-start/index.ts
cp backend/functions/social-auth-callback/index.ts supabase/functions/social-auth-callback/index.ts
cp backend/functions/refresh-metrics/index.ts      supabase/functions/refresh-metrics/index.ts
cp backend/functions/disconnect-social/index.ts    supabase/functions/disconnect-social/index.ts
```

---

## Step 4: Set Environment Secrets

```bash
supabase secrets set \
  INSTAGRAM_APP_ID="your-instagram-app-id" \
  INSTAGRAM_APP_SECRET="your-instagram-app-secret" \
  TIKTOK_CLIENT_KEY="your-tiktok-client-key" \
  TIKTOK_CLIENT_SECRET="your-tiktok-client-secret" \
  TOKEN_ENCRYPTION_KEY="your-random-32-char-passphrase" \
  FRONTEND_URL="https://teatrade.co"
```

To generate a strong encryption key:
```bash
openssl rand -hex 32
```

**⚠️ Never commit these values to Git.**

---

## Step 5: Deploy Edge Functions

```bash
supabase functions deploy social-auth-start    --no-verify-jwt
supabase functions deploy social-auth-callback  --no-verify-jwt
supabase functions deploy refresh-metrics       --no-verify-jwt
supabase functions deploy disconnect-social     --no-verify-jwt
```

> `--no-verify-jwt` is needed for `social-auth-callback` since it receives direct redirects from Instagram/TikTok (no JWT header). The other functions verify JWTs themselves in code.

After deployment, your function URLs will be:
```
https://hfdjdiduacehchuwvajr.supabase.co/functions/v1/social-auth-start
https://hfdjdiduacehchuwvajr.supabase.co/functions/v1/social-auth-callback
https://hfdjdiduacehchuwvajr.supabase.co/functions/v1/refresh-metrics
https://hfdjdiduacehchuwvajr.supabase.co/functions/v1/disconnect-social
```

---

## Step 6: Schedule Metric Refresh (Optional)

### Option A: Supabase Dashboard
1. Go to **Edge Functions** → **refresh-metrics** → **Schedules**
2. Add a cron schedule: `0 3 * * *` (daily at 3 AM UTC)

### Option B: pg_cron
1. Enable `pg_cron` extension in **Dashboard → Database → Extensions**
2. Run in SQL Editor:
```sql
SELECT cron.schedule(
  'daily-metric-refresh',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://hfdjdiduacehchuwvajr.supabase.co/functions/v1/refresh-metrics',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

---

## Step 7: Configure OAuth Redirect URIs

### Instagram
1. Go to [Meta for Developers](https://developers.facebook.com/) → Your App → Instagram Basic Display → Settings
2. Add to **Valid OAuth Redirect URIs**:
   ```
   https://hfdjdiduacehchuwvajr.supabase.co/functions/v1/social-auth-callback
   ```
3. Add to **Deauthorize Callback URL**:
   ```
   https://hfdjdiduacehchuwvajr.supabase.co/functions/v1/disconnect-social
   ```

### TikTok
1. Go to [TikTok for Developers](https://developers.tiktok.com/) → Your App → Configuration
2. Add to **Redirect URI**:
   ```
   https://hfdjdiduacehchuwvajr.supabase.co/functions/v1/social-auth-callback
   ```

---

## Step 8: Verify Deployment

### Test OAuth Start (should return an auth URL)
```bash
curl -X POST https://hfdjdiduacehchuwvajr.supabase.co/functions/v1/social-auth-start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SUPABASE_JWT" \
  -H "apikey: YOUR_ANON_KEY" \
  -d '{"platform":"instagram"}'
```

### Test Metric Refresh (with service_role key)
```bash
curl -X POST https://hfdjdiduacehchuwvajr.supabase.co/functions/v1/refresh-metrics \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "apikey: YOUR_SERVICE_ROLE_KEY"
```

---

## Environment Variables Reference

| Variable                 | Where it's used           | Description                                        |
| :----------------------- | :------------------------ | :------------------------------------------------- |
| `SUPABASE_URL`           | All functions (auto-set)  | Your Supabase project URL                          |
| `SUPABASE_ANON_KEY`      | Auth verification         | Public anon key (auto-set)                         |
| `SUPABASE_SERVICE_ROLE_KEY` | DB operations          | Service role key for bypassing RLS (auto-set)      |
| `INSTAGRAM_APP_ID`       | social-auth-start         | Meta/Instagram App ID                              |
| `INSTAGRAM_APP_SECRET`   | social-auth-callback      | Meta/Instagram App Secret                          |
| `TIKTOK_CLIENT_KEY`      | social-auth-start         | TikTok Developer App Client Key                    |
| `TIKTOK_CLIENT_SECRET`   | social-auth-callback      | TikTok Developer App Client Secret                 |
| `TOKEN_ENCRYPTION_KEY`   | crypto.ts                 | AES-256-GCM passphrase for token encryption        |
| `FRONTEND_URL`           | Callback redirects        | Your frontend domain (e.g., `https://teatrade.co`) |

> `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are automatically injected by Supabase Edge Functions runtime — you don't need to set them manually.

---

## Database Tables (Post-Migration)

| Table              | Purpose                                                  | Client Access       |
| :----------------- | :------------------------------------------------------- | :------------------ |
| `creators`         | Core creator profiles with auth_user_id link             | Read own             |
| `creator_socials`  | Public-facing social metrics (handle, followers, etc.)   | Read all, write own |
| `social_tokens`    | Encrypted OAuth tokens — **server-only**                 | **BLOCKED**         |
| `metric_snapshots` | Time-series metric history for sparkline charts          | Read own             |
| `oauth_states`     | CSRF tokens for OAuth flow — **server-only**             | **BLOCKED**         |
| `campaigns`        | Campaign lifecycle with escrow tracking                  | By role              |

---

## How It Works End-to-End

1. **Creator clicks "Connect Instagram"** on creator-dash.html
2. Frontend `POST`s to `social-auth-start` with their JWT
3. Edge Function generates a CSRF `state`, stores it in `oauth_states`, builds the Instagram OAuth URL
4. Frontend redirects the user to Instagram's authorization page
5. **User grants permission** on Instagram
6. Instagram redirects to `social-auth-callback?code=XXX&state=XXX`
7. Edge Function validates CSRF state, exchanges code for long-lived token
8. Token is AES-256-GCM encrypted and stored in `social_tokens`
9. Edge Function fetches user info + initial metrics from Instagram Graph API
10. Metrics are written to `creator_socials` and `metric_snapshots`
11. User is redirected back to `creator-dash.html?oauth_success=instagram&handle=username`
12. Dashboard loads, reads `creator_socials` from DB, populates the social stat cards
13. **Every 24 hours**, `refresh-metrics` runs via cron, pulling fresh metrics for all linked accounts

---

## Security Model

- **Tokens are AES-256-GCM encrypted** before storage (passphrase in env, never in DB)
- **RLS blocks ALL client access** to `social_tokens` and `oauth_states` — only `service_role` can read
- **CSRF protection** via `oauth_states` with 10-minute expiry and single-use validation
- **Read-only scopes** — we never request write/post permissions from Instagram or TikTok
- **Dev mode** (`?dev=true`) uses localStorage only — no DB writes, no API calls

---

## Troubleshooting

| Issue                                   | Fix                                                                          |
| :-------------------------------------- | :--------------------------------------------------------------------------- |
| "Session expired" on OAuth callback     | CSRF state expired (10 min). User took too long. They can retry.             |
| "Creator profile not found"             | User hasn't completed the vetting quiz yet. Direct them to index.html.       |
| Tokens not refreshing                   | Check cron schedule is active. Verify `TOKEN_ENCRYPTION_KEY` hasn't changed. |
| `social_tokens` reads return empty      | Expected. RLS blocks client access. Only Edge Functions can read tokens.     |
| Instagram says "Invalid redirect URI"   | Ensure the callback URL in Meta dashboard exactly matches the Edge Function URL. |
| TikTok "invalid client_key"             | Verify `TIKTOK_CLIENT_KEY` secret is set: `supabase secrets list`            |

---

## What's Next (V2 Enhancements)

- [ ] **YouTube API integration** — OAuth + channel analytics
- [ ] **Webhook listeners** — Instagram/TikTok deauthorization callbacks  
- [ ] **Metric history charts** — Use `metric_snapshots` to render real sparkline SVGs
- [ ] **Rate limiting** — Prevent excessive manual refresh clicks
- [ ] **Stripe Connect** — Wire escrow wallet to real payment processing
- [ ] **Admin dashboard** — View all connected creators, flag issues, manage tokens
