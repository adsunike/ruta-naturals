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
    console.log('✅ Deposit paid:', meta);
    
    // Send email notification to the admins
    const mailOptions = {
      from: `"Ruta Naturals Booking" <${process.env.SMTP_USER}>`,
      to: ['rutanaturalle@gmail.com', 'adsunike@gmail.com'],
      subject: `New Booking Deposit: ${meta.firstName} ${meta.lastName}`,
      html: `
        <h2>New Booking Deposit Received!</h2>
        <p><strong>Name:</strong> ${meta.firstName} ${meta.lastName}</p>
        <p><strong>Email:</strong> ${session.customer_email}</p>
        <p><strong>Phone:</strong> ${meta.phone}</p>
        <p><strong>Address:</strong> ${meta.address}</p>
        <p><strong>Treatment:</strong> ${meta.treatment}</p>
        <p><strong>Date:</strong> ${meta.date}</p>
        <p><strong>Notes:</strong> ${meta.notes}</p>
        <br>
        <p>The $25 deposit has been successfully captured via Stripe.</p>
      `
    };

    try {
      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        await transporter.sendMail(mailOptions);
        console.log('✅ Admin notification emails sent');
      } else {
        console.log('⚠️ SMTP credentials not configured. Skipping email notification.');
      }
    } catch (emailErr) {
      console.error('❌ Failed to send email:', emailErr.message);
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

  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: 2500,   // $25.00 in cents
            product_data: {
              name: 'Ruta Naturals — Booking Deposit',
              description: `${treatment} · ${date} · ${firstName} ${lastName}`,
              images: [],
            },
          },
          quantity: 1,
        },
      ],
      customer_email: email,
      // store all booking info as Stripe metadata (visible in dashboard)
      metadata: {
        firstName, lastName, phone,
        address, treatment, date,
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

// ── create Video Consultation Request ──────────────────────────────────────
app.post('/api/consultation', async (req, res) => {
  const { firstName, lastName, email, phone, notes, callTime } = req.body;

  if (!email || !firstName || !callTime) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  // 1. Email to Admin
  const adminMailOptions = {
    from: `"Ruta Naturals Booking" <${process.env.SMTP_USER}>`,
    to: ['rutanaturalle@gmail.com', 'adsunike@gmail.com'],
    subject: `New Video Consultation Request — ${firstName} ${lastName}`,
    html: `
      <h2>New Video Consultation Request</h2>
      <p><strong>Name:</strong> ${firstName} ${lastName}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>Preferred Time:</strong> ${callTime}</p>
      <p><strong>Notes:</strong> ${notes || 'None'}</p>
    `
  };

  // 2. Email to Client
  const clientMailOptions = {
    from: `"Ruta Naturals" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Your consultation with Ruta is being scheduled`,
    html: `
      <div style="font-family: 'Georgia', serif; color: #2d3a2a; max-width: 600px; margin: 0 auto; line-height: 1.6;">
        <h2 style="font-weight: 400; color: #b8674a;">Hello ${firstName},</h2>
        <p>Thank you for requesting a video consultation. Ruta will review your details and send you a calendar invite with the Zoom link within a few hours.</p>
        <div style="background: #fbf7ee; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid rgba(45,58,42,0.1);">
          <h3 style="margin-top: 0; font-size: 16px;">Request Summary</h3>
          <p style="margin: 5px 0;"><strong>Preferred Time:</strong> ${callTime}</p>
          <p style="margin: 5px 0;"><strong>Phone:</strong> ${phone}</p>
          ${notes ? \`<p style="margin: 5px 0;"><strong>Notes:</strong> \${notes}</p>\` : ''}
        </div>
        <p>We look forward to speaking with you.</p>
        <p>Warmly,<br><strong>Ruta Naturals</strong></p>
      </div>
    `
  };

  try {
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      await transporter.sendMail(adminMailOptions);
      await transporter.sendMail(clientMailOptions);
      console.log(\`✅ Consultation emails sent for \${email}\`);
    } else {
      console.log('⚠️ SMTP credentials not configured. Skipping emails.');
    }
    const bookingId = 'VC-' + Math.floor(Math.random()*10000);
    res.json({ success: true, bookingId });
  } catch (err) {
    console.error('❌ Failed to send consultation email:', err.message);
    res.status(500).json({ error: 'Failed to process request.' });
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
