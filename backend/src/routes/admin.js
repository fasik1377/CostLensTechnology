const express = require('express');
const { query } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// ═══ DASHBOARD STATS ═══
router.get('/stats', async (req, res) => {
  try {
    const [users, betaUsers, codes, events, revenue, aiUsage] = await Promise.all([
      query('SELECT COUNT(*) FROM users'),
      query('SELECT COUNT(*) FROM users WHERE is_beta = TRUE'),
      query('SELECT COUNT(*) FILTER (WHERE use_count > 0) as used, COUNT(*) as total FROM invite_codes WHERE NOT is_admin'),
      query('SELECT COUNT(*) FROM events WHERE created_at > NOW() - INTERVAL \'24 hours\''),
      query('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = \'captured\''),
      query('SELECT COUNT(*) as calls, COALESCE(SUM(input_tokens + output_tokens), 0) as tokens FROM usage_logs WHERE created_at > NOW() - INTERVAL \'24 hours\''),
    ]);
    res.json({
      totalUsers: parseInt(users.rows[0].count),
      betaUsers: parseInt(betaUsers.rows[0].count),
      codesUsed: parseInt(codes.rows[0].used),
      codesTotal: parseInt(codes.rows[0].total),
      eventsLast24h: parseInt(events.rows[0].count),
      totalRevenue: parseFloat(revenue.rows[0].total),
      aiCallsLast24h: parseInt(aiUsage.rows[0].calls),
      aiTokensLast24h: parseInt(aiUsage.rows[0].tokens),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ═══ LIST USERS ═══
router.get('/users', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, email, name, company, plan, credits, credits_used_this_month, is_beta, beta_code, is_admin, created_at, last_login,
       (SELECT COUNT(*) FROM analyses WHERE user_id = users.id) as analysis_count
       FROM users ORDER BY created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ═══ INVITE CODES ═══
router.get('/codes', async (req, res) => {
  try {
    const result = await query(
      `SELECT ic.*, u.email as used_by_email, u.name as used_by_name
       FROM invite_codes ic LEFT JOIN users u ON ic.used_by = u.id
       ORDER BY ic.created_at`
    );
    res.json({ codes: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch codes' });
  }
});

// ═══ ADD INVITE CODE ═══
router.post('/codes', async (req, res) => {
  try {
    const { code, maxUses = 1 } = req.body;
    const result = await query(
      'INSERT INTO invite_codes (code, max_uses) VALUES ($1, $2) RETURNING *',
      [code.toUpperCase(), maxUses]
    );
    res.status(201).json({ code: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create code' });
  }
});

// ═══ EVENT LOG ═══
router.get('/events', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const eventType = req.query.type;
    let q = 'SELECT * FROM events';
    const params = [];
    if (eventType) { q += ' WHERE event = $1'; params.push(eventType); }
    q += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);
    const result = await query(q, params);
    res.json({ events: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// ═══ GRANT CREDITS ═══
router.post('/grant-credits', async (req, res) => {
  try {
    const { userId, amount, reason } = req.body;
    await query('UPDATE users SET credits = credits + $1 WHERE id = $2', [amount, userId]);
    await query(
      'INSERT INTO credit_transactions (user_id, type, amount, balance, description) VALUES ($1, $2, $3, (SELECT credits FROM users WHERE id = $1), $4)',
      [userId, 'admin_grant', amount, reason || 'Admin grant']
    );
    res.json({ message: `Granted ${amount} credits` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to grant credits' });
  }
});

// ═══ USAGE ANALYTICS ═══
router.get('/usage', async (req, res) => {
  try {
    const [daily, byModule, byModel, topUsers] = await Promise.all([
      query(`SELECT DATE(created_at) as date, COUNT(*) as calls, SUM(input_tokens) as input_tok, SUM(output_tokens) as output_tok
             FROM usage_logs WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY date`),
      query(`SELECT module, COUNT(*) as count FROM analyses GROUP BY module ORDER BY count DESC`),
      query(`SELECT model, COUNT(*) as calls, SUM(input_tokens + output_tokens) as tokens FROM usage_logs WHERE model IS NOT NULL GROUP BY model ORDER BY calls DESC`),
      query(`SELECT u.name, u.email, COUNT(a.id) as analyses, u.credits_used_this_month
             FROM users u LEFT JOIN analyses a ON u.id = a.user_id GROUP BY u.id ORDER BY analyses DESC LIMIT 10`),
    ]);
    res.json({ daily: daily.rows, byModule: byModule.rows, byModel: byModel.rows, topUsers: topUsers.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

// ═══ FEEDBACK LIST ═══
router.get('/feedback', async (req, res) => {
  try {
    const result = await query(
      `SELECT f.*, u.name, u.email FROM feedback f JOIN users u ON f.user_id = u.id ORDER BY f.created_at DESC`
    );
    res.json({ feedback: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

module.exports = router;
