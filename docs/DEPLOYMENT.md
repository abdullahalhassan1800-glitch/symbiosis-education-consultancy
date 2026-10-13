# Deployment

The build is static — any static host works. Two supported paths below.

## Option A — Vercel (matches the reference)

1. Put this folder in a Git repo and import it at <https://vercel.com/new>.
2. Framework preset: **Other**. Build command: *(none)*. Output directory: `.` (project root).
3. No environment variables are required for the static build.
4. Recommended `vercel.json` (security headers + asset caching + clean 404):

```json
{
  "cleanUrls": true,
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'" }
      ]
    },
    { "source": "/assets/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
  ]
}
```

5. If you add the optional booking API (see `SECURITY_AND_PRIVACY.md`), add env vars (`DATABASE_URL`, notification keys) in the dashboard — never in the repo — and add `/api/*` functions.

## Option B — any static host (Netlify, GitHub Pages, Nginx, S3+CloudFront)

Upload the repository contents as-is. Ensure:
- 404 handling points at `404.html`.
- HTTPS is enabled.
- Long cache on `assets/*`, short cache on `*.html`.

## Local preview

```bash
npm start          # http://localhost:4173  (zero dependencies)
# or
python -m http.server 4173
```

## Pre-launch checklist

- [ ] Run `npm test` (expect 23/23 pass).
- [ ] Complete the `[bracketed]` placeholders in `privacy.html` and `terms.html`.
- [ ] Confirm the phone/WhatsApp numbers and Instagram handle are current.
- [ ] Verify all course fees and NMC/PCI/UGC/WHO recognition claims with the institutions.
- [ ] Optimise the hero image to WebP/AVIF (< 250 KB).
- [ ] Run Lighthouse / axe and record results.
- [ ] Do **not** deploy over the live reference without explicit owner authorisation.
