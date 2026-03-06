const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ═══ UPDATE PROFILE ═══
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { name, phone, company, designation, industry, company_size, account_type } = req.body;
    const result = await query(
      `UPDATE users SET name = COALESCE($1, name), phone = COALESCE($2, phone), company = COALESCE($3, company),
       designation = COALESCE($4, designation), industry = COALESCE($5, industry),
       company_size = COALESCE($6, company_size), account_type = COALESCE($7, account_type)
       WHERE id = $8 RETURNING id, email, name, phone, company, designation, industry, company_size, account_type`,
      [name, phone, company, designation, industry, company_size, account_type, req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// ═══ UPDATE PREFERENCES ═══
router.put('/preferences', authenticate, async (req, res) => {
  try {
    const { preferences } = req.body;
    const result = await query(
      'UPDATE users SET preferences = $1 WHERE id = $2 RETURNING preferences',
      [JSON.stringify(preferences), req.user.id]
    );
    res.json({ preferences: result.rows[0].preferences });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// ═══ GET ANALYSIS HISTORY ═══
router.get('/history', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const result = await query(
      'SELECT id, module, name, result_val, total, credits_used, created_at FROM analyses WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [req.user.id, limit, offset]
    );
    const countResult = await query('SELECT COUNT(*) FROM analyses WHERE user_id = $1', [req.user.id]);
    res.json({ analyses: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// ═══ GET SINGLE ANALYSIS ═══
router.get('/history/:id', authenticate, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM analyses WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Analysis not found' });
    res.json({ analysis: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch analysis' });
  }
});

// ═══ SAVE ANALYSIS ═══
router.post('/history', authenticate, async (req, res) => {
  try {
    const { module, name, result_val, total, result_data, credits_used } = req.body;
    const result = await query(
      `INSERT INTO analyses (user_id, module, name, result_val, total, result_data, credits_used)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, module, name, result_val, total, created_at`,
      [req.user.id, module, name, result_val, total, JSON.stringify(result_data), credits_used || 0]
    );
    res.status(201).json({ analysis: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save analysis' });
  }
});

// ═══ DELETE ANALYSIS ═══
router.delete('/history/:id', authenticate, async (req, res) => {
  try {
    await query('DELETE FROM analyses WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ═══ CREDIT BALANCE & TRANSACTIONS ═══
router.get('/credits', authenticate, async (req, res) => {
  try {
    const txResult = await query(
      'SELECT type, amount, balance, description, created_at FROM credit_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ credits: req.user.credits, transactions: txResult.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch credits' });
  }
});

// ═══ SUBMIT FEEDBACK (Beta — earn 25 credits) ═══
router.post('/feedback', authenticate, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim().length < 10) {
      return res.status(400).json({ error: 'Feedback must be at least 10 characters' });
    }
    // Check if already submitted
    const existing = await query('SELECT id FROM feedback WHERE user_id = $1', [req.user.id]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Feedback already submitted' });
    }

    const bonusCredits = 25;
    await query('INSERT INTO feedback (user_id, feedback_text, credits_awarded) VALUES ($1, $2, $3)', [req.user.id, text.slice(0, 2000), bonusCredits]);
    await query('UPDATE users SET credits = credits + $1 WHERE id = $2', [bonusCredits, req.user.id]);
    await query('INSERT INTO credit_transactions (user_id, type, amount, balance, description) VALUES ($1, $2, $3, (SELECT credits FROM users WHERE id = $1), $4)',
      [req.user.id, 'bonus', bonusCredits, 'Beta feedback bonus']);

    res.json({ message: 'Thank you!', creditsAdded: bonusCredits });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// ═══ USAGE STATS ═══
router.get('/stats', authenticate, async (req, res) => {
  try {
    const [analyses, creditsUsed, moduleUsage] = await Promise.all([
      query('SELECT COUNT(*) FROM analyses WHERE user_id = $1', [req.user.id]),
      query('SELECT SUM(ABS(amount)) FROM credit_transactions WHERE user_id = $1 AND type = $2', [req.user.id, 'usage']),
      query('SELECT module, COUNT(*) as count FROM analyses WHERE user_id = $1 GROUP BY module ORDER BY count DESC LIMIT 5', [req.user.id]),
    ]);
    res.json({
      totalAnalyses: parseInt(analyses.rows[0].count),
      totalCreditsUsed: parseInt(creditsUsed.rows[0].sum || 0),
      topModules: moduleUsage.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
