# PrimeIntel Deployment Guide

Two services to deploy:

| Service | Platform | What it runs |
|---------|----------|--------------|
| Frontend (Next.js) | Vercel | Dashboard, auth, API routes |
| Worker (orchestrator) | Railway | Scraper → R2 → AI extraction → alerts |

Deploy Vercel first — you need the production URL before configuring Railway.

---

## Prerequisites

- [ ] Supabase migration `012_add_alert_tracking_columns.sql` applied (alert tracking columns)
- [ ] Resend domain `mail.primeintel.app` verified ✓
- [ ] Cloudflare R2 bucket `primeintel-pdfs` created with public access configured
- [ ] GitHub repo pushed to `main`

---

## 1. Vercel (Next.js frontend)

### Steps

1. Go to [vercel.com](https://vercel.com) → **New Project** → import the GitHub repo
2. Framework: **Next.js** (auto-detected)
3. Root directory: `.` (default)
4. Build command: `next build` (default)
5. Add the env vars below → **Deploy**
6. Copy the deployed URL (e.g. `https://primeintel.vercel.app`) — you'll need it for Railway

### Vercel environment variables

| Variable | Where to get it |
|----------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API |
| `NEXT_PUBLIC_APP_URL` | Your Vercel URL, e.g. `https://primeintel.vercel.app` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (service_role key) |

> Only these four. R2 keys, AI API keys, and Resend keys stay on Railway.

### Custom domain (optional)

Vercel → Project → Settings → Domains → add `primeintel.app`.
Update `NEXT_PUBLIC_APP_URL` on both Vercel and Railway to the custom domain.

---

## 2. Railway (worker)

The repo already has `railway.toml` and `nixpacks.toml` configured — Railway reads them automatically.

### Steps

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select the repo → Railway picks up `railway.toml` (start command: `npx tsx workers/orchestrate.ts`)
3. Add all env vars below
4. Deploy

### Railway environment variables

**Supabase (required)**

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Same as Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | Same as Vercel |
| `NEXT_PUBLIC_APP_URL` | Your Vercel/production URL — used in email digest links |

**Cloudflare R2 (required)**

| Variable | Value |
|----------|-------|
| `CLOUDFLARE_R2_ACCOUNT_ID` | R2 → Manage R2 API tokens |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | R2 API token |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | R2 API token |
| `CLOUDFLARE_R2_BUCKET_NAME` | `primeintel-pdfs` |
| `CLOUDFLARE_R2_PUBLIC_BASE_URL` | R2 bucket public URL, e.g. `https://pub-xxx.r2.dev` |

**AI APIs (required)**

| Variable | Value |
|----------|-------|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `OPENAI_API_KEY` | platform.openai.com |

**Email (required)**

| Variable | Value |
|----------|-------|
| `RESEND_API_KEY` | resend.com → API Keys |
| `RESEND_FROM_EMAIL` | `PrimeIntel Alerts <alerts@mail.primeintel.app>` |

**Optional tuning**

| Variable | Default |
|----------|---------|
| `PIPELINE_INTERVAL_MS` | `7200000` (2 hours) |
| `CLAUDE_EXTRACTION_MODEL` | `claude-sonnet-4-6` |
| `OPENAI_EXTRACTION_MODEL` | `gpt-4o` |
| `CLAUDE_EXTRACTION_TIMEOUT_MS` | `90000` |
| `OPENAI_EXTRACTION_TIMEOUT_MS` | `90000` |
| `CLAUDE_EXTRACTION_MAX_RETRIES` | `3` |
| `OPENAI_EXTRACTION_MAX_RETRIES` | `3` |
| `CLAUDE_EXTRACTION_PROMPT_VERSION` | `claude-extraction-v2` |
| `OPENAI_EXTRACTION_PROMPT_VERSION` | `openai-extraction-v1` |
| `AI_EXTRACTION_SCHEMA_VERSION` | `extraction-schema-v2` |
| `COMPARISON_VERSION` | `comparison-v1` |

> Do NOT set `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, or R2 keys on Vercel. Keep secrets on the Railway worker only.

---

## 3. Production smoke test

After both services are live:

### Frontend (Vercel)

1. Visit `https://primeintel.app/login` → sign in
2. Visit `/bids` → bid feed loads with real data
3. Visit `/settings` → save alert preferences
4. Visit `/admin/review` → manual review queue loads

### Worker (Railway)

1. Railway → service → **Logs** tab
2. Look for the pipeline start banner and each step completing:
   ```
   [timestamp] PrimeIntel worker orchestrator starting...
   [timestamp] ▶ Caltrans scraper
   [timestamp] ✓ Caltrans scraper done
   ...
   [timestamp] ▶ Alert matching
   [timestamp] ✓ Alert matching done
   [timestamp] ▶ Digest sending
   [timestamp] ✓ Digest sending done
   ```
3. With alert preferences saved and a matched bid in the DB, an email should arrive within one pipeline cycle (default 2h; set `PIPELINE_INTERVAL_MS=60000` to trigger a 1-minute cycle for testing, then revert)

### API health checks

```bash
# Returns bid list (auth required in prod)
curl https://primeintel.app/api/bids

# test-db route is disabled in production (returns 404 unless ENABLE_TEST_DB_ROUTE=true)
curl https://primeintel.app/api/test-db
```

---

## 4. Notes

- **Railway memory**: Playwright + Chromium require ~1–2 GB RAM. Upgrade the Railway plan if the worker crashes on startup.
- **Cold start**: The first pipeline run after deploy starts immediately, then sleeps for `PIPELINE_INTERVAL_MS`. Expect the first bids to appear within a few minutes.
- **Middleware deprecation warning**: `middleware.ts` shows a Next.js 16 deprecation notice at build time (`proxy` convention) — this is cosmetic, auth works correctly.
- **Supabase anon key on Railway**: Not needed — the worker uses the service-role key only.
- **`ENABLE_TEST_DB_ROUTE`**: Do not set this to `true` on Vercel in production — it allows unauthenticated bid inserts.
