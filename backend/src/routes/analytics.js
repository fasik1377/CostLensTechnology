const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ═══ USER'S OWN ANALYTICS ═══
router.get('/my-usage', authenticate, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const [daily, modules, credits] = await Promise.all([
      query(
        `SELECT DATE(created_at) as date, COUNT(*) as analyses
         FROM analyses WHERE user_id = $1 AND created_at > NOW() - INTERVAL '${days} days'
         GROUP BY DATE(created_at) ORDER BY date`,
        [req.user.id]
      ),
      query(
        'SELECT module, COUNT(*) as count FROM analyses WHERE user_id = $1 GROUP BY module ORDER BY count DESC',
        [req.user.id]
      ),
      query(
        `SELECT DATE(created_at) as date, SUM(ABS(amount)) as used
         FROM credit_transactions WHERE user_id = $1 AND type = 'usage' AND created_at > NOW() - INTERVAL '${days} days'
         GROUP BY DATE(created_at) ORDER BY date`,
        [req.user.id]
      ),
    ]);
    res.json({ daily: daily.rows, modules: modules.rows, creditUsage: credits.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;
