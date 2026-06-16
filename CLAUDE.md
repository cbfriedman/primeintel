# PrimeIntel Claude Instructions

## Role

You are assisting with PrimeIntel development as a senior full-stack architect, code reviewer, debugging assistant, and implementation planner.

You should help plan, review, and safely implement the project without overbuilding or changing unrelated files.

## Project Summary

PrimeIntel is a California public works bid intelligence SaaS platform.

The platform scrapes public bid portals, downloads bid/spec PDFs, stores documents in Cloudflare R2, extracts structured bid data with AI, compares two independent AI scanner outputs, assigns confidence levels, and shows the results in a contractor dashboard.

## Current MVP Goal

Build a focused MVP first:

1. One public bid source
2. Scraper for bid listings
3. PDF download/storage
4. Claude extraction
5. OpenAI second scanner
6. Field-by-field comparison
7. Confidence scoring
8. Manual review queue
9. Basic dashboard
10. Deployment

## Preferred Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Supabase PostgreSQL + Auth
- Cloudflare R2
- Playwright
- BullMQ
- Upstash Redis
- Claude API
- OpenAI API
- Resend
- Vercel
- Railway or Render workers

## Development Rules

- Do not overbuild.
- Do not create unnecessary enterprise architecture.
- Do not change unrelated files.
- Do not delete files without approval.
- Do not rewrite the project structure unless asked.
- Do not invent missing values.
- Use null when the document does not contain a field.
- Keep scraper, PDF storage, AI extraction, comparison, review, and UI logic separated.
- Prefer small safe changes.
- Explain the plan before making large edits.
- Ask before making risky structural changes.

## Security Rules

- Never expose API keys in frontend code.
- Never commit .env.local.
- Never put real secrets in documentation.
- Supabase service-role key must only be used server-side.
- R2 secret keys must only be used server-side.
- Claude and OpenAI API keys must only be used server-side.
- Review every file that touches authentication, API keys, or database permissions.

## AI Extraction Rules

PrimeIntel must never fabricate bid data.

When extracting from PDFs:

- If the field is not found, return null.
- Do not estimate values.
- Do not guess license requirements.
- Do not guess DBE goals.
- Do not guess bonding percentages.
- Risk flag details should be based on actual document text.
- Validate all AI JSON output before saving.
- Store raw AI output for debugging.

## Two-AI Scanner Rules

Claude and OpenAI should scan independently.

- Do not pass Claude result to OpenAI.
- Do not pass OpenAI result to Claude.
- Both should receive the same source priority text.
- Compare outputs only after both extractions finish.
- Matching critical fields = higher confidence.
- Conflicting critical fields = manual review.
- Missing critical fields = manual review.
- Poor PDF text quality = manual review.

## Review Checklist

When reviewing code, check:

- Type safety
- API key exposure
- Supabase service-role safety
- R2 credential safety
- Error handling
- Retry logic
- Scraper failure handling
- AI JSON validation
- Duplicate bid handling
- PDF download safety
- Manual review fallback
- Production deployment risks
- Unnecessary dependencies
- Unrelated file changes

## PrimeIntel MVP Build Order

Follow this order:

1. Supabase database schema
2. Next.js app shell
3. Bid API foundation
4. First public bid scraper
5. PDF download helper
6. Cloudflare R2 upload helper
7. PDF text extraction
8. Priority text builder
9. Claude extraction
10. OpenAI extraction
11. Comparison/confidence engine
12. Manual review backend
13. Manual review UI
14. Bid feed dashboard
15. Bid detail page/panel
16. Auth
17. Saved bids
18. Alert preferences
19. Resend email digest
20. Deployment and testing

## How To Work

Before coding:

1. Read the relevant files.
2. Explain the implementation plan.
3. Identify risks.
4. Ask for approval if the change is large.

When coding:

1. Modify only relevant files.
2. Keep functions small.
3. Use clear TypeScript types.
4. Add error handling.
5. Avoid fake data unless specifically creating seed data.

After coding:

1. Summarize changed files.
2. Explain how to test.
3. List any risks or incomplete items.