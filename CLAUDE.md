# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ruta Naturals — a booking and payments website for a mobile wellness business in North Port, Florida. The site has a marketing landing page, a multi-step booking flow integrated with Stripe Checkout, and an Express backend that handles payments and sends email notifications.

## Commands

```bash
# Install dependencies
npm install

# Start dev server (with hot reload)
npm run dev

# Start production server
npm start

# Run server directly
node server.js
```

Server runs on port 3002 by default (configurable via `PORT` in .env).

## Architecture

### Frontend (vanilla HTML + CSS + JS, no framework)

| File | Purpose |
|------|---------|
| `index.html` | Main marketing site — hero, how it works, technology section, services/pricing, about, service area map, testimonials, booking CTA, footer. All CSS is inline in `<style>`, all JS is inline in `<script>`. |
| `book.html` | Multi-step booking flow (5 steps): treatment selection, calendar/time picker, contact details with ZIP-based area detection, review & pay, confirmation. Communicates with the server via `POST /create-checkout-session`. |
| `success.html` | Post-payment confirmation page shown after Stripe redirect. Reads `session_id` from URL query params. |

### Backend (Express.js, single server.js)

The server has three endpoints:

1. **`POST /create-checkout-session`** — Accepts booking data (name, email, treatment, date, address, etc.), creates a Stripe Checkout Session, returns the checkout URL to the frontend. The `$25.00` amount is hardcoded as `2500` cents.

2. **`POST /webhook`** — Stripe webhook handler. Must use `express.raw()` body parser (placed before `express.json()`). On `checkout.session.completed`, sends two emails via Nodemailer:
   - **Admin email** (to `rutanaturalle@gmail.com` and `adsunike@gmail.com`) with booking details and deposit info
   - **Client email** (to the customer) with a booking summary
   - Different email templates for video consultation vs. in-home visit
   - Handles group bookings (2+ people = 20% discount, $160/person) and travel fees

3. **Static file serving** — `express.static(__dirname)` serves all HTML files and images.

### Key Business Logic

- **Two services**: Video Consultation ($25, full payment) and Komfort Flow Reset ($200, $25 deposit)
- **Service areas**: ZIP-based detection — North Port (no travel fee), Port Charlotte/Venice/Englewood ($15 travel fee), other areas (flagged as out-of-range)
- **Group discount**: 2+ people at same address gets 20% off ($160/person instead of $200)
- **Calendar**: Client-side mock with deterministic "booked" slots — flagged for replacement with Cal.com/Google Calendar API

## Deployment

The server is already set up for Vercel serverless deployment (`module.exports = app` at the bottom of server.js). To deploy:

1. Set all env vars in the hosting platform
2. Point Stripe dashboard webhook to `https://your-domain.com/webhook`
3. Update `BASE_URL` in env to the production domain
4. Replace mocked calendar with real Cal.com or Google Calendar integration

## Production Environment

Required Vercel environment variables (see `.env.example` for all):

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Live Stripe key (`sk_live_*`) |
| `STRIPE_WEBHOOK_SECRET` | Live Stripe webhook secret |
| `BASE_URL` | Production domain (no trailing slash) |
| `SMTP_USER` / `SMTP_PASS` | Gmail app password for sending emails |
| `ADMIN_PASSWORD` | Strong random string |
| `ADMIN_EMAIL_1` / `ADMIN_EMAIL_2` | Notification recipients |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Vercel KV / Upstash Redis |
| `SENTRY_DSN` | Sentry error monitoring DSN |

### Go-Live Runbook

1. Push `main` → Vercel auto-deploys
2. Verify all endpoints respond (/, /book.html, /admin)
3. Run a test booking through the full Stripe flow
4. Check Stripe dashboard for test session
5. Verify emails arrive at admin inboxes
6. Test admin dashboard login and booking CRUD
7. Send a test webhook from Stripe dashboard
8. Check Sentry dashboard for errors

**Rollback**: Vercel Dashboard → Deployments → Promote previous working deployment.  
**Quick rollback**: `git revert HEAD && git push origin main`

### Pre-Launch Checklist

- [ ] `npm install` runs clean
- [ ] `node server.js` starts without errors
- [ ] All env vars set in Vercel (no `sk_test_*` keys remaining)
- [ ] `BASE_URL` points to production domain
- [ ] Stripe webhook configured with live signing secret
- [ ] Test booking: full checkout flow (cancel + complete)
- [ ] Test admin: login, search, filter, status update
- [ ] Test emails: both admin and client arrive
- [ ] robots.txt and sitemap.xml accessible
- [ ] OG tags render correctly

## Project Log

See [PROJECT_LOG.md](PROJECT_LOG.md) for the full task tracker, decisions log, and changelog.  
**Always read and update this file when making changes.**

## Images

- `logo.png` — Site logo (used in nav and footer)
- `hero.jpg` — Hero section background
- `ruta.jpg` — About section photo of Ruta
