const { query } = require('../config/database');

const logEvent = async (userId, event, email, detail, req) => {
  try {
    const ip = req?.ip || req?.headers?.['x-forwarded-for'] || null;
    const ua = req?.headers?.['user-agent'] || null;
    await query(
      'INSERT INTO events (user_id, event, email, detail, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5, $6)',
      [userId, event, email, detail, ip, ua]
    );
  } catch (err) {
    console.error('Event log error:', err);
  }
};

module.exports = { logEvent };
