const express = require('express');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');
const { query } = require('../config/database');
const { authenticate, requireCredits } = require('../middleware/auth');
const { logEvent } = require('../services/events');

const router = express.Router();

// AI-specific rate limit (stricter)
const aiLimiter = rateLimit({
  windowMs: parseInt(process.env.AI_RATE_LIMIT_WINDOW_MS) || 60000,
  max: parseInt(process.env.AI_RATE_LIMIT_MAX_REQUESTS) || 10,
  message: { error: 'AI rate limit exceeded. Please wait a moment.' },
});

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const getHeaders = () => ({
  'Content-Type': 'application/json',
  'x-api-key': process.env.ANTHROPIC_API_KEY,
  'anthropic-version': '2023-06-01',
});

// ═══ MAIN AI PROXY — Used by callAI in frontend ═══
router.post('/extract', authenticate, aiLimiter, requireCredits(1), async (req, res) => {
  try {
    const { messages, creditsToUse = 1 } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array required' });
    }

    // Try primary model
    let response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        model: process.env.ANTHROPIC_PRIMARY_MODEL || 'claude-opus-4-6',
        max_tokens: 8192,
        temperature: 0,
        messages,
      }),
    });

    // Fallback on failure
    if (!response.ok) {
      response = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          model: process.env.ANTHROPIC_FALLBACK_MODEL || 'claude-sonnet-4-5-20250929',
          max_tokens: 8192,
          temperature: 0,
          messages,
        }),
      });
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `API ${response.status}`);
    }

    const data = await response.json();

    // Deduct credits
    const creditsUsed = Math.min(creditsToUse, req.user.credits);
    await query('UPDATE users SET credits = credits - $1, credits_used_this_month = credits_used_this_month + $1 WHERE id = $2', [creditsUsed, req.user.id]);
    await query(
      'INSERT INTO credit_transactions (user_id, type, amount, balance, description, reference) VALUES ($1, $2, $3, (SELECT credits FROM users WHERE id = $1), $4, $5)',
      [req.user.id, 'usage', -creditsUsed, 'AI extraction', data.model || 'unknown']
    );

    // Log usage
    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;
    await query(
      'INSERT INTO usage_logs (user_id, action, detail, model, input_tokens, output_tokens) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.user.id, 'ai_extract', `${creditsUsed} credit(s)`, data.model, inputTokens, outputTokens]
    );

    await logEvent(req.user.id, 'AI_CREDIT_USED', req.user.email, `Credits used: ${creditsUsed}, remaining: ${req.user.credits - creditsUsed}`, req);

    res.json({
      content: data.content,
      model: data.model,
      usage: data.usage,
      creditsRemaining: req.user.credits - creditsUsed,
    });
  } catch (err) {
    console.error('AI extract error:', err);
    res.status(502).json({ error: 'AI service error: ' + err.message });
  }
});

// ═══ SMART ACTIONS — Lower credit cost, uses fast model ═══
router.post('/action', authenticate, aiLimiter, async (req, res) => {
  try {
    const { system, messages } = req.body;

    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        model: process.env.ANTHROPIC_FAST_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: system || 'You are a procurement expert for Indian manufacturing. Generate professional, actionable content.',
        messages,
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `API ${response.status}`);
    }

    const data = await response.json();

    // Log usage (no credit deduction for smart actions)
    await query(
      'INSERT INTO usage_logs (user_id, action, model, input_tokens, output_tokens) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'smart_action', data.model, data.usage?.input_tokens || 0, data.usage?.output_tokens || 0]
    );

    res.json({ content: data.content, model: data.model });
  } catch (err) {
    console.error('AI action error:', err);
    res.status(502).json({ error: 'AI service error: ' + err.message });
  }
});

// ═══ COMMODITY INTELLIGENCE — Web search enabled ═══
router.post('/commodity', authenticate, aiLimiter, requireCredits(1), async (req, res) => {
  try {
    const { system, messages } = req.body;

    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        model: process.env.ANTHROPIC_FAST_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 16000,
        system,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages,
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `API ${response.status}`);
    }

    const data = await response.json();

    // Deduct 1 credit
    await query('UPDATE users SET credits = credits - 1, credits_used_this_month = credits_used_this_month + 1 WHERE id = $1', [req.user.id]);
    await query(
      'INSERT INTO credit_transactions (user_id, type, amount, balance, description) VALUES ($1, $2, $3, (SELECT credits FROM users WHERE id = $1), $4)',
      [req.user.id, 'usage', -1, 'Commodity intelligence']
    );

    res.json({ content: data.content, model: data.model, usage: data.usage });
  } catch (err) {
    console.error('Commodity AI error:', err);
    res.status(502).json({ error: 'AI service error: ' + err.message });
  }
});

// ═══ AI REPORTS — Higher credit cost ═══
router.post('/report', authenticate, aiLimiter, async (req, res) => {
  try {
    const { messages, creditsToUse = 3 } = req.body;

    if (req.user.credits < creditsToUse) {
      return res.status(402).json({ error: 'Insufficient credits', required: creditsToUse, available: req.user.credits });
    }

    let response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        model: process.env.ANTHROPIC_PRIMARY_MODEL || 'claude-opus-4-6',
        max_tokens: 8192,
        temperature: 0,
        messages,
      }),
    });

    if (!response.ok) {
      response = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          model: process.env.ANTHROPIC_FALLBACK_MODEL || 'claude-sonnet-4-5-20250929',
          max_tokens: 8192,
          temperature: 0,
          messages,
        }),
      });
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `API ${response.status}`);
    }

    const data = await response.json();

    // Deduct credits
    await query('UPDATE users SET credits = credits - $1, credits_used_this_month = credits_used_this_month + $1 WHERE id = $2', [creditsToUse, req.user.id]);
    await query(
      'INSERT INTO credit_transactions (user_id, type, amount, balance, description) VALUES ($1, $2, $3, (SELECT credits FROM users WHERE id = $1), $4)',
      [req.user.id, 'usage', -creditsToUse, 'AI analysis report']
    );

    await query(
      'INSERT INTO usage_logs (user_id, action, detail, model, input_tokens, output_tokens) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.user.id, 'report_run', `${creditsToUse} credits`, data.model, data.usage?.input_tokens || 0, data.usage?.output_tokens || 0]
    );

    res.json({ content: data.content, model: data.model, usage: data.usage, creditsRemaining: req.user.credits - creditsToUse });
  } catch (err) {
    console.error('AI report error:', err);
    res.status(502).json({ error: 'AI service error: ' + err.message });
  }
});

module.exports = router;
