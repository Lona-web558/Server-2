/*
 ╔══════════════════════════════════════════════════════════════╗
 ║   AuTrader Pro — Payout Server                               ║
 ║   Deploy to: Render.com (https://server-ay9x.onrender.com)   ║
 ║   Endpoint:  POST /api/paypal/payout                         ║
 ╚══════════════════════════════════════════════════════════════╝

 ENVIRONMENT VARIABLES — set these in Render dashboard:
   PAYPAL_CLIENT_ID      → your PayPal REST app Client ID
   PAYPAL_CLIENT_SECRET  → your PayPal REST app Client Secret
   PAYPAL_MODE           → "sandbox"  OR  "live"
   ALLOWED_ORIGIN        → your front-end URL (e.g. https://autraderpro.netlify.app)
                           use * during testing
*/

const express     = require('express');
const cors        = require('cors');
const axios       = require('axios');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── PayPal config from env ── */
const PAYPAL_MODE          = (process.env.PAYPAL_MODE || 'sandbox').toLowerCase();
const PAYPAL_CLIENT_ID     = process.env.PAYPAL_CLIENT_ID     || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const ALLOWED_ORIGIN       = process.env.ALLOWED_ORIGIN        || '*';

const PAYPAL_BASE = PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

/* ── Middleware ── */
app.use(express.json());
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

/* ── Health check ── */
app.get('/', (_req, res) => {
  res.json({
    status  : 'AuTrader Pro Payout Server — online',
    mode    : PAYPAL_MODE,
    endpoint: '/api/paypal/payout'
  });
});

/* ══════════════════════════════════════════════════════════════
   HELPER — Get PayPal OAuth2 access token
══════════════════════════════════════════════════════════════ */
async function getPayPalAccessToken() {
  const credentials = Buffer
    .from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`)
    .toString('base64');

  const response = await axios.post(
    `${PAYPAL_BASE}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type' : 'application/x-www-form-urlencoded'
      }
    }
  );

  return response.data.access_token;
}

/* ══════════════════════════════════════════════════════════════
   POST /api/paypal/payout

   Expected body from front-end:
   {
     "recipient" : "user@paypal.com",   ← PayPal email to pay
     "amount"    : "27.03"              ← USD amount (string or number)
   }

   Returns on success:
   { "success": true, "payoutBatchId": "XXXX..." }

   Returns on failure:
   { "success": false, "error": "reason..." }
══════════════════════════════════════════════════════════════ */
app.post('/api/paypal/payout', async (req, res) => {
  const { recipient, amount } = req.body;

  /* ── Input validation ── */
  if (!recipient || typeof recipient !== 'string' || !recipient.includes('@')) {
    return res.status(400).json({ success: false, error: 'Invalid recipient email.' });
  }

  const parsedAmount = parseFloat(amount);
  if (!parsedAmount || parsedAmount < 1) {
    return res.status(400).json({ success: false, error: 'Minimum payout is $1.00 USD.' });
  }

  const formattedAmount = parsedAmount.toFixed(2);
  const senderItemId   = 'AUTP-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();

  console.log(`[PAYOUT] Request → ${recipient} | $${formattedAmount} USD | Ref: ${senderItemId}`);

  try {
    /* ── Step 1: get access token ── */
    const accessToken = await getPayPalAccessToken();

    /* ── Step 2: create payout batch ── */
    const payoutPayload = {
      sender_batch_header: {
        sender_batch_id: senderItemId,
        email_subject  : 'AuTrader Pro — Your withdrawal has been processed',
        email_message  : `Your withdrawal of $${formattedAmount} USD from AuTrader Pro is on its way to your PayPal account.`
      },
      items: [
        {
          recipient_type: 'EMAIL',
          amount: {
            value   : formattedAmount,
            currency: 'USD'
          },
          note            : `AuTrader Pro withdrawal — Ref: ${senderItemId}`,
          sender_item_id  : senderItemId,
          receiver        : recipient
        }
      ]
    };

    const payoutResponse = await axios.post(
      `${PAYPAL_BASE}/v1/payments/payouts`,
      payoutPayload,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type' : 'application/json'
        }
      }
    );

    const batchId = payoutResponse.data?.batch_header?.payout_batch_id || senderItemId;
    console.log(`[PAYOUT] ✓ Success → Batch ID: ${batchId}`);

    return res.status(200).json({
      success      : true,
      payoutBatchId: batchId,
      ref          : senderItemId,
      recipient,
      amount       : formattedAmount,
      currency     : 'USD'
    });

  } catch (err) {
    /* ── PayPal API error details ── */
    const ppError = err.response?.data;
    const errMsg  = ppError?.message
      || ppError?.error_description
      || err.message
      || 'Payout failed. Please try again.';

    console.error('[PAYOUT] ✗ Error:', JSON.stringify(ppError || err.message));

    return res.status(500).json({
      success: false,
      error  : errMsg,
      detail : ppError || null
    });
  }
});

/* ── 404 fallback ── */
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

/* ── Start ── */
app.listen(PORT, () => {
  console.log(`AuTrader Pro Payout Server running on port ${PORT} [${PAYPAL_MODE.toUpperCase()}]`);
});
