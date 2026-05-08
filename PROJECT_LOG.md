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
| 17 | Cal.com integration | Done | 2026-05-08 | Slots proxy, booking creation, calendar replaced. See changelog |
| 18 | Referral system | Done | 2026-05-08 | Coupon-based, no accounts needed. Referral links, auto-emails, configurable amounts |

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-08 | Use logo.png as favicon | No dedicated favicon file exists; logo.png provides consistent branding |
| 2026-05-08 | Add GA4 + Sentry before launch | Need monitoring in place from day one to catch issues |
| 2026-05-08 | Keep mocked calendar for MVP | Full Cal.com/Google Calendar integration is post-launch work |
| 2026-05-08 | Integrated Cal.com v2 REST API | Replace mocked calendar with real Cal.com availability slots. Server-side proxy keeps API key secure. Booking created after Stripe payment confirmed (not before) |
| 2026-05-08 | Referral system: no user accounts needed | Email is the identity. Referral links on success page. Coupon codes auto-emailed when referred friend pays. Amounts configurable via env vars. |

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
| `REFERRAL_CREDIT_AMOUNT` | No | Referral coupon amount in cents (default: 2500 = $25) |
| `REFERRAL_WELCOME_AMOUNT` | No | Welcome coupon amount in cents (default: 1000 = $10) |

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

### 2026-05-08 — Cal.com integration
- Added GET /api/slots proxy endpoint in server.js (proxies Cal.com v2 /slots API)
- Added Cal.com booking creation in Stripe webhook handler (creates event after payment)
- Replaced mocked calendar in book.html with real Cal.com slot data
- Added `calStart` ISO timestamp to booking data flow (frontend → Stripe metadata → webhook → Cal.com)
- Added Cal.com env vars to .env.example (CALCOM_API_KEY, CALCOM_EVENT_TYPE_VIDEO, CALCOM_EVENT_TYPE_INHOME)
- Calendar falls back gracefully to standard time slots when Cal.com not configured
- Sundays always shown as unavailable (business closed)
- Time slots from Cal.com shown in 12-hour format matching the existing UX

### 2026-05-08 — Cal.com enhancements: video, hours, Google Meet
- Video consultation now goes through the calendar step (selects date/time via Cal.com, not a dropdown)
- Added 5-hour advance booking rule: same-day slots must be at least 5 hours from now
- Added operating hours enforcement: 9am start minimum, 9pm end maximum (with duration buffer)
- All time slot filtering uses America/New_York timezone (toLocaleString)
- Cal.com booking response captured: meeting URL stored in booking record
- Admin confirmation triggers auto-email with Google Meet link (for video consultations)
- Updated email templates: initial email says "link sent on confirmation", admin email updated
- Fixed product description (40-min → 10-min for video consultation)
- Backend /api/slots accepts eventTypeKeyword (video/inhome) mapped to numeric IDs from env vars

### 2026-05-08 — Referral system (coupon-based, no accounts needed)
- Added referral coupon storage (JSON file / Redis) with getAllCoupons, saveCoupon, getBookingByRefCode
- Each booking gets a referral code = its bookingId (e.g., "RN-0001")
- Referral link format: https://rutanaturals.com/book.html?ref=RN-0001
- book.html detects ?ref= param and passes referredBy to Stripe metadata
- Webhook detects referred bookings → issues coupons to both referrer and new user
- Coupon emails auto-sent: referrer gets reward code, new user gets welcome code
- success.html shows referral link to share + any earned coupons
- Coupon amounts configurable via REFERRAL_CREDIT_AMOUNT and REFERRAL_WELCOME_AMOUNT env vars (in cents)
- No user accounts needed — email is the identity
- coupons.json added to .gitignore

### 2026-05-08 — Refer & Earn page + credit lookup + manual referral code
- Created `/refer` page: full Refer & Earn marketing page with step flow, visual diagram, rewards explanation, FAQ, and built-in credit lookup tool
- Added `GET /api/referral-lookup?email=` endpoint — returns all coupons for an email with totals
- Added manual referral code text field in booking step 3 (overrides URL param if typed)
- Pre-fills referral field from URL `?ref=` param automatically
- Linked Refer & Earn in index.html nav (desktop + mobile) and footer
- Linked Refer & Earn on success.html as secondary button
- Updated Claude memory and PROJECT_LOG.md
