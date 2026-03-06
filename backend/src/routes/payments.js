const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ═══ GET PLANS ═══
router.get('/plans', async (req, res) => {
  try {
    const result = await query('SELECT * FROM plans WHERE is_active = TRUE ORDER BY monthly_price');
    res.json({ plans: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// ═══ GET TOP-UP PACKS ═══
router.get('/topup-packs', async (req, res) => {
  try {
    const result = await query('SELECT * FROM topup_packs WHERE is_active = TRUE ORDER BY price');
    res.json({ packs: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch packs' });
  }
});

// ═══ CREATE SUBSCRIPTION ORDER ═══
router.post('/subscribe', authenticate, async (req, res) => {
  try {
    const { planId, billingCycle = 'monthly' } = req.body;

    const planResult = await query('SELECT * FROM plans WHERE id = $1', [planId]);
    if (planResult.rows.length === 0) return res.status(404).json({ error: 'Plan not found' });

    const plan = planResult.rows[0];
    const amount = billingCycle === 'yearly' ? plan.yearly_price : plan.monthly_price;

    if (amount <= 0) return res.status(400).json({ error: 'Free plan — no payment needed' });

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // Razorpay uses paise
      currency: 'INR',
      receipt: `sub_${req.user.id}_${Date.now()}`,
      notes: { userId: req.user.id, planId, billingCycle },
    });

    // Store in DB
    await query(
      `INSERT INTO payments (user_id, razorpay_order_id, amount, currency, type, status)
       VALUES ($1, $2, $3, 'INR', 'subscription', 'created')`,
      [req.user.id, order.id, amount]
    );

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      plan: { id: planId, name: plan.name, credits: plan.credits_per_month, billingCycle },
    });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// ═══ CREATE TOP-UP ORDER ═══
router.post('/topup', authenticate, async (req, res) => {
  try {
    const { packId } = req.body;

    const packResult = await query('SELECT * FROM topup_packs WHERE id = $1 AND is_active = TRUE', [packId]);
    if (packResult.rows.length === 0) return res.status(404).json({ error: 'Pack not found' });

    const pack = packResult.rows[0];

    const order = await razorpay.orders.create({
      amount: Math.round(pack.price * 100),
      currency: 'INR',
      receipt: `top_${req.user.id}_${Date.now()}`,
      notes: { userId: req.user.id, packId, credits: pack.credits },
    });

    await query(
      `INSERT INTO payments (user_id, razorpay_order_id, amount, currency, type, credits_added, status)
       VALUES ($1, $2, $3, 'INR', 'topup', $4, 'created')`,
      [req.user.id, order.id, pack.price, pack.credits]
    );

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      pack,
    });
  } catch (err) {
    console.error('Top-up error:', err);
    res.status(500).json({ error: 'Failed to create top-up order' });
  }
});

// ═══ VERIFY PAYMENT ═══
router.post('/verify', authenticate, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(body).digest('hex');

    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    // Update payment record
    const paymentResult = await query(
      `UPDATE payments SET razorpay_payment_id = $1, razorpay_signature = $2, status = 'captured', updated_at = NOW()
       WHERE razorpay_order_id = $3 AND user_id = $4 RETURNING *`,
      [razorpay_payment_id, razorpay_signature, razorpay_order_id, req.user.id]
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Payment record not found' });
    }

    const payment = paymentResult.rows[0];

    if (payment.type === 'subscription') {
      // Upgrade plan
      const notes = (await razorpay.orders.fetch(razorpay_order_id)).notes;
      const planId = notes.planId;
      const planResult = await query('SELECT * FROM plans WHERE id = $1', [planId]);
      const plan = planResult.rows[0];

      await query(
        'UPDATE users SET plan = $1, credits = credits + $2 WHERE id = $3',
        [planId, plan.credits_per_month, req.user.id]
      );

      // Create subscription record
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + (notes.billingCycle === 'yearly' ? 12 : 1));
      await query(
        `INSERT INTO subscriptions (user_id, plan, amount, billing_cycle, current_period_start, current_period_end)
         VALUES ($1, $2, $3, $4, NOW(), $5)`,
        [req.user.id, planId, payment.amount, notes.billingCycle || 'monthly', periodEnd]
      );

      await query(
        'INSERT INTO credit_transactions (user_id, type, amount, balance, description, reference) VALUES ($1, $2, $3, (SELECT credits FROM users WHERE id = $1), $4, $5)',
        [req.user.id, 'subscription', plan.credits_per_month, `${plan.name} plan activation`, razorpay_payment_id]
      );
    } else if (payment.type === 'topup') {
      // Add credits
      await query('UPDATE users SET credits = credits + $1 WHERE id = $2', [payment.credits_added, req.user.id]);
      await query(
        'INSERT INTO credit_transactions (user_id, type, amount, balance, description, reference) VALUES ($1, $2, $3, (SELECT credits FROM users WHERE id = $1), $4, $5)',
        [req.user.id, 'topup', payment.credits_added, `Top-up: ${payment.credits_added} credits`, razorpay_payment_id]
      );
    }

    // Get updated user
    const userResult = await query('SELECT plan, credits FROM users WHERE id = $1', [req.user.id]);

    res.json({
      message: 'Payment verified',
      payment: { type: payment.type, amount: payment.amount, creditsAdded: payment.credits_added },
      user: userResult.rows[0],
    });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

// ═══ RAZORPAY WEBHOOK ═══
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const expectedSig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(JSON.stringify(req.body)).digest('hex');

    if (signature !== expectedSig) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const event = req.body.event;
    const payload = req.body.payload;

    console.log('Razorpay webhook:', event);

    // Handle different webhook events
    switch (event) {
      case 'payment.captured':
        // Already handled in /verify
        break;
      case 'payment.failed':
        const orderId = payload.payment?.entity?.order_id;
        if (orderId) {
          await query("UPDATE payments SET status = 'failed', updated_at = NOW() WHERE razorpay_order_id = $1", [orderId]);
        }
        break;
      case 'refund.created':
        // Handle refund
        break;
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ═══ PAYMENT HISTORY ═══
router.get('/history', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, type, amount, currency, credits_added, status, created_at
       FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json({ payments: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

module.exports = router;
