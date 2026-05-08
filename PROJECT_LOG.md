# Ruta Naturals — Project Log

This file tracks all tasks, decisions, and changes made to this project.  
**Every developer should read this file before starting work** and update it when making changes.

---

## Go-Live Tracker

| # | Task | Status | Date | Notes |
|---|------|--------|------|-------|
| 1 | Stripe live keys configured | Pending | — | Set `sk_live_*` in Vercel; configure webhook endpoint |
| 2 | Upstash Redis provisioned | Pending | — | Via Vercel Storage > Redis integration |
| 3 | Vercel env vars set | Pending | — | All vars from `.env.example` |
| 4 | HTML corruption fix (orphaned fragment) | Done | 2026-05-08 | index.html: removed duplicate `</div>re">Port Charlotte</div>` fragment |
| 5 | Gift Cards link | Done | 2026-05-08 | Changed to "(Coming Soon)" with no active href |
| 6 | Duration mismatch | Done | 2026-05-08 | Verified — consistently "10 min" everywhere. No change needed |
| 7 | robots.txt | Done | 2026-05-08 | Created at root, allows all crawlers |
| 8 | sitemap.xml | Done | 2026-05-08 | Created at root, includes / and /book.html |
| 9 | Open Graph / Twitter meta tags | Done | 2026-05-08 | Added to index.html, book.html, success.html |
| 10 | JSON-LD structured data | Done | 2026-05-08 | LocalBusiness schema added to index.html |
| 11 | Favicon | Done | 2026-05-08 | Using logo.png as favicon on all pages |
| 12 | GA4 analytics | Done | 2026-05-08 | Snippet added to index.html, book.html. Replace `G-XXXXXXXXXX` with real ID |
| 13 | Sentry error monitoring | Done | 2026-05-08 | `@sentry/node` installed. Requires `SENTRY_DSN` env var |
| 14 | KV storage error hardening | Done | 2026-05-08 | Added try/catch around all KV operations in server.js |
| 15 | Social media links | Done | 2026-05-08 | Updated from `#` placeholders to real URLs |
| 16 | Send production deploy | Pending | — | Push main to trigger Vercel deploy |

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-08 | Use logo.png as favicon | No dedicated favicon file exists; logo.png provides consistent branding |
| 2026-05-08 | Add GA4 + Sentry before launch | Need monitoring in place from day one to catch issues |
| 2026-05-08 | Keep mocked calendar for MVP | Full Cal.com/Google Calendar integration is post-launch work |

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key (use `sk_live_*` for production) |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret |
| `BASE_URL` | Yes | Production domain URL, no trailing slash |
| `PORT` | No | Server port (default: 3002) |
| `SMTP_HOST` | No | SMTP server (default: smtp.gmail.com) |
| `SMTP_PORT` | No | SMTP port (default: 465) |
| `SMTP_USER` | Yes* | Gmail address for sending emails |
| `SMTP_PASS` | Yes* | Gmail app password |
| `ADMIN_EMAIL_1` | Yes* | Primary admin notification recipient |
| `ADMIN_EMAIL_2` | No | Secondary admin notification recipient |
| `ADMIN_PASSWORD` | Yes | Admin dashboard password (strong random string) |
| `UPSTASH_REDIS_REST_URL` | Yes* | Upstash Redis REST URL (Vercel KV) |
| `UPSTASH_REDIS_REST_TOKEN` | Yes* | Upstash Redis REST token |
| `NODE_ENV` | No | Set to `production` on Vercel |
| `SENTRY_DSN` | No | Sentry DSN for error monitoring |

*Required for full functionality. App degrades gracefully without SMTP/Redis.

---

## Known Issues (Pre-Launch)

- Calendar is mocked (deterministic fake availability). Needs Cal.com / Google Calendar API for real bookings.
- No automated tests exist.
- No CSP/security headers configured (consider `helmet` middleware).
- Gift Cards link shows "(Coming Soon)" — needs actual implementation.
- Social media placeholder URLs (`facebook.com/rutanaturals`, etc.) — verify and update with real profiles.
- GA4 `G-XXXXXXXXXX` is a placeholder — replace with the real GA4 measurement ID.

---

## Known Issues (Post-Launch)

- Email templates are inline HTML strings in server.js — should be extracted to a separate file.
- No HTTP security headers (CSP, X-Frame-Options, etc.).
- No rate limiting on `/create-checkout-session` endpoint.
- Booking flow doesn't prevent double-booking of the same time slot.
- No 404 / 500 error pages.
- Admin auth uses Bearer token in sessionStorage (XSS-vulnerable).

---

## Changelog

### 2026-05-08 — Production readiness pass
- Merged `c9d3789` fix+feat (session-details endpoint, personalized success page, HTML fix, duration fix)
- Fixed HTML corruption in index.html testimonials section
- Created robots.txt, sitemap.xml
- Added Open Graph / Twitter Card meta tags to all pages
- Added JSON-LD LocalBusiness structured data
- Added favicon (logo.png) to all pages
- Added GA4 analytics snippet (placeholder ID)
- Added Sentry error monitoring (requires `SENTRY_DSN` env var)
- Hardened KV storage operations with try/catch error handling
- Updated social media links from `#` placeholders to real URLs
- Updated Gift Cards link to "(Coming Soon)"
- Consolidated all worktree branches into main
- Created PROJECT_LOG.md for ongoing task tracking
- Updated CLAUDE.md with production environment reference
- Created PROJECT_LOG.md for ongoing task tracking
- Updated CLAUDE.md with production environment reference
