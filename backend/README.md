# CostLens Backend — API Server

## Quick Start (5 minutes)

```bash
# 1. Clone and install
cd costlens-backend
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set DB_PASSWORD, JWT_SECRET, ANTHROPIC_API_KEY, RAZORPAY keys

# 3. Start PostgreSQL (using Docker)
docker-compose up db -d

# 4. Initialize database
npm run db:init

# 5. Start server
npm run dev    # development (auto-restart)
npm start      # production
```

Server runs at `http://localhost:4000`

## Using Docker (Full Stack)

```bash
# Set your API keys in environment
export ANTHROPIC_API_KEY=sk-ant-api03-...
export RAZORPAY_KEY_ID=rzp_test_...
export RAZORPAY_KEY_SECRET=...

# Start everything
docker-compose up --build
```

## API Endpoints

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | No | Register (name, email, password, inviteCode) |
| POST | `/api/auth/login` | No | Login (email, password) → tokens |
| POST | `/api/auth/refresh` | No | Refresh access token |
| POST | `/api/auth/logout` | Yes | Revoke all refresh tokens |
| GET | `/api/auth/me` | Yes | Get current user profile |

### Users
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| PUT | `/api/users/profile` | Yes | Update profile (name, company, etc.) |
| PUT | `/api/users/preferences` | Yes | Update preferences (favorites, defaults) |
| GET | `/api/users/history` | Yes | Get analysis history |
| POST | `/api/users/history` | Yes | Save analysis result |
| DELETE | `/api/users/history/:id` | Yes | Delete analysis |
| GET | `/api/users/credits` | Yes | Get credit balance + transactions |
| POST | `/api/users/feedback` | Yes | Submit beta feedback (earn 25 credits) |
| GET | `/api/users/stats` | Yes | Get usage statistics |

### AI Proxy (API key secured server-side)
| Method | Endpoint | Auth | Credits | Description |
|--------|----------|------|---------|-------------|
| POST | `/api/ai/extract` | Yes | 1+ | Main AI extraction (Opus → Sonnet fallback) |
| POST | `/api/ai/action` | Yes | 0 | Smart actions (Sonnet — no credit cost) |
| POST | `/api/ai/commodity` | Yes | 1 | Commodity intelligence (web search) |
| POST | `/api/ai/report` | Yes | 3-5 | AI analysis reports (Opus → Sonnet fallback) |

### Payments (Razorpay)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/payments/plans` | No | List subscription plans |
| GET | `/api/payments/topup-packs` | No | List credit top-up packs |
| POST | `/api/payments/subscribe` | Yes | Create subscription order |
| POST | `/api/payments/topup` | Yes | Create top-up order |
| POST | `/api/payments/verify` | Yes | Verify Razorpay payment |
| POST | `/api/payments/webhook` | No | Razorpay webhook handler |
| GET | `/api/payments/history` | Yes | Payment history |

### Admin (admin only)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/admin/stats` | Admin | Dashboard statistics |
| GET | `/api/admin/users` | Admin | List all users |
| GET | `/api/admin/codes` | Admin | List invite codes |
| POST | `/api/admin/codes` | Admin | Create new invite code |
| GET | `/api/admin/events` | Admin | Security event log |
| POST | `/api/admin/grant-credits` | Admin | Grant credits to user |
| GET | `/api/admin/usage` | Admin | AI usage analytics |
| GET | `/api/admin/feedback` | Admin | All feedback submissions |

### Analytics
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/analytics/my-usage` | Yes | User's own usage analytics |

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server health check |

## Database Schema

13 tables — see `sql/schema.sql` for full DDL:

| Table | Purpose |
|-------|---------|
| users | User accounts, plans, credits |
| refresh_tokens | JWT refresh token storage |
| invite_codes | Beta invite codes (single-use) |
| analyses | Saved analysis history |
| credit_transactions | Credit ledger (add/deduct/bonus) |
| subscriptions | Active subscriptions |
| payments | Razorpay payment records |
| usage_logs | AI usage tracking (tokens, model, cost) |
| events | Security & audit log |
| nda_signatures | Digital NDA records |
| feedback | Beta feedback |
| plans | Pricing plans config |
| topup_packs | Credit top-up packs |

## Frontend Integration

The frontend needs to change from direct Anthropic API calls to backend API calls:

```javascript
// BEFORE (beta — direct browser → Anthropic)
const r = await fetch("https://api.anthropic.com/v1/messages", {
  headers: { "x-api-key": "sk-ant-..." },
  body: JSON.stringify({ model: "claude-opus-4-6", messages })
});

// AFTER (production — browser → your backend → Anthropic)
const r = await fetch("https://api.costlens.technology/api/ai/extract", {
  headers: { "Authorization": "Bearer " + accessToken },
  body: JSON.stringify({ messages, creditsToUse: 1 })
});
```

Key changes for frontend:
1. Replace all `apiFetch("https://api.anthropic.com/...")` with backend endpoints
2. Replace localStorage auth with JWT token management
3. Replace localStorage data with API calls (`/api/users/history`, etc.)
4. Add Razorpay checkout script for payments
5. Remove `API_HEADERS` constant — backend holds the API key

## Environment Variables

See `.env.example` for all variables. Critical ones:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — min 32 chars, keep secret
- `ANTHROPIC_API_KEY` — your sk-ant-... key (NEVER expose to frontend)
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — from Razorpay dashboard

## Deployment

### Railway / Render / Fly.io
1. Push to GitHub
2. Connect repo to hosting platform
3. Set environment variables
4. Add PostgreSQL addon
5. Run `npm run db:init` once
6. Deploy

### AWS / DigitalOcean
1. Set up EC2/Droplet with Node 20 + PostgreSQL 15
2. Clone repo, `npm install`
3. Configure `.env`
4. Run `npm run db:init`
5. Use PM2: `pm2 start src/server.js --name costlens-api`
6. Set up Nginx reverse proxy + SSL (Let's Encrypt)

## Security Notes

- API key is ONLY on the server — never sent to browser
- Passwords hashed with bcrypt (12 rounds)
- JWT tokens with configurable expiry
- Rate limiting on all routes (stricter on AI)
- CORS restricted to frontend domain
- Helmet security headers
- Input validation on all endpoints
- SQL injection prevention via parameterized queries
