# Google Sheets sync (automatic CRM records)

Mirror the CRM — **Leads**, **Appointments** and **Contact Enquiries** — into a
Google Sheet automatically. There are two ways to do it, and both are
**one-way** (website → sheet); neither changes your data.

| Approach | How it works | When to use |
| --- | --- | --- |
| **Push (realtime)** | The backend POSTs each new record to a Google Apps Script web app, which appends a row. | Simplest; records appear instantly. |
| **Pull (scheduled)** | A script in the Sheet fetches all records from the backend every 15 minutes. | Also syncs edits/status changes made in the admin. |

You can use either, or both. Most people start with **push**.

---

## Part A — Push (realtime, recommended)

New website leads, appointments and enquiries are POSTed to a Google Apps Script
web app as soon as they are stored, so the spreadsheet fills in live.

### 1. Deploy the web app

1. Open your Google Sheet → **Extensions → Apps Script**.
2. Replace `Code.gs` with the contents of
   [`docs/google-sheets-webhook.gs`](./google-sheets-webhook.gs). Save.
3. **Project Settings (⚙) → Script properties → Add**:
   - `WEBHOOK_KEY` = the same value as `SHEETS_SYNC_KEY` below.
4. **Deploy → New deployment → Web app**:
   - **Execute as:** Me
   - **Who has access:** **Anyone**
   - Copy the **`/exec` URL**.
5. Open the `/exec` URL in a browser — you should see
   `{"ok":true,"service":"symbiosis-sheets-webhook",...}`. (A `403` means the
   access setting is not *Anyone*.)

### 2. Point the backend at it

```bash
# .env
SHEETS_WEBHOOK_URL="https://script.google.com/macros/s/XXXX/exec"
SHEETS_SYNC_KEY="paste-a-long-random-string-here"   # must equal WEBHOOK_KEY
```

Restart the server. Submit the website enquiry/pop-up form and watch the row
appear. The integration is **fire-and-forget**: a 5s timeout, it never blocks or
fails a visitor's request, and it is a no-op if `SHEETS_WEBHOOK_URL` is unset.

> Google Apps Script does not expose custom request headers, so the shared key
> is sent as a `?key=` query parameter over HTTPS (and checked by the script).

---

## Part B — Pull (scheduled)

The backend exposes a small, key-protected integration API for this:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/integrations/records` | All CRM records as JSON (`?since=<ISO>` for only rows changed after a time) |
| `GET /api/integrations/ping` | Key/health check (no data) |

Both require the header **`x-api-key: <SHEETS_SYNC_KEY>`**. Without a valid key
they return `401`; if the key is not configured the API returns `503`.

### 1. Configure the backend

Set a long random key (never commit it) and restart the server:

```bash
# .env
SHEETS_SYNC_KEY="paste-a-long-random-string-here"
```

Quick check (replace host + key):

```bash
curl -s -H "x-api-key: YOUR_KEY" https://your-host/api/integrations/ping
```

### 2. Add the script to your Sheet

1. Create/open a Google Sheet.
2. **Extensions → Apps Script**.
3. Replace the default `Code.gs` with the contents of
   [`docs/google-sheets-sync.gs`](./google-sheets-sync.gs).
4. **Project Settings (⚙) → Script properties → Add script property**:
   - `API_BASE` = your backend origin, e.g. `https://your-deployment.example.com`
     (no trailing slash)
   - `API_KEY` = the same value as `SHEETS_SYNC_KEY`
5. Run **`testConnection`** → check the log for `200 {"ok":true,...}`.
6. Run **`syncAll`** and authorise when prompted. The sheet now has tabs
   **Leads**, **Appointments**, **Enquiries** and **Meta**.
7. Run **`installTrigger`** once to refresh every 15 minutes.

> `syncAll` clears and rewrites the three tabs on each run, so the sheet always
> matches the backend. Times in the API are ISO-8601 UTC strings.

## 3. Notes & limits

- The API returns at most the 5000 most recent rows per entity.
- `/api/integrations/*` is rate-limited to 120 requests/minute per IP.
- For incremental pulls, call `/api/integrations/records?since=<lastISO>` — it
  returns only records with `updatedAt` greater than `since`.
- Rotate `SHEETS_SYNC_KEY` (and update the Script property) if it leaks; the old
  key stops working immediately.
- This endpoint exposes personal data, so keep the key secret and only share the
  Sheet with staff who should see enquiries and leads.
