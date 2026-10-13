# Backend & Admin Setup

This project is a static public website **plus** a secure server-side admin
backend (authentication, RBAC, CRM, CMS) backed by Prisma.

- Public site: `index.html`, `css/`, `js/app.js`, `js/data.js`, `assets/`
- Backend: `src/` (Express), `prisma/` (schema + migrations), `api/index.js` (Vercel)
- Admin console: `/admin` (server-rendered) + `/api/admin/*` (JSON)

## 1. Install

```bash
npm install
```

## 2. Configure environment

```bash
copy .env.example .env      # Windows
# cp .env.example .env      # macOS/Linux
```

Edit `.env`. Never commit it (it is git-ignored). Key variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | `file:./dev.db` locally; a PostgreSQL URL in production |
| `NODE_ENV` | `development` / `production` |
| `APP_ORIGIN` | Public origin, used to build password-reset links |
| `SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS` | Session cookie + lifetime |
| `COOKIE_SECURE` | `1` in production (HTTPS only) |
| `LOGIN_MAX_FAILURES`, `LOGIN_WINDOW_MINUTES` | Brute-force thresholds |
| `SMTP_URL`, `MAIL_FROM` | Optional; without it reset links are logged to the server console |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Only for non-interactive `admin:create` |

## 3. Create the database & roles

```bash
npm run db:migrate     # create/upgrade the schema (dev)
npm run db:seed        # seed permissions, roles, default availability slots
npm run db:import      # import the verified dataset (settings, FAQs, clean countries)
```

`db:import` copies the **verified** content from `js/data.js` — the contact
settings, the FAQs and any clean single-country names — into the database. It
never fabricates data: grouped country labels (e.g. "Russia, Ukraine & India")
are skipped, and **courses are not imported** (the public site keeps the
verified static course dataset; the DB course model does not yet carry the
dataset's points/total/source fields). The script is idempotent — re-running it
adds nothing new.

## 4. Create the first super administrator

There is **no public admin signup**. Bootstrap the first account from the
server CLI (the password is hashed; it is never printed or stored in plaintext):

```bash
npm run admin:create                 # interactive (hidden password prompt)
# or non-interactive:
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='A-strong-passw0rd' ADMIN_NAME="Your Name" npm run admin:create
# reset an existing account's password:
npm run admin:create -- --force
```

Password policy: ≥ 10 chars with upper & lower case and a number.

## 5. Run

```bash
npm start        # http://localhost:4173  (site + /admin + /api)
npm run db:studio  # browse the database
```

Sign in at <http://localhost:4173/admin/login>.

## 6. Tests

```bash
npm test             # frontend (25) + backend (69)
npm run test:backend # spinning up an isolated SQLite test DB
```

## 6b. Staff & Roles module

Once signed in as a super administrator, **Administration → Staff & Roles**
(`/admin/staff`) lets you manage who can access the console:

- **Staff list** — search/filter by name, email, role and status.
- **Add staff** — set name, email, role and a temporary password; the user must
  change it on first sign-in. Passwords are hashed (scrypt) and policy-checked.
- **Manage** — edit profile/role/status, reset password (revokes every session),
  disable/enable, or soft-delete an account.
- **Roles & permissions** (`/admin/roles`) — view the permission matrix per role
  and toggle permissions. The system roles (Super Admin, Admin, Counsellor,
  Content Manager) and any custom roles are editable except **Super Admin**,
  which always holds every permission.

Safety rules enforced server-side (not just hidden in the UI): you cannot
disable/delete your own account, and the **last active super administrator**
cannot be removed, disabled or demoted.

JSON API: `GET/POST /api/admin/staff`, `PATCH/DELETE /api/admin/staff/:id`,
`POST /api/admin/staff/:id/status`, `GET /api/admin/roles`, `GET /api/admin/permissions`.

## 6c. Catalogue module

The public site's programmes are managed from **Catalogue** in the sidebar:

- **Courses** (`/admin/courses`) — create/edit courses (fees, eligibility,
  duration, source URL, university, country, category), search & filter by
  status/university/featured, publish/unpublish, soft-delete. Each course page
  also manages its **fee records**.
- **Universities** (`/admin/universities`) — institutions with country, city,
  website, recognition and a verified/unverified/pending verification state.
- **Countries** (`/admin/countries`) — study destinations with overview, living
  cost, visa & admission guidance and official links.
- **Fees & Eligibility** (`/admin/fees`) — every fee record across courses; edits
  are versioned (`FeeChange`) with a change-history view per record.

Publishing a course needs the `courses:publish` permission (separate from
`courses:write`). CSV **export** is available for each entity
(`/admin/<entity>/export.csv`) and **import** at `/admin/<entity>/import` (pick a
file or paste CSV; rows are matched by name/slug). Fees and courses reference
their university/country by name/slug during import.

JSON API: `GET/POST /api/admin/courses`, `PATCH/DELETE /api/admin/courses/:id`,
`POST /api/admin/courses/:id/publish`, `GET/POST /api/admin/countries`,
`PATCH/DELETE /api/admin/countries/:id`, `GET/POST /api/admin/institutions`,
`PATCH/DELETE /api/admin/institutions/:id`, `GET /api/admin/fees`.

## 6d. CRM module

- **Student Leads** (`/admin/leads`) — pipeline with statuses
  (new → contacted → qualified → counselling_scheduled → follow_up →
  converted / not_interested / closed), source & assignment filters, search.
  Each lead has an **activity timeline** (notes, calls, follow-ups and automatic
  status-change entries). Assigning a lead needs `leads:assign`; writing needs
  `leads:write`. Delete is soft.
- **Appointments** (`/admin/appointments`) — book/manage consultations
  (call/video/in-person/WhatsApp), link to a lead, assign staff, filter by
  status/date range, and change status (confirmed/completed/cancelled/no-show).
  The same page manages **weekly availability slots** (add/enable/disable/delete).
- **Contact Enquiries** (`/admin/enquiries`) — the website contact form inbox:
  status workflow (new/contacted/resolved/spam), assignment and internal notes.

> Public intake is wired in the CMS phase (Phase 5) — see 6e.

JSON API: `GET/POST /api/admin/leads`, `GET/PATCH/DELETE /api/admin/leads/:id`,
`POST /api/admin/leads/:id/status`, `POST /api/admin/leads/:id/assign`,
`GET/POST /api/admin/appointments`, `PATCH /api/admin/appointments/:id`,
`POST /api/admin/appointments/:id/status`, `GET/POST /api/admin/availability`,
`GET /api/admin/enquiries`, `GET/PATCH /api/admin/enquiries/:id`.

## 6e. Website CMS & public site

The public website hydrates from a single read-only endpoint and the contact /
booking forms post to public intake endpoints — all available **without
authentication**, rate-limited and honeypot-protected.

Public API:

- `GET /api/public/site` — one JSON payload of everything the site renders
  (published courses, published FAQs, content entries, settings, availability),
  with a short cache header. The frontend falls back to its bundled static data
  if this call fails, so the site works even with no backend.
- `GET /api/public/availability` — active weekly consultation slots.
- `POST /api/public/leads`, `POST /api/public/enquiries`,
  `POST /api/public/appointments` — the website's "book a free counselling"
  and "enquire" forms. Each is capped at 20 requests/minute per IP; a hidden
  `website` honeypot field silently accepts and discards bot submissions.
  Appointments additionally create/link a lead by phone (`counselling_scheduled`).

Admin CMS (**Administration → Website** in the sidebar):

- **Content pages** (`/admin/content`) — editable website content entries keyed by
  a stable `key` (e.g. hero copy, announcements) with type, status and full
  revision history (`ContentRevision`); publish/unpublish/delete.
- **FAQs** (`/admin/faqs`) — create/edit/publish and reorder FAQs.
- **Media** (`/admin/media`) — register an asset **by URL**, or upload a file.
  Uploads accept a MIME allowlist and are sent as a **raw request body** (no
  `multipart/form-data`, so no `multer`/`busboy` dependency); a no-JS browser
  submit is rejected with a clear error. On read-only/serverless filesystems the
  binary upload returns `503 storage_unavailable` — use **Add by URL** there.
- **Settings** (`/admin/settings`) — verified business details (contact, social,
  session, etc.) exposed through the public payload.

JSON API: `GET/POST /api/admin/content`, `PATCH/DELETE /api/admin/content/:id`,
`POST /api/admin/content/:id/publish`, `/unpublish`, `GET /api/admin/content/:id/revisions`,
`GET/POST /api/admin/faqs`, `PATCH/DELETE /api/admin/faqs/:id`,
`POST /api/admin/faqs/:id/move`, `GET/POST /api/admin/media`,
`POST /api/admin/media/upload`, `DELETE /api/admin/media/:id`,
`GET/PUT /api/admin/settings`.

## 6f. Reports module

**Administration → Reports** (`/admin/reports`) is a read-only analytics view
gated by the `reports:view` permission (Admin and Super Admin; Counsellor and
Content Manager are forbidden). Every figure is computed live — empty tables
show 0, never a placeholder.

- **Date range** — `?from=YYYY-MM-DD&to=YYYY-MM-DD` (UTC, inclusive; defaults to
  the last 30 days). CSV export honours the same range.
- **Panels** — leads (total, by status, by source, daily series), appointments
  (total, by status, upcoming), enquiries (by status), the catalogue
  (courses by status, institutions, countries) and an all-time **conversion
  funnel** (new → contacted → qualified → counselling_scheduled → converted)
  with a period conversion rate.

JSON API: `GET /api/admin/reports` (same range parameters).
CSV: `GET /admin/reports/export.csv`.

## 6g. Overseas MBBS & external sync

**Catalogue → Overseas MBBS** (`/admin/overseas`) is a read-only convenience
view over the courses whose `category` is `overseas`, grouped by destination
country. It needs only `courses:read`; editing happens under **Courses**. JSON
API: `GET /api/admin/overseas`.

**Read-only integration API** (for a Google Sheets sync, scripts, etc.) — key
protected by the `x-api-key` header (env `SHEETS_SYNC_KEY`):

- `GET /api/integrations/records` — leads, appointments and enquiries as JSON
  (`?since=<ISO>` returns only rows changed after that time; max 5000/entity).
- `GET /api/integrations/ping` — key/health check, no data.

If `SHEETS_SYNC_KEY` is unset the endpoints return `503 not_configured`; a
missing/incorrect key returns `401`. Rate-limited to 120 req/min per IP. See
[`docs/GOOGLE_SHEETS_SYNC.md`](./GOOGLE_SHEETS_SYNC.md) for the Apps Script and
step-by-step setup.

**Realtime push to Google Sheets (optional)** — set `SHEETS_WEBHOOK_URL` to a
Google Apps Script web-app (`/exec`) URL and every new website lead,
appointment and enquiry is POSTed there immediately, appending a row to the
spreadsheet. It runs fire-and-forget (5s timeout, never blocks or fails a
visitor request) and is a no-op when the URL is unset. Script:
[`docs/google-sheets-webhook.gs`](./google-sheets-webhook.gs).

## 7. Switching to PostgreSQL for production

The schema is kept portable (no enums/Json/arrays; money as integers).

1. Provision PostgreSQL (Neon, Supabase, RDS, …) and copy its connection string.
2. In `prisma/schema.prisma`, set `provider = "postgresql"`.
3. In `.env` (prod), set `DATABASE_URL="postgresql://…"`, `NODE_ENV=production`,
   `COOKIE_SECURE=1`, and a strong `SESSION_*` config.
4. Delete the SQLite migrations and regenerate for Postgres:
   ```bash
   rm -rf prisma/migrations prisma/*.db
   npx prisma migrate dev --name init   # in a fresh Postgres database
   ```
5. Run `npm run db:seed` and `npm run admin:create` against production.

> SQLite has no place in serverless production (ephemeral filesystem). A managed
> PostgreSQL is required there.

## 8. Deploy to Vercel

`vercel.json` rewrites `/admin/*` and `/api/*` to the `api/index.js` function
and sets security headers. Set the production environment variables in the
Vercel dashboard (never in the repo), point `DATABASE_URL` at PostgreSQL, then:

```bash
vercel --prod
```

Run migrations against production with `npm run db:deploy`
(`prisma migrate deploy`).

## 9. Recovering admin access

- Forgotten password (SMTP configured): use **Forgot password** on the login
  page.
- Forgotten password (no SMTP): reset links are printed to the server console.
- Locked out entirely: run `npm run admin:create -- --force` on the server to
  reset the super-admin password.

## Known limitations (current)

- Implemented: **auth/RBAC/admin shell**, **Staff & Roles**, the **Catalogue**
  (courses, universities, countries, fees, overseas MBBS view), the **CRM**
  (leads, appointments + availability, enquiries), the **Website CMS** (content,
  FAQs, media, settings), **Reports** and the **read-only integration API**
  (Google Sheets sync). All admin modules are complete.
- The public site hydrates from `GET /api/public/site` and falls back to the
  bundled `js/data.js` if the backend is unreachable, so it works offline.
- Media **binary** uploads need a writable filesystem (local/PM2/Docker); on
  serverless/ephemeral hosts use **Add by URL** (the upload route returns
  `503 storage_unavailable`). Move to object storage (S3/R2) for production.
- Login rate limiting is DB-backed (shared across instances); the coarse
  request limiter is per-instance in memory.
- Email delivery is a seam (`src/lib/mail.js`) — wire a provider via `SMTP_URL`.
- The Google Sheets sync can run **either way**: the pull script fetches records
  on a schedule, or `SHEETS_WEBHOOK_URL` pushes each new record in real time.
  Both are one-way (website → sheet) and read-only. Keep `SHEETS_SYNC_KEY` secret.
