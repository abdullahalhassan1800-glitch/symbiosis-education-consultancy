# Google Sheets push — service-account (API) setup

This is the **reliable** way to push website leads / appointments / enquiries into
a Google Sheet. It does **not** use an Apps Script web app, so there is no public
`/exec` deployment and no "Who has access: Anyone" step.

How it works: the backend signs a JWT with a **service-account key**, exchanges
it for an access token, and calls the **Google Sheets API v4** to append rows.
The service account only needs **edit access to your one spreadsheet**.

> Why: the Apps Script webhook kept returning `403 You need access`, because the
> deployment was not publicly accessible. The API method avoids that entirely.

## One-time setup (~5 minutes)

1. **Create / pick a Google Cloud project**
   - Go to <https://console.cloud.google.com/> → project dropdown → **New project**
     → name it e.g. `symbiosis-sheets` → Create, then select it.

2. **Enable the Google Sheets API**
   - APIs & Services → **Library** → search **Google Sheets API** → **Enable**.

3. **Create a service account**
   - APIs & Services → **Credentials** → **Create credentials** → **Service account**.
   - Name: `symbiosis-sheets` → Create and continue → (no roles needed) → Done.

4. **Create a JSON key**
   - Click the new service account → **Keys** tab → **Add key** → **Create new key**
     → **JSON** → Create. A `.json` file downloads.
   - Inside it, copy the **`client_email`** value
     (looks like `symbiosis-sheets@your-project.iam.gserviceaccount.com`).

5. **Share your spreadsheet with the service account**
   - Open your Google Sheet → **Share** → paste the `client_email` → role **Editor**
     → Send. (It is a robot account, so no email is actually sent.)

6. **Store the key safely (in the project folder, never committed)**
   - Save the downloaded file as e.g.
     `secrets\google-service-account.json`
     (the `secrets/` folder is git-ignored).

7. **Point the backend at the sheet**
   - In your Google Sheet URL, the id is the long part between `/d/` and `/edit`:
     `https://docs.google.com/spreadsheets/d/`**`THIS_IS_THE_ID`**`/edit`
   - Add to `.env`:
     ```
     GOOGLE_SHEETS_ID="THIS_IS_THE_ID"
     GOOGLE_SERVICE_ACCOUNT_JSON="F:\D_DRIVE\student\symbiosis-education-consultancy\secrets\google-service-account.json"
     ```
     (You can also paste the raw JSON on one line instead of a path.)

8. **Restart the server** and submit a test lead. A `Leads` tab is created
   automatically (with a header row) and a row is appended. `Appointments` and
   `Enquiries` tabs appear the same way.

## Notes

- When `GOOGLE_SHEETS_ID` + a service account are set, this API mode is chosen
  automatically and `SHEETS_WEBHOOK_URL` is ignored.
- The push is **best-effort and time-boxed (5s)** — a Google outage never affects
  a visitor's request.
- Verify the wiring any time with: `npm run test:sheets`.
