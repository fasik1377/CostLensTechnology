# CostLens — Developer Quick Start

## What is this?
AI-powered procurement costing platform for Indian manufacturing. Single-page React app deployed as static HTML on Firebase.

## Files You Need
| File | What it is |
|------|-----------|
| `costlens-final.jsx` | Source code (5,606 lines) — edit this |
| `costlens-final.html` | Deployed file (622 KB) — built from JSX |
| `rebuild5.mjs` | Build script — converts JSX → HTML |

## First-Time Setup (5 minutes)

```bash
# 1. Install Node.js (if not already)
# Download from https://nodejs.org

# 2. Install Firebase CLI
npm install -g firebase-tools

# 3. Login to Firebase
firebase login

# 4. Clone/copy the project folder structure:
# C:\Users\DELL\costlens\
#   ├── firebase.json
#   ├── y\
#   │   └── index.html    ← this is costlens-final.html
#   └── rebuild5.mjs
```

## Deploy (Every Time)

```bash
# 1. Build HTML from JSX
node rebuild5.mjs

# 2. Set API key in the HTML
#    Open costlens-final.html → Find "YOUR-API-KEY-HERE" (line 18)
#    Replace with your Anthropic API key (sk-ant-api03-...)

# 3. Copy to Firebase folder
copy costlens-final.html C:\Users\DELL\costlens\y\index.html

# 4. Deploy
cd C:\Users\DELL\costlens
firebase deploy

# 5. Test
# Open https://costlens.technology
# Login with admin code: CLENS-ADMIN
```

## Architecture (Simple Version)

```
Browser (React + Babel) ──→ Anthropic Claude API (AI)
         │
         └──→ localStorage (all user data)
         │
Firebase Hosting (serves the single HTML file)
```

- NO backend server
- NO database
- ALL data in browser localStorage
- API key is embedded in HTML (line 18)

## Key Configuration (Line Numbers in JSX)

| Line | What | Example |
|------|------|---------|
| 3-8 | Beta config | enabled, dates, admin email |
| 10-11 | 10 invite codes | CLENS-7K42, CLENS-3M91, etc. |
| 12 | Admin code | CLENS-ADMIN |
| 18 | API key | YOUR-API-KEY-HERE |
| 60-75 | Module/Report/Tool definitions | MODS, REPORTS, AI_TOOLS |

## What Each AI Model Does

| Model | Used For | Why |
|-------|----------|-----|
| claude-opus-4-6 | Document extraction, Reports, Commercial Tools | Best quality |
| claude-sonnet-4-5-20250929 | Fallback if Opus fails | Available on all plans |
| claude-sonnet-4-20250514 | Smart Actions, Commodity Intel | Fast, uses web search |

## 4 Custom Modules (have their own components)

1. **ShouldCostModule** — Zero-based component costing from drawings
2. **ToolCostModule** — Die/mould/fixture costing with 18 templates
3. **PackagingCostModule** — Box deckle area → cost per piece
4. **TransportCostModule** — Route-based freight with 50+ Indian routes

## 10 Generic Modules (driven by MCFG config)

landed, inventory, capex, make-buy, epc, tco, cbs, commodity, vave, spend

## localStorage Keys

| Key | Data |
|-----|------|
| cl-session | Current logged-in user |
| cl-users | All registered users |
| cl-history-{email} | Analysis history (max 50) |
| cl-prefs-{email} | User preferences & favorites |
| cl-beta-used-codes | Code → email mapping |
| cl-beta-events | Event log (max 500) |
| cl-theme | dark / light |

## Common Tasks

### Add a new invite code
Edit BETA_CODES array (line ~10) → add new "CLENS-XXXX" string

### Change beta duration
Edit BETA_CONFIG.durationDays (line ~5)

### Add a new costing module
1. Add to MODS array (line ~60)
2. Add MCFG config (line ~260) with fields, cols, calcFn, prompt, templates
3. Generic modules auto-render via GenericModule component

### Update diesel rate
Edit DIESEL_RATE constant (line ~1018)

### Add a new Indian route
Add to ROUTE_DB object (line ~1020): "City1→City2":{km:XXX,tolls:XXXX}

### Update corrugated box rates
Edit rate guides in PackagingCostModule (3-ply ₹14-18, 5-ply ₹24-32, 7-ply ₹38-48)

## Production Migration Checklist

- [ ] Move API key to backend server (Express/Next.js API route)
- [ ] Replace localStorage with PostgreSQL/Firebase Firestore
- [ ] Add real authentication (Firebase Auth, JWT)
- [ ] Hash passwords (currently plain text in localStorage)
- [ ] Add payment gateway (Razorpay) for subscriptions
- [ ] Split 5,606-line JSX into modules (Vite + React Router)
- [ ] Add server-side PDF generation
- [ ] Add rate limiting on API proxy
- [ ] Add usage analytics (Mixpanel/Amplitude)
- [ ] Set up CI/CD pipeline

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| API 400: credit balance too low | No Anthropic API credits | Add credits at console.anthropic.com → Billing |
| API 401: Invalid authentication | Bad API key | Re-copy key, check no extra spaces |
| API 400 (model error) | Opus not available on plan | Fallback to Sonnet handles this automatically |
| Module shows empty tables | AI failed silently | Fixed — now stays on input step with error message |
| Auth popup disappears | Browser autofill issue | Fixed — uses onMouseDown with target check |
| Users see others' history | localStorage shared | Fixed — history isolated per email |

## Contact
- Platform: https://costlens.technology
- Email: founder@costlens.technology
