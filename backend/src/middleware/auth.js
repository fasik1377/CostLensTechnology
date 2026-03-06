const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

// Verify JWT token
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await query('SELECT id, email, name, plan, credits, is_admin, is_beta, is_active FROM users WHERE id = $1', [decoded.userId]);
    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Admin only
const requireAdmin = (req, res, next) => {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Pro plan or higher
const requirePro = (req, res, next) => {
  const proPlan = ['professional', 'team', 'enterprise'];
  if (!proPlan.includes(req.user?.plan) && !req.user?.is_beta) {
    return res.status(403).json({ error: 'Professional plan required' });
  }
  next();
};

// Has AI credits
const requireCredits = (amount = 1) => {
  return (req, res, next) => {
    if (req.user.credits < amount) {
      return res.status(402).json({
        error: 'Insufficient AI credits',
        credits: req.user.credits,
        required: amount,
        code: 'NO_CREDITS'
      });
    }
    next();
  };
};

module.exports = { authenticate, requireAdmin, requirePro, requireCredits };
