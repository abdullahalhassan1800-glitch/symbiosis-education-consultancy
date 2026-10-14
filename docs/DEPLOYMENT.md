# Deployment

Three options. A and B host the **public website** only (static). C hosts the
**full app** — website + `/admin` + `/api` — which is what you need to use the
admin panel online.

---

## Option C — Vercel + Neon (full app — website + admin + API)  ← recommended

The website is static files; the admin panel and API are an Express app talking
to a PostgreSQL database. Vercel runs the app as a serverless function and Neon
provides the free PostgreSQL database.

### 0. Prerequisites
- A GitHub repo containing this project (already set up).
- A free [Neon](https://neon.tech) account.
- A free [Vercel](https://vercel.com) account (sign in with GitHub).

### 1. Create the database (Neon)
1. Neon → **New Project**. Pick a region close to your users.
2. Open **Connection Details** and copy **two** strings:
   - **Pooled connection** (host contains `-pooler`) → used by the app at runtime.
   - **Direct connection** → used once, to create the tables.

### 2. Create the tables (run once, from your computer)
Use the **direct** connection string:

```powershell
$env:DATABASE_URL = "postgresql://...@ep-xxx.aws.neon.tech/neondb?sslmode=require"
npm run db:push:prod
```

This builds `prisma/schema.postgres.prisma` from `prisma/schema.prisma` and
pushes the schema to Neon (no migration files needed for a fresh database).

### 3. Create the first super admin (run once, from your computer)
Still with the direct `DATABASE_URL` set:

```powershell
$env:ADMIN_EMAIL    = "you@example.com"
$env:ADMIN_PASSWORD = "a-strong-password"
$env:ADMIN_NAME     = "Your Name"
node scripts/create-admin.js
```

### 4. Deploy on Vercel
1. <https://vercel.com/new> → **Import** the GitHub repo.
2. Framework preset: **Other**. Leave build/output settings at their defaults —
   `vercel.json` already sets `buildCommand` (generates the Prisma client).
3. Add **Environment Variables** (Production):

   | Variable | Value | Notes |
   |---|---|---|
   | `DATABASE_URL` | Neon **pooled** URL + `&pgbouncer=true&connection_limit=1` | required |
   | `APP_ORIGIN` | `https://<your-project>.vercel.app` | required for links |
   | `NODE_ENV` | `production` | Vercel sets this automatically |
   | `COOKIE_SECURE` | `1` | default is already `1` in production |
   | `SESSION_COOKIE_NAME` | `sym_admin_sid` | optional |
   | `SESSION_TTL_HOURS` | `12` | optional |
   | `SHEETS_SYNC_KEY` | long random string | optional (integration API) |
   | `SHEETS_WEBHOOK_URL` | Apps Script `/exec` URL | optional (push to Sheets) |
   | `GOOGLE_SHEETS_ID` + `GOOGLE_SERVICE_ACCOUNT_JSON` | — | optional (Sheets API mode) |

4. **Deploy**. When it finishes, open `https://<your-project>.vercel.app/admin/login`
   and sign in with the account from step 3.

### Notes / limitations on Vercel
- **File uploads** (admin → Media) don't persist: the serverless filesystem is
  read-only/ephemeral. Use **“Add by URL”** instead; binary upload returns
  `503 storage_unavailable`.
- Always use the **pooled** Neon URL at runtime; use the **direct** URL only for
  `db:push:prod` / `create-admin`.
- The site's forms post to `/api/public/*`, which now works on Vercel, so leads
  are stored in Neon **and** pushed to Google Sheets (if configured).
- Rotate `SHEETS_SYNC_KEY` and the admin password before going live.

### Changing the schema later
`prisma/schema.postgres.prisma` is generated on each build — never edit it.
Edit `prisma/schema.prisma`, then re-run `npm run db:push:prod` against Neon.

---

## Option A — Vercel (static website only)

1. Put this folder in a Git repo and import it at <https://vercel.com/new>.
2. Framework preset: **Other**. Build command: *(none)*. Output directory: `.`.
3. No environment variables are required for the static build.
4. Recommended headers (already applied by the root `vercel.json`).

> Do **not** use Option A for the admin panel — it needs the database (Option C).

## Option B — any static host (Netlify, GitHub Pages, Nginx, S3+CloudFront)

Upload the repository contents as-is. Ensure:
- 404 handling points at `404.html`.
- HTTPS is enabled.
- Long cache on `assets/*`, short cache on `*.html`.

---

## Local preview

```bash
npm start          # http://localhost:4173  (website + admin + api)
# or, static only:
npm run static     # http://localhost:4174
```

## Pre-launch checklist

- [ ] Run `npm test` (expect all suites green).
- [ ] Complete the `[bracketed]` placeholders in `privacy.html` and `terms.html`.
- [ ] Confirm the phone/WhatsApp numbers and Instagram handle are current.
- [ ] Verify all course fees and NMC/PCI/UGC/WHO recognition claims with the institutions.
- [ ] Optimise the hero image to WebP/AVIF (< 250 KB).
- [ ] Run Lighthouse / axe and record results.
- [ ] Do **not** deploy over the live reference without explicit owner authorisation.
