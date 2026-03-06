const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { logEvent } = require('../services/events');

const router = express.Router();

// Generate tokens
const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
  const refreshToken = jwt.sign({ userId, type: 'refresh' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' });
  return { accessToken, refreshToken };
};

// ═══ REGISTER ═══
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, inviteCode } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password required' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    // Check if user exists
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Validate invite code (if beta mode)
    let isBeta = false, isAdmin = false, betaCode = null, plan = 'free', credits = 0;

    if (inviteCode) {
      const codeResult = await query('SELECT * FROM invite_codes WHERE code = $1', [inviteCode.toUpperCase()]);
      if (codeResult.rows.length === 0) {
        await logEvent(null, 'INVALID_CODE', email, `Invalid code: ${inviteCode}`, req);
        return res.status(400).json({ error: 'Invalid invite code' });
      }

      const code = codeResult.rows[0];
      if (code.use_count >= code.max_uses && !code.is_admin) {
        await logEvent(null, 'CODE_REUSE', email, `Code ${inviteCode} already used by ${code.used_by}`, req);
        return res.status(400).json({ error: 'This invite code has already been used. Contact founder@costlens.technology for a new code.' });
      }

      isBeta = true;
      isAdmin = code.is_admin;
      betaCode = inviteCode.toUpperCase();
      plan = 'professional';
      credits = 50;

      // Mark code as used
      if (!code.is_admin) {
        await query('UPDATE invite_codes SET use_count = use_count + 1, used_at = NOW() WHERE code = $1', [inviteCode.toUpperCase()]);
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const result = await query(
      `INSERT INTO users (email, password_hash, name, plan, credits, is_beta, beta_code, is_admin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, email, name, plan, credits, is_beta, is_admin`,
      [email.toLowerCase(), passwordHash, name, plan, credits, isBeta, betaCode, isAdmin || email.toLowerCase() === process.env.ADMIN_EMAIL?.toLowerCase()]
    );

    const user = result.rows[0];
    const { accessToken, refreshToken } = generateTokens(user.id);

    // Store refresh token
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await query('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)', [user.id, refreshToken, expiresAt]);

    // Log credit grant
    if (credits > 0) {
      await query('INSERT INTO credit_transactions (user_id, type, amount, balance, description) VALUES ($1, $2, $3, $4, $5)',
        [user.id, 'subscription', credits, credits, isBeta ? 'Beta registration — 50 credits' : 'Plan activation']);
    }

    await logEvent(user.id, isBeta ? 'BETA_REGISTER' : 'REGISTER', email, `Registered with ${betaCode || 'no code'}`, req);

    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan, credits: user.credits, isBeta: user.is_beta, isAdmin: user.is_admin },
      accessToken,
      refreshToken
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ═══ LOGIN ═══
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await query(
      'SELECT id, email, password_hash, name, plan, credits, is_beta, is_admin, is_active FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account deactivated' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const { accessToken, refreshToken } = generateTokens(user.id);

    // Store refresh token
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await query('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)', [user.id, refreshToken, expiresAt]);

    // Update last login
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    await logEvent(user.id, 'LOGIN', email, null, req);

    res.json({
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan, credits: user.credits, isBeta: user.is_beta, isAdmin: user.is_admin },
      accessToken,
      refreshToken
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ═══ REFRESH TOKEN ═══
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    const tokenResult = await query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND user_id = $2 AND revoked = FALSE AND expires_at > NOW()',
      [refreshToken, decoded.userId]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Revoke old token
    await query('UPDATE refresh_tokens SET revoked = TRUE WHERE token = $1', [refreshToken]);

    // Issue new tokens
    const tokens = generateTokens(decoded.userId);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await query('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)', [decoded.userId, tokens.refreshToken, expiresAt]);

    res.json(tokens);
  } catch (err) {
    res.status(401).json({ error: 'Token refresh failed' });
  }
});

// ═══ LOGOUT ═══
router.post('/logout', authenticate, async (req, res) => {
  try {
    await query('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1', [req.user.id]);
    await logEvent(req.user.id, 'LOGOUT', req.user.email, null, req);
    res.json({ message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ═══ ME (get current user) ═══
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, email, name, phone, company, designation, industry, company_size, account_type, plan, credits, credits_used_this_month, is_beta, is_admin, preferences, created_at, last_login FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get user' });
  }
});

module.exports = router;
