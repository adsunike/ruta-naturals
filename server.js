require('dotenv').config();
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

const app  = express();
const PORT = process.env.PORT || 3002;

// ── Error Monitoring (Sentry) ──────────────────────────────────────────────
let Sentry;
try { Sentry = require('@sentry/node'); } catch { /* not installed */ }
if (Sentry && process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN });
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.errorHandler());
  console.log('📊 Sentry error monitoring enabled');
}

// ── Email Transporter ─────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ── Storage Layer (Vercel KV when available, async JSON file as fallback) ─
const USE_KV = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
let kv;
if (USE_KV) {
  const { Redis } = require('@upstash/redis');
  kv = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log('🗄️  Using Upstash Redis for storage');
} else {
  console.log('🗄️  Using local JSON file for storage (dev mode)');
}

const BOOKINGS_PATH = path.join(__dirname, 'bookings.json');

async function getAllBookings() {
  if (USE_KV) {
    const ids = await kv.lrange('booking_ids', 0, -1);
    if (!ids || ids.length === 0) return [];
    const bookings = await Promise.all(ids.map(id => kv.get(`booking:${id}`)));
    return bookings.filter(Boolean);
  }
  try {
    if (!fs.existsSync(BOOKINGS_PATH)) return [];
    const data = await fs.promises.readFile(BOOKINGS_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function addBooking(data) {
  if (USE_KV) {
    try {
      const exists = await kv.exists(`booking:${data.id}`);
      if (exists) return false;
      await kv.set(`booking:${data.id}`, data);
      await kv.lpush('booking_ids', data.id);
      return true;
    } catch (err) {
      console.error('❌ KV write error (addBooking):', err.message);
      return false;
    }
  }
  try {
    const all = await getAllBookings();
    if (all.find(b => b.id === data.id)) return false;
    all.push(data);
    await fs.promises.writeFile(BOOKINGS_PATH, JSON.stringify(all, null, 2));
    return true;
  } catch (err) {
    console.error('❌ File write error (addBooking):', err.message);
    return false;
  }
}

async function updateBooking(id, updates) {
  if (USE_KV) {
    try {
      const booking = await kv.get(`booking:${id}`);
      if (!booking) return null;
      const updated = { ...booking, ...updates };
      await kv.set(`booking:${id}`, updated);
      return updated;
    } catch (err) {
      console.error('❌ KV write error (updateBooking):', err.message);
      return null;
    }
  }
  try {
    const all = await getAllBookings();
    const idx = all.findIndex(b => b.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...updates };
    await fs.promises.writeFile(BOOKINGS_PATH, JSON.stringify(all, null, 2));
    return all[idx];
  } catch (err) {
    console.error('❌ File write error (updateBooking):', err.message);
    return null;
  }
}

async function getNextBookingNumber() {
  if (USE_KV) {
    try {
      return await kv.incr('booking_count');
    } catch (err) {
      console.error('❌ KV incr error:', err.message);
      return Date.now(); // fallback: use timestamp as unique number
    }
  }
  const all = await getAllBookings();
  return all.length + 1;
}

// ── Referral Coupon Storage ──────────────────────────────────────────────
const COUPONS_PATH = path.join(__dirname, 'coupons.json');

async function getAllCoupons() {
  if (USE_KV) {
    const codes = await kv.lrange('coupon_codes', 0, -1);
    if (!codes || codes.length === 0) return {};
    const entries = await Promise.all(codes.map(code => kv.get(`coupon:${code}`)));
    const map = {};
    entries.forEach((entry, i) => { if (entry) map[codes[i]] = entry; });
    return map;
  }
  try {
    if (!fs.existsSync(COUPONS_PATH)) return {};
    const data = await fs.promises.readFile(COUPONS_PATH, 'utf-8');
    return JSON.parse(data);
  } catch { return {}; }
}

async function saveCoupon(code, data) {
  if (USE_KV) {
    await kv.set(`coupon:${code}`, data);
    await kv.lpush('coupon_codes', code);
    return;
  }
  const all = await getAllCoupons();
  all[code] = data;
  await fs.promises.writeFile(COUPONS_PATH, JSON.stringify(all, null, 2));
}

async function getBookingByRefCode(refCode) {
  // refCode is a bookingId like "RN-0001"
  const all = await getAllBookings();
  return all.find(b => b.bookingId === refCode) || null;
}

// ── Admin Auth ─────────────────────────────────────────────────────────────
// In-memory rate limiter: max 5 failed attempts per 15 min per IP
const loginAttempts = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const WINDOW = 15 * 60 * 1000;
  const MAX = 5;
  const record = loginAttempts.get(ip);
  if (!record || now > record.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW });
    return true;
  }
  if (record.count >= MAX) return false;
  record.count++;
  return true;
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdmin(req, res, next) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return res.status(500).json({ error: 'ADMIN_PASSWORD not configured' });

  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!timingSafeEqual(token, pw)) {
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Stripe Webhook (MUST be before express.json) ───────────────────────────
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.sendStatus(200);

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.sendStatus(400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta = session.metadata;
    const isVideo = meta.treatment && meta.treatment.includes('video-consultation');

    const adminSubject = isVideo
      ? `New Video Consultation — ${meta.firstName} ${meta.lastName} · ${meta.date}`
      : `New Home Visit Booking — ${meta.firstName} ${meta.lastName} · ${meta.date}`;

    const adminBody = isVideo ? `
      <h2 style="color:#2d3a2a;">New Video Consultation Booking</h2>
      <p><strong>Client:</strong> ${meta.firstName} ${meta.lastName}</p>
      <p><strong>Email:</strong> ${session.customer_email}</p>
      <p><strong>Phone:</strong> ${meta.phone}</p>
      <p><strong>Preferred Call Time:</strong> ${meta.date}</p>
      <p><strong>Notes:</strong> ${meta.notes || 'None'}</p>
      <hr/>
      <p>Paid: <strong>$25.00</strong> (full payment for video consultation)</p>
      <p style="color:#b8674a;"><em>The Google Meet link will be auto-sent to the client when you confirm this booking in the admin dashboard.</em></p>
    ` : `
      <h2 style="color:#2d3a2a;">New Komfort Flow Home Visit Booking</h2>
      <p><strong>Client:</strong> ${meta.firstName} ${meta.lastName}</p>
      <p><strong>Email:</strong> ${session.customer_email}</p>
      <p><strong>Phone:</strong> ${meta.phone}</p>
      <p><strong>Date/Time:</strong> ${meta.date}</p>
      <p><strong>Address:</strong> ${meta.address}</p>
      <p><strong>Notes:</strong> ${meta.notes || 'None'}</p>
      <hr/>
      <p>Deposit paid: <strong>$25.00</strong> | Balance at visit: <strong>$175.00</strong></p>
    `;

    const clientSubject = isVideo
      ? `Your video consultation with Ruta is confirmed`
      : `Your Komfort Flow session is reserved`;

    const clientBody = isVideo ? `
      <div style="font-family:'Georgia',serif;color:#2d3a2a;max-width:600px;margin:0 auto;line-height:1.7;">
        <h2 style="font-weight:400;color:#b8674a;">Hello ${meta.firstName},</h2>
        <p>Your video consultation with Ruta is confirmed and your $25 payment has been received.</p>
        <div style="background:#fbf7ee;padding:20px;border-radius:8px;margin:20px 0;border:1px solid rgba(45,58,42,0.1);">
          <h3 style="margin-top:0;font-size:16px;">Booking Summary</h3>
          <p><strong>Service:</strong> Video Consultation (10 min)</p>
          <p><strong>Scheduled:</strong> ${meta.date}</p>
          <p><strong>Amount Paid:</strong> $25.00 (full payment)</p>
        </div>
        <p>Ruta will review your booking shortly. Once confirmed, your <strong>Google Meet link</strong> will be automatically sent to this email.</p>
        <p>Warmly,<br/><strong>Ruta Naturals</strong></p>
      </div>
    ` : `
      <div style="font-family:'Georgia',serif;color:#2d3a2a;max-width:600px;margin:0 auto;line-height:1.7;">
        <h2 style="font-weight:400;color:#b8674a;">Hello ${meta.firstName},</h2>
        <p>Your Komfort Flow Reset session has been reserved. Your $25 deposit has been received.</p>
        <div style="background:#fbf7ee;padding:20px;border-radius:8px;margin:20px 0;border:1px solid rgba(45,58,42,0.1);">
          <h3 style="margin-top:0;font-size:16px;">Booking Summary</h3>
          <p><strong>Service:</strong> Komfort Flow Reset (~60 min)</p>
          <p><strong>Date/Time:</strong> ${meta.date}</p>
          <p><strong>Address:</strong> ${meta.address}</p>
          <p><strong>Deposit Paid:</strong> $25.00</p>
          ${meta.guests && meta.guests !== '1' ? `<p><strong>Guests:</strong> ${meta.guests} people &mdash; 20% group discount applied ($160/person)</p>` : ''}
          ${meta.travelFee && meta.travelFee !== '0' ? `<p><strong>Travel Fee:</strong> $${meta.travelFee} (collected at visit)</p>` : ''}
          <p><strong>Balance at Visit:</strong> $${((Number(meta.guests || 1) * (meta.guests !== '1' ? 160 : 200)) - 25 + Number(meta.travelFee || 0)).toFixed(2)}</p>
        </div>
        <p>Ruta will confirm your appointment personally within a few hours. See you soon.</p>
        <p>Warmly,<br/><strong>Ruta Naturals</strong></p>
      </div>
    `;

    try {
      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        const adminRecipients = [
          process.env.ADMIN_EMAIL_1,
          process.env.ADMIN_EMAIL_2,
        ].filter(Boolean);

        if (adminRecipients.length) {
          await transporter.sendMail({
            from: `"Ruta Naturals Booking" <${process.env.SMTP_USER}>`,
            to: adminRecipients,
            subject: adminSubject,
            html: adminBody,
          });
        }
        await transporter.sendMail({
          from: `"Ruta Naturals" <${process.env.SMTP_USER}>`,
          to: session.customer_email,
          subject: clientSubject,
          html: clientBody,
        });
        console.log('✅ Emails sent for', meta.treatment);
      } else {
        console.log('⚠️  SMTP not configured — skipping emails');
      }
    } catch (emailErr) {
      console.error('❌ Email error:', emailErr.message);
    }

    const count = await getNextBookingNumber();
    const bookingData = {
      id: session.id,
      bookingId: 'RN-' + String(count).padStart(4, '0'),
      status: 'pending',
      createdAt: new Date().toISOString(),
      treatment: meta.treatment,
      firstName: meta.firstName,
      lastName: meta.lastName,
      email: session.customer_email,
      phone: meta.phone,
      address: meta.address || 'N/A',
      date: meta.date,
      travelFee: Number(meta.travelFee || 0),
      guests: Number(meta.guests || 1),
      groupDiscount: meta.groupDiscount || '0',
      notes: meta.notes || '',
      referredBy: meta.referredBy || '',
      paymentStatus: 'paid',
      amount: 2500,
      confirmedAt: null,
      cancelledAt: null,
    };
    const added = await addBooking(bookingData);
    if (added) {
      console.log('📦 Booking stored:', bookingData.bookingId);
      // ── Create Cal.com booking (if configured) ──────────────────────────
      if (process.env.CALCOM_API_KEY) {
        try {
          const calEventTypeId = isVideo
            ? Number(process.env.CALCOM_EVENT_TYPE_VIDEO)
            : Number(process.env.CALCOM_EVENT_TYPE_INHOME);
          if (calEventTypeId && meta.calStart) {
            const attendeeName = meta.firstName + ' ' + meta.lastName;
            const calRes = await fetch('https://api.cal.com/v2/bookings', {
              method: 'POST',
              headers: {
                'Authorization': 'Bearer ' + process.env.CALCOM_API_KEY,
                'cal-api-version': '2024-08-13',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                eventTypeId: calEventTypeId,
                start: meta.calStart,
                attendee: {
                  name: attendeeName,
                  email: session.customer_email,
                  timeZone: 'America/New_York',
                  language: 'en',
                },
                metadata: {
                  stripeSessionId: session.id,
                  bookingId: bookingData.bookingId,
                },
              }),
            });
            if (calRes.ok) {
              const calData = await calRes.json();
              const calBooking = calData && calData.data ? calData.data : null;
              const calUpdate = {};
              if (calBooking) {
                if (calBooking.uid) calUpdate.calBookingUid = calBooking.uid;
                if (calBooking.locationUrl) calUpdate.calMeetingUrl = calBooking.locationUrl;
              }
              if (Object.keys(calUpdate).length > 0) {
                await updateBooking(session.id, calUpdate);
              }
              console.log('📅 Cal.com booking created for', bookingData.bookingId);
            } else {
              const calErrText = await calRes.text();
              console.error('❌ Cal.com error:', calErrText);
            }
          }
        } catch (calErr) {
          console.error('❌ Cal.com booking error:', calErr.message);
        }
      }

      // ── Referral: issue coupons if this booking was referred ────────────
      if (meta.referredBy && bookingData.email) {
        try {
          const referrerBooking = await getBookingByRefCode(meta.referredBy);
          if (referrerBooking && referrerBooking.email) {
            const refAmt = Number(process.env.REFERRAL_CREDIT_AMOUNT || 2500);
            const welcomeAmt = Number(process.env.REFERRAL_WELCOME_AMOUNT || 1000);
            const refCode = 'SAVE' + (refAmt / 100) + '-' + bookingData.bookingId;
            const welcomeCode = 'WELCOME-' + bookingData.bookingId;

            await saveCoupon(refCode, {
              email: referrerBooking.email,
              amountCents: refAmt,
              type: 'referrer',
              used: false,
              issuedAt: new Date().toISOString(),
              referredBooking: bookingData.bookingId,
            });
            await saveCoupon(welcomeCode, {
              email: bookingData.email,
              amountCents: welcomeAmt,
              type: 'welcome',
              used: false,
              issuedAt: new Date().toISOString(),
            });
            console.log('🎟️  Referral coupons issued:', refCode, welcomeCode);

            // Send coupon emails
            if (process.env.SMTP_USER && process.env.SMTP_PASS) {
              const baseUrl = process.env.BASE_URL || 'http://localhost:' + PORT;
              const fmt = function(cents) { return (cents / 100).toFixed(0); };
              await transporter.sendMail({
                from: '"Ruta Naturals" <' + process.env.SMTP_USER + '>',
                to: referrerBooking.email,
                subject: 'You earned a reward! Your referral booked with Ruta',
                html: '<div style="font-family:Georgia,serif;color:#2d3a2a;max-width:600px;line-height:1.7;">' +
                  '<h2 style="font-weight:400;color:#b8674a;">Thank you for your referral!</h2>' +
                  '<p>' + bookingData.firstName + ' ' + bookingData.lastName + ' has booked a session using your link.</p>' +
                  '<div style="background:#fbf7ee;padding:20px;border-radius:8px;margin:20px 0;text-align:center;border:1px solid rgba(45,58,42,0.1);">' +
                  '<p style="margin-bottom:0.3rem;font-size:0.85rem;color:#4a463d;">Your coupon code for next booking:</p>' +
                  '<p style="font-family:monospace;font-size:1.6rem;color:#2d3a2a;letter-spacing:0.1em;">' + refCode + '</p>' +
                  '<p style="margin-top:0.3rem;font-size:0.85rem;color:#b8674a;">$' + fmt(refAmt) + ' off your next session</p></div>' +
                  '<p style="font-size:0.85rem;">Use code at <a href="' + baseUrl + '/book.html" style="color:#b8674a;">' + baseUrl + '/book.html</a></p>' +
                  '<p>Warmly,<br/><strong>Ruta Naturals</strong></p></div>',
              });
              await transporter.sendMail({
                from: '"Ruta Naturals" <' + process.env.SMTP_USER + '>',
                to: bookingData.email,
                subject: 'Welcome — here\'s a gift for your next visit!',
                html: '<div style="font-family:Georgia,serif;color:#2d3a2a;max-width:600px;line-height:1.7;">' +
                  '<h2 style="font-weight:400;color:#b8674a;">Welcome, ' + bookingData.firstName + '!</h2>' +
                  '<p>Thank you for booking with Ruta. Here\'s a welcome discount for your next session:</p>' +
                  '<div style="background:#fbf7ee;padding:20px;border-radius:8px;margin:20px 0;text-align:center;border:1px solid rgba(45,58,42,0.1);">' +
                  '<p style="margin-bottom:0.3rem;font-size:0.85rem;color:#4a463d;">Your welcome coupon code:</p>' +
                  '<p style="font-family:monospace;font-size:1.6rem;color:#2d3a2a;letter-spacing:0.1em;">' + welcomeCode + '</p>' +
                  '<p style="margin-top:0.3rem;font-size:0.85rem;color:#b8674a;">$' + fmt(welcomeAmt) + ' off your next session</p></div>' +
                  '<p style="font-size:0.85rem;">Use code at <a href="' + baseUrl + '/book.html" style="color:#b8674a;">' + baseUrl + '/book.html</a></p>' +
                  '<p>Warmly,<br/><strong>Ruta Naturals</strong></p></div>',
              });
              console.log('📧 Referral coupon emails sent');
            }
          }
        } catch (refErr) {
          console.error('❌ Referral processing error:', refErr.message);
        }
      }
    } else {
      console.log('⚠️  Duplicate webhook ignored for session:', session.id);
    }
  }

  res.sendStatus(200);
});

// ── Middleware ────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Admin Routes ──────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  const all = await getAllBookings();
  all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const statusFilter = req.query.status;
  const search = req.query.search?.toLowerCase();
  let filtered = all;
  if (statusFilter && ['pending', 'confirmed', 'cancelled'].includes(statusFilter)) {
    filtered = filtered.filter(b => b.status === statusFilter);
  }
  if (search) {
    filtered = filtered.filter(b =>
      b.bookingId?.toLowerCase().includes(search) ||
      b.firstName?.toLowerCase().includes(search) ||
      b.lastName?.toLowerCase().includes(search) ||
      b.email?.toLowerCase().includes(search)
    );
  }
  res.json({ bookings: filtered, total: all.length });
});

app.patch('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
  const { status } = req.body;
  if (!status || !['pending', 'confirmed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Use: pending, confirmed, cancelled' });
  }
  const updates = { status };
  if (status === 'confirmed') updates.confirmedAt = new Date().toISOString();
  if (status === 'cancelled')  updates.cancelledAt = new Date().toISOString();
  const booking = await updateBooking(req.params.id, updates);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  // ── Auto-send Google Meet link when confirming a video consultation ──
  if (status === 'confirmed' && booking.treatment && booking.treatment.includes('video-consultation') && booking.calMeetingUrl && process.env.SMTP_USER) {
    try {
      const clientName = (booking.firstName || '') + ' ' + (booking.lastName || '');
      await transporter.sendMail({
        from: '"Ruta Naturals" <' + process.env.SMTP_USER + '>',
        to: booking.email,
        subject: 'Your video consultation with Ruta — confirmed with meeting link',
        html: '<div style="font-family:Georgia,serif;color:#2d3a2a;max-width:600px;margin:0 auto;line-height:1.7;">' +
          '<h2 style="font-weight:400;color:#b8674a;">Hello ' + (booking.firstName || '') + ',</h2>' +
          '<p>Your video consultation has been confirmed! Here\'s your private meeting link:</p>' +
          '<div style="background:#fbf7ee;padding:20px;border-radius:8px;margin:20px 0;border:1px solid rgba(45,58,42,0.1);text-align:center;">' +
          '<p style="margin-bottom:0.5rem;"><strong>Join your session:</strong></p>' +
          '<a href="' + booking.calMeetingUrl + '" style="display:inline-block;padding:0.9rem 2rem;background:#2d3a2a;color:#f4ede1;text-decoration:none;border-radius:999px;font-size:0.85rem;letter-spacing:0.1em;">Open Google Meet →</a>' +
          '</div>' +
          '<p style="color:#4a463d;font-size:0.9rem;">Please join a few minutes early. The link is also in your Cal.com calendar invitation.</p>' +
          '<p>Warmly,<br/><strong>Ruta Naturals</strong></p>' +
          '</div>',
      });
      console.log('✅ Meeting link sent for', booking.bookingId);
    } catch (emailErr) {
      console.error('❌ Meeting link email error:', emailErr.message);
    }
  }

  res.json({ booking });
});

// ── Stripe Checkout Session ───────────────────────────────────────────────
app.post('/create-checkout-session', async (req, res) => {
  const {
    firstName, lastName, email, phone,
    address, treatment, date, notes, travelFee, guests, groupDiscount, referredBy,
  } = req.body;

  if (!email || !treatment || !date) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const fee = (travelFee && !isNaN(travelFee)) ? Number(travelFee) : 0;
  const isVideo = treatment.includes('video-consultation');
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

  const productName = isVideo
    ? 'Ruta Naturals — Video Consultation'
    : 'Ruta Naturals — Komfort Flow Reset (Deposit)';
  const productDesc = isVideo
    ? `10-min video consultation · ${date} · ${firstName} ${lastName}`
    : `Home visit (~60 min) · ${date} · ${firstName} ${lastName}${fee > 0 ? ' · $15 travel fee at visit' : ''}`;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: 2500,
          product_data: { name: productName, description: productDesc, images: [] },
        },
        quantity: 1,
      }],
      customer_email: email,
      metadata: {
        firstName, lastName, phone,
        address: address || 'N/A',
        treatment, date,
        notes: notes || '',
        travelFee: String(fee),
        guests: String(guests || 1),
        groupDiscount: String(groupDiscount || '0'),
        calStart: req.body.calStart || '',
        referredBy: referredBy || '',
      },
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${baseUrl}/book.html`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: 'Payment setup failed. Please try again.' });
  }
});


// ── Session Details (used by success.html to personalise the confirmation) ──
app.get('/session-details', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing session id' });
  try {
    const session = await stripe.checkout.sessions.retrieve(id);
    // Look up the booking to find referral code and coupons
    const allBookings = await getAllBookings();
    const booking = allBookings.find(b => b.id === id) || null;
    const allCoupons = await getAllCoupons();

    // Find coupons issued for this booking's email
    const email = session.customer_email || '';
    const myCoupons = {};
    for (const code of Object.keys(allCoupons)) {
      if (allCoupons[code].email === email) myCoupons[code] = allCoupons[code];
    }

    // Find the referral code (bookingId) for this booking
    const referralCode = booking ? booking.bookingId : null;

    // Determine if this booking was referred
    const referredBy = booking ? (booking.referredBy || null) : null;

    res.json({
      email:       email,
      meta:        session.metadata,
      amount:      session.amount_total,
      referralCode: referralCode,
      referredBy:  referredBy,
      coupons:     myCoupons,
    });
  } catch (err) {
    res.status(404).json({ error: 'Session not found' });
  }
});

// ── Referral Credit Lookup ────────────────────────────────────────────────
app.get('/api/referral-lookup', async (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required' });
  try {
    const allCoupons = await getAllCoupons();
    const myCoupons = [];
    let totalEarned = 0;
    let totalUsed = 0;
    for (const code of Object.keys(allCoupons)) {
      const c = allCoupons[code];
      if (c.email && c.email.toLowerCase() === email) {
        myCoupons.push({ code: code, ...c });
        totalEarned += c.amountCents || 0;
        if (c.used) totalUsed += c.amountCents || 0;
      }
    }
    res.json({
      email: email,
      coupons: myCoupons,
      totalEarnedCents: totalEarned,
      totalUsedCents: totalUsed,
      totalAvailableCents: totalEarned - totalUsed,
    });
  } catch (err) {
    console.error('❌ Referral lookup error:', err.message);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// ── Referral info page ────────────────────────────────────────────────────
app.get('/refer', (req, res) => {
  res.sendFile(path.join(__dirname, 'refer.html'));
});

// ── Cal.com Availability Proxy ───────────────────────────────────────────
app.get('/api/slots', async (req, res) => {
  let { eventTypeId, eventTypeKeyword, start, end } = req.query;
  // Map keyword to numeric ID from env vars
  if (!eventTypeId && eventTypeKeyword) {
    if (eventTypeKeyword === 'video') eventTypeId = process.env.CALCOM_EVENT_TYPE_VIDEO;
    else if (eventTypeKeyword === 'inhome') eventTypeId = process.env.CALCOM_EVENT_TYPE_INHOME;
  }
  if (!eventTypeId || !start || !end) {
    return res.status(400).json({ error: 'Missing required params: eventTypeId or eventTypeKeyword, start, end' });
  }
  const apiKey = process.env.CALCOM_API_KEY;
  if (!apiKey) return res.json({ slots: {} });

  try {
    const url = `https://api.cal.com/v2/slots?eventTypeId=${eventTypeId}&start=${start}&end=${end}&timeZone=America%2FNew_York&format=range`;
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'cal-api-version': '2024-08-13',
      },
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error('Cal.com slots error:', err.message);
    res.json({ slots: {} });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production' || require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🌿 Ruta Naturals → http://localhost:${PORT}\n`);
  });
}

module.exports = app;
