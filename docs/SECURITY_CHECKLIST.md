# Security Checklist (backend)

Legend: ✅ implemented · ⚠️ partial / policy-dependent · ⬜ planned (later phase)

| # | Control | Status | Where |
| --- | --- | --- | --- |
| 1 | Passwords hashed with a strong KDF (scrypt, per-user salt) | ✅ | `src/lib/password.js` |
| 2 | No plaintext passwords stored | ✅ | verified by backend test |
| 3 | No credentials in frontend code | ✅ | admin bootstrap is a CLI only |
| 4 | No public admin registration endpoint | ✅ | only CLI `admin:create` |
| 5 | Server-side credential verification | ✅ | `src/routes/auth.js` |
| 6 | Server-managed sessions (opaque token, hash stored) | ✅ | `src/lib/session.js` |
| 7 | HTTP-only cookie | ✅ | `cookieOptions()` |
| 8 | Secure + SameSite cookies in production | ✅ | `COOKIE_SECURE`, `sameSite=lax` |
| 9 | Session expiration | ✅ | `SESSION_TTL_HOURS`, `expiresAt` |
| 10 | Session revocation (logout / password reset) | ✅ | `revokeSession`, `revokeAllForUser` |
| 11 | Login rate limiting / brute-force lock | ✅ | `src/lib/ratelimit.js` (DB-backed) |
| 12 | Generic login errors (no user enumeration) | ✅ | "Invalid email or password." |
| 13 | CSRF protection on state-changing requests | ✅ | session synchronizer token + anon double-submit (`src/lib/csrf.js`) |
| 14 | Server-side authorisation on every protected route | ✅ | `requireAuth` / `requirePermission` |
| 15 | 401/403 for unauthorised API requests | ✅ | `src/middleware/auth.js` |
| 16 | Permission checks enforced on the backend (not just UI) | ✅ | RBAC in DB; UI hides but never enforces |
| 17 | Input validation | ✅ | zod (`src/lib/validate.js`) |
| 18 | Output encoding | ✅ | `esc()` in `src/lib/render.js` |
| 19 | SQL-injection prevention | ✅ | Prisma parameterised queries (no raw SQL) |
| 20 | Secrets via environment variables; redacted `.env.example` | ✅ | `.env.example` |
| 21 | `.env` / DB files not served over HTTP | ✅ | verified: `/…/.env` → 404 |
| 22 | Security headers (HSTS, nosniff, frame-deny, referrer, permissions) | ✅ | `src/server.js`, `vercel.json` |
| 23 | Safe error handling (no stack traces to clients) | ✅ | central error handler |
| 24 | Audit logging of admin actions | ✅ | `src/lib/audit.js` + `AuditLog` |
| 25 | Password recovery (token, expiry, single-use) | ✅ | `src/routes/auth.js`, `PasswordResetToken` |
| 26 | Timing-resistant login (hash compare even sans user) | ✅ | `attemptLogin` |
| 27 | Account status / soft-disable | ✅ | `User.status`, `deletedAt` |
| 28 | Secure file-upload validation (MIME allowlist, size limit, raw body) | ✅ | `src/lib/content.js`, `src/routes/content.js` |
| 29 | Data retention & deletion procedures | ⚠️ | documented; automated tooling later |
| 30 | Backup & recovery | ⚠️ | documented; provider-level |
| 31 | 2FA / MFA for admins | ⬜ | recommended future hardening |
| 32 | CSP header | ⚠️ | set on static host (`vercel.json`); tighten with nonces later |
| 33 | Public intake rate limiting (20/min per IP) | ✅ | `memoryLimiter` in `src/routes/public.js` |
| 34 | Public form spam honeypot (silent discard) | ✅ | `website` field, `src/routes/public.js` |
| 35 | Public API exposes only published content (drafts hidden) | ✅ | `sitePayload()` filter + backend test |
| 36 | Reports/catalogue analytics read-only and permission-gated (`reports:view`) | ✅ | `src/routes/reports.js` |
| 37 | Integration API key-protected (constant-time compare) + rate-limited | ✅ | `src/routes/integrations.js`, `SHEETS_SYNC_KEY` |

## Known gaps to close before a real launch
- Enable MFA for super admins (not built).
- Move media uploads to object storage (S3/R2) — serverless filesystems are ephemeral.
- Replace logging of reset links with a real mail provider (`SMTP_URL`).
- Add automated backups + a tested restore drill on the managed database.
- Run an external penetration test and an accessibility audit.
