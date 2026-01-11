# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## MANDATORY: Documentation & Tests After Every Task

**THIS IS A REQUIRED STEP - NOT OPTIONAL.** After completing ANY code changes, you MUST:
1. Add or update tests for the modified code
2. Run `npm test` to verify all tests pass
3. Update the relevant documentation files

The task is NOT complete until all three steps are done.

### Required Actions by Change Type

| If you modified... | You MUST update... | You MUST add/update tests in... |
|-------------------|-------------------|--------------------------------|
| Any file in `routes/` | `BACKEND_DEVELOPER_GUIDE.md` + `API_TESTING_GUIDE.md` | `tests/integration/<routeName>.test.js` |
| Any file in `middleware/` | `BACKEND_DEVELOPER_GUIDE.md` (Middleware Reference) | `tests/unit/middleware/<name>.test.js` |
| Any file in `utils/` | `BACKEND_DEVELOPER_GUIDE.md` (Utilities Reference) | `tests/unit/utils/<name>.test.js` |
| Any file in `config/` | `BACKEND_DEVELOPER_GUIDE.md` (Configuration Reference) | Run `npm test` to verify |
| Database schema changes | `CLAUDE.md` (Key Tables) + `BACKEND_DEVELOPER_GUIDE.md` | Update affected integration tests |
| New error codes | `BACKEND_DEVELOPER_GUIDE.md` + `API_TESTING_GUIDE.md` | Test error responses in integration tests |
| `server.js` | `BACKEND_DEVELOPER_GUIDE.md` (Architecture section) | Run `npm test` to verify |

### Test Requirements

| File Type | Test Type | Test Location | What to Test |
|-----------|-----------|---------------|--------------|
| `routes/*.js` | Integration | `tests/integration/` | All endpoints with supertest, auth, validation, error cases |
| `middleware/*.js` | Unit | `tests/unit/middleware/` | Middleware behavior with mocked req/res/next |
| `utils/*.js` | Unit | `tests/unit/utils/` | All exported functions, edge cases, error handling |

### Test Commands
```bash
npm test                 # Run all tests (REQUIRED before task completion)
npm run test:unit        # Run unit tests only
npm run test:integration # Run integration tests only
npx jest tests/unit/utils/myFile.test.js  # Run specific test
```

### Documentation File Locations

**Backend (this directory):**
- `CLAUDE.md` - Key tables, architecture overview, common commands
- `BACKEND_DEVELOPER_GUIDE.md` - Full API reference, schema, middleware, utilities
- `API_TESTING_GUIDE.md` - Postman testing instructions with examples

**Frontend (`/Users/haashimameer/Documents/Apogee/ApogeeHnP/`):**
- `FRONTEND_DEVELOPER_GUIDE.md` - Update if API changes affect frontend consumption
- `README.md` - Update if adding major user-facing features

### What to Add

- **New API route**: Method, URL, auth requirements, request/response examples in BACKEND_DEVELOPER_GUIDE.md + step-by-step Postman test in API_TESTING_GUIDE.md
- **New database table**: Column names, types, constraints, purpose in CLAUDE.md Key Tables + BACKEND_DEVELOPER_GUIDE.md Schema
- **New middleware**: Function signature, purpose, usage example in BACKEND_DEVELOPER_GUIDE.md
- **New utility**: Function signature, parameters, return value, example in BACKEND_DEVELOPER_GUIDE.md

### Enforcement

A hook will remind you after every file edit with:
- `[TEST_UPDATE_NEEDED]` - Which test files to add/update
- `[DOC_UPDATE_NEEDED]` - Which documentation to update

Do NOT ignore these reminders. The task is NOT complete until:
1. Tests are added/updated for the changes
2. `npm test` passes
3. Documentation is updated

---

## Project Overview

ApogeeHnP is a Node.js/Express REST API backend for a health and fitness tracking mobile application. It provides user authentication, workout tracking, AI-powered fitness coaching (via Google Gemini), health data management, and Stripe subscription handling.

## Common Commands

```bash
# Development
npm run dev              # Start with nodemon (auto-reload)
npm start                # Start production server

# Testing
npm test                 # Run all tests (sequential with --runInBand)
npm run test:unit        # Run unit tests only
npm run test:integration # Run integration tests only
npm run test:coverage    # Run tests with coverage report
npm run test:watch       # Run tests in watch mode

# Run a single test file
npx jest tests/unit/utils/token.test.js
npx jest tests/integration/auth-basic.test.js
```

## Architecture

### Entry Point & Startup
`server.js` - Loads Express, applies middleware, mounts routes, then starts listening **before** attempting database connection (Azure-safe approach with 5 retry attempts).

### Key Directories

- **routes/** - API endpoint handlers. Largest files: `authRoutes.js` (authentication), `dataRoutes.js` (40+ CRUD endpoints for health data)
- **middleware/** - `authMiddleware.js` (JWT validation, rate limiting), `mfaMiddleware.js` (MFA enforcement), `validators.js` (express-validator schemas)
- **utils/** - `token.js` (JWT generation), `twilioService.js` (SMS/Email OTP), `queryBuilder.js` (safe SQL construction)
- **config/db.js** - Azure SQL connection pool via `mssql` package

### Database Pattern
Uses `mssql` package with connection pooling. Always use parameterized queries:
```javascript
const pool = getPool();
await pool.request()
  .input('userId', userId)
  .input('email', email.toLowerCase())
  .query('SELECT * FROM dbo.UserLogin WHERE UserID = @userId');
```

### Authentication System
Dual-token JWT architecture:
- Access token: 15-minute expiry, used for API authorization
- Refresh token: 7-day expiry, stored with version number for rotation
- Token type is embedded in payload (`type: 'access'` or `type: 'refresh'`)
- Session invalidation via `TokenInvalidatedAt` timestamp in UserLogin table

### Test Structure
```
tests/
├── unit/           # Isolated unit tests (mocked dependencies)
├── integration/    # API tests with supertest
├── e2e/            # Full flow tests
└── helpers/        # Test utilities, mocks, API client
```

Tests use Jest with 30-second timeout. Database operations are mocked in `tests/helpers/dbMock.js`.

## Key Tables

### Core Tables
- **UserProfile** - Parent table with user data (IDENTITY column)
- **UserLogin** - Auth credentials, FK to UserProfile. Contains RefreshTokenHash, RefreshTokenVersion, TokenInvalidatedAt
- **DailyLogs** - Daily health metrics (sleep, steps, heartrate, water intake)
- **AIWorkoutPlans** - AI-generated workout plans from Gemini
- **UserUsage** - Weekly usage tracking for rate limiting free users

### Rewards & Level System Tables
- **UserRewards** - Tracks user XP, tier, level, and reward progress. Includes CurrentLevel, CurrentTier, LevelUpAt
- **RewardDefinitions** - Defines available rewards with XP values and categories
- **RewardCompletions** - Records of completed/claimed rewards per user
- **PersonalRecords** - User's personal records (PRs) by exercise. Tracks weight/reps with history
- **DailySignIn** - Daily sign-in tracking for XP awards. Unique per user per day
- **UserStreaks** - Streak tracking by type (workout, water, sleep, login). Stores current and longest streaks
- **DailyXPAwards** - Prevents duplicate daily XP awards. Unique constraint on (UserID, AwardType, AwardDate)
- **Achievements** - Badge/achievement definitions with goals and icons
- **UserAchievements** - User progress toward achievements/badges

## Environment Variables

Required in `.env`:
- `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_NAME` - Azure SQL credentials
- `JWT_SECRET` - JWT signing key
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` - OTP service
- `GEMINI_API_KEY` - Google AI API key

## External Documentation

- `API_TESTING_GUIDE.md` - Step-by-step API testing with Postman examples
- `BACKEND_DEVELOPER_GUIDE.md` - Detailed architecture, database schema, security features
