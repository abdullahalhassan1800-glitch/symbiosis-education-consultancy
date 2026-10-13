# Security & Privacy Findings

Scope: the static front end delivered here, plus an optional persistent-backend path.

## 1. What the delivered site does (verified)

- **No backend, no database, no secrets.** Nothing is stored server-side.
- **No credentials or API keys** in client code or bundles (the site contains none).
- **Booking is a WhatsApp deep link.** Form values are validated client-side and URL-encoded into `wa.me/<number>?text=…`; they are then transmitted by the user's own WhatsApp client, not by this site.
- **No third-party scripts** (GSAP/Lenis/three.js were removed from the reference). Fonts come from Google Fonts over HTTPS; images are local.
- **Outbound links** use `rel="noopener"` on new-tab targets.
- **Data minimisation:** the form asks only for counselling-relevant details (name, phone, qualification, course interest, optional NEET score, city, meeting mode, notes). No payment data, no government IDs, no medical records.

## 2. Risks & mitigations (delivered build)

| Risk | Mitigation |
| --- | --- |
| PII in a URL | PII appears only in the message text the user sends to the business; it is not logged by the site. Advise the owner not to publish message logs. |
| Spam / abuse | No server surface to spam. If a backend is added, add rate limiting + spam protection (below). |
| XSS via injected strings | All dataset strings are escaped (`esc()`) before insertion; no `innerHTML` from user input. |
| Duplicate booking submissions | The form guards repeated submits in-session (`submitted` flag). A true backend would need idempotency keys. |
| Placeholder legal text | `privacy.html` / `terms.html` contain `[bracketed]` placeholders that **must** be completed by the owner. |

## 3. HTTPS, headers, deployment

- Host over HTTPS only (Vercel provides TLS automatically; or configure on the host).
- Recommended security headers (configure at the host / `vercel.json`):
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'`
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(), camera=(), microphone=()`
- Keep dependencies at zero to minimise supply-chain surface. Run `npm audit` if any are added.

## 4. Optional persistent booking backend (recommended path — NOT yet built)

If the owner wants stored, de-duplicated bookings with references and statuses:

**API (serverless, e.g. Vercel Functions)**
- `POST /api/bookings` — validate with Zod (`name`, `phone`, `course`, `scheduledAt` ISO + `timezone`, `meetingType`, optional note), reject unknown fields, verify the slot is in the future and within business hours, enforce server-side only.
- `GET/PATCH /api/bookings/:ref` — admin-only status changes.

**Database (PostgreSQL, e.g. Neon/Supabase). Suggested schema:**

```
appointments(id, booking_reference UNIQUE, student_name, contact_number,
             course_id, scheduled_at timestamptz, timezone, meeting_type,
             status, created_at, ip_hash)   -- status: pending|confirmed|cancelled|completed
leads(id, source, course_interest, contact_details, consent_status,
      assigned_staff, status, created_at)
courses(id, name, category, institution_id, duration, eligibility,
        tuition_fee, currency, country, academic_year, status, last_verified_at)
institutions(id, name, country, city, official_website, recognition_details, verification_status)
staff(id, name, role, auth_reference)
```

**Controls**
- Server-side validation + rate limiting (per IP + per phone) + a spam check.
- Unique constraint on `booking_reference`; unique partial index on `(scheduled_at)` where status in ('pending','confirmed') to prevent double-booking if exclusive slots are required.
- **Authorisation enforced on the server**, never via hidden front-end controls. Admin routes require authentication + role checks.
- Secrets (`DATABASE_URL`, notification keys) live in host environment variables only — **never** in client code.
- Notification service (email / WhatsApp Business API) optional; failures must not lose the booking.
- Backups + a documented restore procedure; data-retention and deletion on request.

**Privacy:** publish a retention period, obtain consent for contact, and never store more than necessary. Do not use production student records in testing.

## 5. Compliance notes

- This is guidance on Indian (DPDP Act) and general best practice, not legal advice. The owner should have `privacy.html` / `terms.html` reviewed before launch.
- Do not assert recognition/affiliation claims the business cannot evidence; verify NMC/PCI/UGC/WHO status at the time of admission.
