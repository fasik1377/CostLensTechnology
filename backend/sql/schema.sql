-- ═══════════════════════════════════════════════════════════════
-- CostLens — PostgreSQL Database Schema
-- Run: psql -U costlens_admin -d costlens -f schema.sql
-- ═══════════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══ ENUMS ═══
CREATE TYPE user_plan AS ENUM ('free', 'starter', 'professional', 'team', 'enterprise');
CREATE TYPE account_type AS ENUM ('individual', 'enterprise');
CREATE TYPE payment_status AS ENUM ('created', 'authorized', 'captured', 'failed', 'refunded');
CREATE TYPE credit_tx_type AS ENUM ('subscription', 'topup', 'usage', 'bonus', 'refund', 'admin_grant');
CREATE TYPE event_type AS ENUM (
  'LOGIN', 'LOGOUT', 'REGISTER', 'FEATURE_USE', 'AI_CREDIT_USED',
  'INVALID_CODE', 'CODE_REUSE', 'BETA_REGISTER', 'BETA_FEEDBACK',
  'EXPIRED_LOGIN', 'PAYMENT', 'PLAN_CHANGE', 'PASSWORD_RESET'
);

-- ═══ USERS ═══
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  phone         VARCHAR(20),
  company       VARCHAR(255),
  designation   VARCHAR(255),
  industry      VARCHAR(100) DEFAULT 'Manufacturing — Auto',
  company_size  VARCHAR(50) DEFAULT 'SME (<100 Cr)',
  account_type  account_type DEFAULT 'individual',
  
  -- Plan & Credits
  plan          user_plan DEFAULT 'free',
  credits       INTEGER DEFAULT 0,
  credits_used_this_month INTEGER DEFAULT 0,
  
  -- Beta
  is_beta       BOOLEAN DEFAULT FALSE,
  beta_code     VARCHAR(20),
  is_admin      BOOLEAN DEFAULT FALSE,
  
  -- Preferences (JSON)
  preferences   JSONB DEFAULT '{
    "currency": "INR",
    "defaultOH": 15,
    "defaultProfit": 8,
    "homeCity": "",
    "favorites": []
  }'::jsonb,
  
  -- Metadata
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login    TIMESTAMP WITH TIME ZONE,
  email_verified BOOLEAN DEFAULT FALSE,
  is_active     BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_plan ON users(plan);

-- ═══ REFRESH TOKENS ═══
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(500) NOT NULL,
  expires_at  TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  revoked     BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);

-- ═══ INVITE CODES (Beta) ═══
CREATE TABLE invite_codes (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(20) UNIQUE NOT NULL,
  used_by     UUID REFERENCES users(id),
  used_at     TIMESTAMP WITH TIME ZONE,
  is_admin    BOOLEAN DEFAULT FALSE,
  max_uses    INTEGER DEFAULT 1,
  use_count   INTEGER DEFAULT 0,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed beta codes
INSERT INTO invite_codes (code, is_admin, max_uses) VALUES
  ('CLENS-ADMIN', TRUE, 999),
  ('CLENS-7K42', FALSE, 1),
  ('CLENS-3M91', FALSE, 1),
  ('CLENS-4W58', FALSE, 1),
  ('CLENS-2F73', FALSE, 1),
  ('CLENS-6N15', FALSE, 1),
  ('CLENS-9R36', FALSE, 1),
  ('CLENS-8J27', FALSE, 1),
  ('CLENS-1D64', FALSE, 1),
  ('CLENS-5T89', FALSE, 1),
  ('CLENS-0X53', FALSE, 1);

-- ═══ ANALYSIS HISTORY ═══
CREATE TABLE analyses (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module      VARCHAR(50) NOT NULL,
  name        VARCHAR(255),
  result_val  VARCHAR(100),
  total       DECIMAL(12,2),
  
  -- Full result data
  result_data JSONB,
  
  -- Metadata
  credits_used INTEGER DEFAULT 1,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_analyses_user ON analyses(user_id);
CREATE INDEX idx_analyses_module ON analyses(module);
CREATE INDEX idx_analyses_created ON analyses(created_at DESC);

-- ═══ CREDIT TRANSACTIONS ═══
CREATE TABLE credit_transactions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        credit_tx_type NOT NULL,
  amount      INTEGER NOT NULL, -- positive = add, negative = deduct
  balance     INTEGER NOT NULL, -- balance after transaction
  description VARCHAR(500),
  reference   VARCHAR(255), -- payment ID, module name, etc.
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_credit_tx_user ON credit_transactions(user_id);
CREATE INDEX idx_credit_tx_created ON credit_transactions(created_at DESC);

-- ═══ SUBSCRIPTIONS ═══
CREATE TABLE subscriptions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan              user_plan NOT NULL,
  razorpay_sub_id   VARCHAR(255),
  razorpay_plan_id  VARCHAR(255),
  
  -- Billing
  amount            DECIMAL(10,2) NOT NULL,
  currency          VARCHAR(3) DEFAULT 'INR',
  billing_cycle     VARCHAR(10) DEFAULT 'monthly', -- monthly / yearly
  
  -- Status
  status            VARCHAR(20) DEFAULT 'active', -- active, paused, cancelled, expired
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end   TIMESTAMP WITH TIME ZONE,
  
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  cancelled_at      TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);

-- ═══ PAYMENTS ═══
CREATE TABLE payments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id   UUID REFERENCES subscriptions(id),
  
  -- Razorpay
  razorpay_order_id   VARCHAR(255),
  razorpay_payment_id VARCHAR(255),
  razorpay_signature  VARCHAR(500),
  
  -- Amount
  amount            DECIMAL(10,2) NOT NULL,
  currency          VARCHAR(3) DEFAULT 'INR',
  
  -- Type
  type              VARCHAR(20) NOT NULL, -- subscription, topup, one_time
  credits_added     INTEGER DEFAULT 0,
  
  -- Status
  status            payment_status DEFAULT 'created',
  
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_payments_user ON payments(user_id);
CREATE INDEX idx_payments_razorpay ON payments(razorpay_order_id);

-- ═══ USAGE TRACKING ═══
CREATE TABLE usage_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      VARCHAR(50) NOT NULL, -- module_open, ai_extract, report_run, tool_use, smart_action
  detail      VARCHAR(255),
  module      VARCHAR(50),
  
  -- AI usage specifics
  model       VARCHAR(50),
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd    DECIMAL(8,4),
  
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_usage_user ON usage_logs(user_id);
CREATE INDEX idx_usage_action ON usage_logs(action);
CREATE INDEX idx_usage_created ON usage_logs(created_at DESC);

-- ═══ EVENT LOG (Security & Audit) ═══
CREATE TABLE events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  event       event_type NOT NULL,
  email       VARCHAR(255),
  detail      TEXT,
  ip_address  VARCHAR(45),
  user_agent  TEXT,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_events_type ON events(event);
CREATE INDEX idx_events_created ON events(created_at DESC);

-- ═══ NDA SIGNATURES ═══
CREATE TABLE nda_signatures (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signer_name VARCHAR(255) NOT NULL,
  signer_email VARCHAR(255) NOT NULL,
  company     VARCHAR(255),
  designation VARCHAR(255),
  signed_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ip_address  VARCHAR(45),
  nda_version VARCHAR(10) DEFAULT '1.0'
);

-- ═══ FEEDBACK ═══
CREATE TABLE feedback (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feedback_text TEXT NOT NULL,
  credits_awarded INTEGER DEFAULT 0,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ═══ PLANS (pricing config) ═══
CREATE TABLE plans (
  id          VARCHAR(20) PRIMARY KEY,
  name        VARCHAR(50) NOT NULL,
  monthly_price DECIMAL(10,2),
  yearly_price  DECIMAL(10,2),
  credits_per_month INTEGER DEFAULT 0,
  features    JSONB,
  is_active   BOOLEAN DEFAULT TRUE
);

INSERT INTO plans (id, name, monthly_price, yearly_price, credits_per_month, features) VALUES
  ('free', 'Starter', 0, 0, 0, '{"modules": true, "templates": true, "ai": false, "reports": false, "tools": false, "ebooks": false, "commodity": false, "history": 5}'::jsonb),
  ('starter', 'Starter Plus', 499, 4999, 10, '{"modules": true, "templates": true, "ai": true, "reports": false, "tools": true, "ebooks": false, "commodity": false, "history": 20}'::jsonb),
  ('professional', 'Professional', 1999, 19999, 50, '{"modules": true, "templates": true, "ai": true, "reports": true, "tools": true, "ebooks": true, "commodity": true, "history": -1}'::jsonb),
  ('team', 'Team', 4999, 49999, 200, '{"modules": true, "templates": true, "ai": true, "reports": true, "tools": true, "ebooks": true, "commodity": true, "history": -1, "team_size": 5}'::jsonb),
  ('enterprise', 'Enterprise', 0, 0, 999, '{"modules": true, "templates": true, "ai": true, "reports": true, "tools": true, "ebooks": true, "commodity": true, "history": -1, "custom": true}'::jsonb);

-- ═══ CREDIT TOP-UP PACKS ═══
CREATE TABLE topup_packs (
  id          VARCHAR(20) PRIMARY KEY,
  name        VARCHAR(50) NOT NULL,
  credits     INTEGER NOT NULL,
  price       DECIMAL(10,2) NOT NULL,
  is_active   BOOLEAN DEFAULT TRUE
);

INSERT INTO topup_packs (id, name, credits, price) VALUES
  ('pack_10', '10 AI Credits', 10, 299),
  ('pack_20', '20 AI Credits', 20, 499),
  ('pack_50', '50 AI Credits', 50, 999),
  ('pack_100', '100 AI Credits', 100, 1799);

-- ═══ HELPER FUNCTIONS ═══

-- Monthly credit reset function
CREATE OR REPLACE FUNCTION reset_monthly_credits()
RETURNS void AS $$
BEGIN
  UPDATE users
  SET credits = p.credits_per_month,
      credits_used_this_month = 0,
      updated_at = NOW()
  FROM plans p
  WHERE users.plan = p.id::user_plan
    AND users.is_active = TRUE
    AND p.credits_per_month > 0;
  
  INSERT INTO credit_transactions (user_id, type, amount, balance, description)
  SELECT u.id, 'subscription', p.credits_per_month, p.credits_per_month, 'Monthly credit reset'
  FROM users u
  JOIN plans p ON u.plan = p.id::user_plan
  WHERE u.is_active = TRUE AND p.credits_per_month > 0;
END;
$$ LANGUAGE plpgsql;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER payments_updated BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();
