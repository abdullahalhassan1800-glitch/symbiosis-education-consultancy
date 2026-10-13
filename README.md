# Symbiosis Education Consultancy — website

A complete, responsive, production-ready website for **Symbiosis Education Consultancy**, reproducing the design and verified content of the public reference at <https://symbiosis-consultancy.vercel.app/>.

The build is a **static, dependency-free front end** (HTML + CSS + vanilla ES5-compatible JS). It mirrors the verified architecture of the reference site (`index.html` + `css/` + `js/`, content rendered from a single data module) and adds a country filter, an explicit reset action, richer states and accessibility improvements.

## Quick start

```bash
# any of these:
npm start                 # serves on http://localhost:4173 (no dependencies)
python -m http.server 4173
# or simply open index.html in a browser
```

Then visit <http://localhost:4173>.

## Tests

```bash
npm test                  # frontend (25) + backend (69) checks
```

Results are also written to `docs/functional_test_results.csv`.

## Regenerate the audit files

```bash
node scripts/generate-audit.js
```

## Project structure

```
index.html                     Single-page site (all sections)
privacy.html  terms.html        Legal pages
404.html                        Error page
robots.txt  sitemap.xml         SEO
css/styles.css                  All styling (responsive 360→1440+)
js/data.js                      CENTRAL CONTENT DATASET (single source of truth)
js/app.js                       Rendering + fee finder + booking + nav
serve.js                        Zero-dependency static server
tests/run.js                    Functional/data tests
scripts/generate-audit.js       Emits docs/*.csv|json from the dataset
assets/                         photos, cut-outs, Instagram thumbnails, mark.svg
docs/                           Audit reports and extraction files
```

## The single source of truth

All course, fee, contact and FAQ content lives in **`js/data.js`**. Both the rendered site **and** the audit files (`scripts/generate-audit.js`) read from it, so the homepage, the fee finder and the extracted CSV/JSON can never disagree. To change a fee or add a course, edit `js/data.js` only.

## What works

- Opening animation: a navy brand curtain (animated mark + wordmark + gold progress bar) that auto-dismisses on load or after 1.8s, revealing a staggered hero entrance
- Sticky navigation with light/dark states + mobile drawer
- Hero, trust strip, service highlights, marquee
- Course bento grid → filters the fee finder
- **Fee finder**: field chips + free-text search + country filter + reset, with loading/empty/error-safe states
- Approach (fee-receipt visual), overseas MBBS with CIU figures, 4-step process
- **Booking**: calendar (60-day window, Sunday closed, past dates blocked), time slots with 1-hour notice, validated form, WhatsApp deep link, `.ics` download and Google Calendar link
- Accessible FAQ accordion, Instagram updates, footer
- Scroll reveals, count-ups, reduced-motion support

## Booking workflow (important)

This website has **no backend**. Submitting the booking form validates the input, builds a `wa.me` deep link containing the details, and opens WhatsApp. A reply from the business confirms the slot. No booking is stored on the site and no confirmation reference implies a stored record — the reference is generated for the WhatsApp message only. See `docs/SECURITY_AND_PRIVACY.md` for the optional persistent-backend path.

## Documentation

| Document | Contents |
| --- | --- |
| `docs/EXECUTIVE_SUMMARY.md` | Non-technical overview and status |
| `docs/SYMBIOSIS_CONSULTANCY_COMPLETE_TECHNICAL_AUDIT.md` | Full technical + content audit |
| `docs/SECURITY_AND_PRIVACY.md` | Security & privacy findings |
| `docs/SEO_AND_PERFORMANCE.md` | SEO and performance |
| `docs/DEPLOYMENT.md` | How to deploy |
| `docs/architecture.mmd` | Mermaid architecture diagram |
| `docs/ISSUES.md` | Prioritised issue list |

> Content provenance: course names, fees, eligibility and FAQs were extracted from the public reference (which sources the business's own Instagram). Fees are indicative and marked with their academic year. Nothing was invented; unavailable values are shown as "On counselling".
