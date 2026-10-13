# Symbiosis Education Consultancy — Executive Summary

**Deliverable:** a complete, responsive, production-ready website that reproduces the design of the public reference (<https://symbiosis-consultancy.vercel.app/>) and ships its verified content — with real, working functionality.

**Status:** implemented and tested. 23/23 automated checks pass (`npm test`).

## What was done

1. **Deep scan.** Inspected the live reference: `index.html`, `js/main.js`, `js/data.js`, `hero3d.js`, `globe.js`, `css/styles.css` and all referenced assets. No `robots.txt` or `sitemap.xml` exists on the reference (documented in `crawl_errors.csv`).
2. **Content extraction.** Pulled the full verified dataset behind the site — **10 programme fields, 30 courses** with fees/eligibility/institutions/countries, **7 FAQs**, 5 service promises, and 6 Instagram updates, each traced to a public source. Files: `website_inventory.csv`, `page_content.*`, `courses_and_fees.csv`, `universities_and_countries.csv`, `faqs.json`, `assets_inventory.csv`, `forms_and_fields.json`, `structured_data.json`, link inventories.
3. **Consistency audit.** Diagnosed the "0 courses / empty finder" symptom (see below) and eliminated it by design: one dataset drives everything.
4. **Build.** A static, dependency-free site (verified architecture) with all requested sections, a working **fee finder** (field + country + free-text + reset), and a working **booking flow** (calendar → slots → validated form → WhatsApp → calendar export).
5. **Quality.** Responsive (360–1440px), keyboard-accessible, reduced-motion support, SEO metadata + structured data + sitemap + robots, privacy/terms/404 pages.
6. **Docs.** Technical audit, security/privacy findings, SEO/performance, deployment guide, architecture diagram, prioritised issues.

## The content-consistency finding (headline)

The reference site showed a starting fee on the homepage while a crawler saw **"0 programmes listed / 0 countries"** and the fee finder's *"no course matches"* message. **Cause: the content is rendered entirely client-side from `js/data.js`, while the static HTML ships hard-coded `0` placeholders and an always-present (hidden) empty-state node.** A crawl that does not execute JavaScript therefore sees zeros; there is no data problem. Confirmed by reading the source: 30 real courses exist and the counts are filled in by `main.js` at boot. Our build keeps a single source of truth and renders explicit, truthful states, so this class of inconsistency cannot recur.

## Verified vs inferred (discipline)

- **Verified:** static hosting, client-side rendering, the dataset, WhatsApp/phone/Instagram contacts, asset set, absence of a backend.
- **Inferred / recommended (not claimed):** a persistent booking database, admin dashboard and notification service — described in `docs/SECURITY_AND_PRIVACY.md` as an *optional* path, not asserted as existing.

## Honest limitations

- **No live availability.** The booking calendar does not check the business's real calendar; a slot is only confirmed by human reply.
- **Fees are indicative** and tied to academic year 2026–27 as published at extraction time.
- **Overseas recognition** (NMC/WHO, FMGE/NEXT) must be re-verified against current regulator lists before any admission claim.
- Placeholders in `privacy.html` / `terms.html` (`[business legal name]`, address, email) must be completed by the owner.
