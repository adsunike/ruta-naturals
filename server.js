require('dotenv').config();
const express = require('express');
const path    = require('path');
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
          <p><strong>Service:</strong> Komfort Flow Reset (75–90 min)</p>
          <p><strong>Date/Time:</strong> ${meta.date}</p>
          <p><strong>Address:</strong> ${meta.address}</p>
          <p><strong>Deposit Paid:</strong> $25.00</p>
          <p><strong>Balance at Visit:</strong> $175.00</p>
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
  }

  res.sendStatus(200);
});


// ── middleware ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));   // serve index.html, success.html, etc.

// ── create Stripe Checkout Session ─────────────────────────────────────────
app.post('/create-checkout-session', async (req, res) => {
  const {
    firstName, lastName, email, phone,
    address, treatment, date, notes,
  } = req.body;

  // basic server-side validation
  if (!email || !treatment || !date) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const isVideo = treatment.includes('video-consultation');
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

  // Determine correct Stripe product name and description
  const productName = isVideo
    ? 'Ruta Naturals — Video Consultation'
    : 'Ruta Naturals — Komfort Flow Reset (Deposit)';
  const productDesc = isVideo
    ? `40-min video call · ${date} · ${firstName} ${lastName}`
    : `Home visit · ${date} · ${firstName} ${lastName}`;

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
