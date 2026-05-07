require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);

const nodemailer = require('nodemailer');

const app  = express();
const PORT = process.env.PORT || 3002;

// ── Email Transporter Setup ────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ── Booking Store (JSON file — swap to Vercel KV / DB for production) ──────
const BOOKINGS_PATH = path.join(__dirname, 'bookings.json');
let bookingsCache = null;

function loadBookings() {
  if (bookingsCache) return bookingsCache;
  try {
    if (fs.existsSync(BOOKINGS_PATH)) {
      bookingsCache = JSON.parse(fs.readFileSync(BOOKINGS_PATH, 'utf-8'));
    } else {
      bookingsCache = [];
    }
  } catch (e) {
    console.error('Failed to load bookings:', e.message);
    bookingsCache = [];
  }
  return bookingsCache;
}

function saveBookings() {
  try {
    fs.writeFileSync(BOOKINGS_PATH, JSON.stringify(bookingsCache, null, 2));
  } catch (e) {
    console.error('Failed to save bookings:', e.message);
  }
}

function addBooking(data) {
  loadBookings();
  if (bookingsCache.find(b => b.id === data.id)) return false;
  bookingsCache.push(data);
  saveBookings();
  return true;
}

function updateBooking(id, updates) {
  loadBookings();
  const idx = bookingsCache.findIndex(b => b.id === id);
  if (idx === -1) return null;
  bookingsCache[idx] = { ...bookingsCache[idx], ...updates };
  saveBookings();
  return bookingsCache[idx];
}

// ── Stripe webhook (MUST be before express.json) ───────────────────────────
// Set STRIPE_WEBHOOK_SECRET in .env and point the Stripe dashboard to /webhook
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.sendStatus(200);          // skip if not configured

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
    console.log('✅ Payment completed:', meta.treatment);

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
      <p style="color:#b8674a;"><em>Please send the client a Zoom or Google Meet link at their email address above.</em></p>
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
          <p><strong>Service:</strong> Video Consultation (40 min)</p>
          <p><strong>Preferred Time:</strong> ${meta.date}</p>
          <p><strong>Amount Paid:</strong> $25.00 (full payment)</p>
        </div>
        <p>Ruta will send your Zoom or Google Meet link to this email within a few hours.</p>
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
          ${meta.travelFee && meta.travelFee !== '0' ? `<p><strong>Travel Fee:</strong> $${''}${meta.travelFee} (collected at visit)</p>` : ''}
          <p><strong>Balance at Visit:</strong> $${((Number(meta.guests || 1) * (meta.guests !== '1' ? 160 : 200)) - 25 + Number(meta.travelFee || 0)).toFixed(2)}</p>
        </div>
        <p>Ruta will confirm your appointment personally within a few hours. See you soon.</p>
        <p>Warmly,<br/><strong>Ruta Naturals</strong></p>
      </div>
    `;

    try {
      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        await transporter.sendMail({
          from: `"Ruta Naturals Booking" <${process.env.SMTP_USER}>`,
          to: ['rutanaturalle@gmail.com', 'adsunike@gmail.com'],
          subject: adminSubject,
          html: adminBody,
        });
        await transporter.sendMail({
          from: `"Ruta Naturals" <${process.env.SMTP_USER}>`,
          to: session.customer_email,
          subject: clientSubject,
          html: clientBody,
        });
        console.log('✅ Emails sent for', meta.treatment);
      } else {
        console.log('⚠️ SMTP not configured. Skipping emails.');
      }
    } catch (emailErr) {
      console.error('❌ Email error:', emailErr.message);
    }

    // ── persist booking to local store ──
    const existing = loadBookings();
    const count = existing.length;
    const bookingData = {
      id: session.id,
      bookingId: 'RN-' + String(count + 1).padStart(4, '0'),
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
      paymentStatus: 'paid',
      amount: 2500,
      confirmedAt: null,
      cancelledAt: null,
    };
    addBooking(bookingData);
    console.log('📦 Booking stored:', bookingData.bookingId);
  }

  res.sendStatus(200);
});


// ── middleware ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));   // serve index.html, success.html, etc.

// ── Admin auth middleware ──────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return res.status(500).json({ error: 'ADMIN_PASSWORD not configured in .env' });
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== pw) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Admin API routes ──────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  const all = loadBookings();
  // Sort most recent first
  all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const statusFilter = req.query.status;
  const search = req.query.search?.toLowerCase();
  let filtered = all;
  if (statusFilter && ['pending', 'confirmed', 'cancelled'].includes(statusFilter)) {
    filtered = filtered.filter(b => b.status === statusFilter);
  }
  if (search) {
    filtered = filtered.filter(b =>
      b.bookingId.toLowerCase().includes(search) ||
      b.firstName.toLowerCase().includes(search) ||
      b.lastName.toLowerCase().includes(search) ||
      b.email.toLowerCase().includes(search)
    );
  }
  res.json({ bookings: filtered, total: all.length });
});

app.patch('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!status || !['pending', 'confirmed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Use: pending, confirmed, cancelled' });
  }
  const updates = { status };
  if (status === 'confirmed') updates.confirmedAt = new Date().toISOString();
  if (status === 'cancelled') updates.cancelledAt = new Date().toISOString();
  const booking = updateBooking(req.params.id, updates);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  res.json({ booking });
});

// ── create Stripe Checkout Session ─────────────────────────────────────────
app.post('/create-checkout-session', async (req, res) => {
  const {
    firstName, lastName, email, phone,
    address, treatment, date, notes, travelFee, guests, groupDiscount,
  } = req.body;

  // basic server-side validation
  if (!email || !treatment || !date) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const fee = (travelFee && !isNaN(travelFee)) ? Number(travelFee) : 0;
  const isVideo = treatment.includes('video-consultation');
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

  // Determine correct Stripe product name and description
  const productName = isVideo
    ? 'Ruta Naturals — Video Consultation'
    : 'Ruta Naturals — Komfort Flow Reset (Deposit)';
  const productDesc = isVideo
    ? `10-min video call · ${date} · ${firstName} ${lastName}`
    : `Home visit (~60 min) · ${date} · ${firstName} ${lastName}${fee > 0 ? ' · $15 travel fee at visit' : ''}`;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: 2500,   // $25.00 in cents (full for video, deposit for in-home)
            product_data: {
              name: productName,
              description: productDesc,
              images: [],
            },
          },
          quantity: 1,
        },
      ],
      customer_email: email,
      metadata: {
        firstName, lastName, phone,
        address: address || 'N/A',
        treatment, date,
        notes: notes || '',
        travelFee: String(fee),
        guests: String(guests || 1),
        groupDiscount: String(groupDiscount || '0'),
      },
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${baseUrl}/book.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ── start ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production' || require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🌿 Ruta Naturals server running → http://localhost:${PORT}\n`);
  });
}

// Export for Vercel serverless deployment
module.exports = app;
