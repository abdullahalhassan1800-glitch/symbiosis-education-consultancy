# Symbiosis Education Consultancy — Complete Technical Audit

Prepared 2026-10-14. Reference: <https://symbiosis-consultancy.vercel.app/>

---

## 1. Scope and method

- Retrieved the reference homepage and its raw source (`index.html`, `css/styles.css`, `js/main.js`, `js/data.js`, `js/hero3d.js`, `js/globe.js`).
- Probed `robots.txt`, `sitemap.xml`, `sitemap_index.xml` (all 404 — no robots/sitemap on the reference).
- Enumerated and downloaded every referenced asset (34 files, ~3.8 MB).
- Extracted the client-side content dataset and traced each figure to its public source reel.
- No forms were submitted to the reference; no restricted endpoints were probed.

## 2. Supplied repository note

The provided archive (`website-a9a8f869-…`) contains an **unrelated single-file site** titled "Northlight Studio — Digital Products, Brand & Experience Design" (a fictional design studio). It is **not** the Symbiosis source and was not used. The authoritative reference is the live Vercel site, which matches the supplied visual mockup. *Recommend the owner supply the correct repository if one exists.*

## 3. Technology discovery

**Confirmed (verified from source):**

| Layer | Technology |
| --- | --- |
| Hosting | Vercel (static) |
| Structure | Single `index.html` + `css/` + `js/` (no framework, no bundler) |
| Rendering | Vanilla JS ES modules (`type="module"`); all lists/stats injected at runtime from `js/data.js` |
| Styling | Hand-written CSS (custom properties, fluid `clamp()` typography) |
| Motion | GSAP + ScrollTrigger, Lenis smooth-scroll (CDN) |
| 3D | three.js (CDN, import map) — hero orbital scene and globe |
| Fonts | Google Fonts (Cinzel + Figtree) |
| Images | Local `assets/` (JPG/WebP/SVG) |

**Absent on the reference (verified):** no backend, no API calls, no database, no serverless functions, no forms/analytics endpoints; booking is a client-side WhatsApp deep link. No Next.js/React despite Vercel hosting.

**Not verified:** whether a private admin or third-party analytics exists behind the scenes.

**This build's stack (documented choice):** the same verified architecture — plain HTML/CSS/JS, no build step — with GSAP/Lenis/three.js **removed** (they were decorative). Motion is reimplemented with CSS + `IntersectionObserver`, cutting third-party scripts and improving LCP. Rationale: faithful to verified architecture, zero dependencies, trivially hostable, easiest to audit.

## 4. Page / section inventory

Single public page with these sections in order: Hero → Trust strip → Courses (bento) → CTA band → Approach → Fee finder → Photo band → Overseas MBBS → Process → Brand + stats → Booking → FAQ → Instagram updates → Final CTA → Footer. Full detail in `page_content.json` / `page_content.md`.

## 5. Content extraction

- **Fields:** 10 (Medical & AYUSH, Pharmacy, Paramedical & Nursing, Engineering, Management, Teaching & Education, Design & Media, Law/Architecture/More, MBBS Overseas, Working professionals).
- **Courses:** 30, each with institution, place, country, duration, eligibility, key fee, itemised fee lines, source reel. `courses_and_fees.csv`, `courses_fee_lines.csv`.
- **Institutions/countries:** `universities_and_countries.csv`.
- **FAQs:** 7 verbatim. `faqs.json`.
- **Contact (verified):** phone/WhatsApp printed `+91 82006 91036`; booking WhatsApp `wa.me/917284913204`; Instagram `@symbiosis.consultancy`.
- **Updates:** 6 Instagram posts with thumbnails.
- Each fee carries currency (INR) and academic year (2026–27). Unavailable figures are labelled **"On counselling"**, never guessed.

## 6. Content-consistency audit (the observed discrepancy)

**Observation.** The homepage presents a "Lowest listed fee ₹20,000 / year" card, while a non-JS crawl reports **"0 programmes listed", "0 countries"**, and the fee finder's *"No course matches that yet"* text.

**Tested causes and findings:**

| Hypothesis | Verdict |
| --- | --- |
| Empty course data | **False** — `js/data.js` defines 30 courses. |
| Failed data request | **False** — data is bundled locally; no fetch. |
| Incorrect search filters | **False** — filters work once JS runs. |
| Hard-coded statistics | **Partially true & root cause** — hero facts/stats ship literal `0` in HTML and are overwritten by `main.js` (`$$('[data-count="programmes"]').forEach(el => el.dataset.count = COURSES.length)`). |
| Empty-state text | **Red herring** — `<p id="empty" hidden>` is always in the HTML; only its `hidden` attribute is toggled. A text-only crawler extracts it regardless of state. |

**Root cause:** client-side rendering + hard-coded zero placeholders + a permanently-present empty-state node. Not a data defect.

**Fix applied in this build:** a single source of truth (`js/data.js`) drives the homepage counts, the bento grid and the fee finder; the status line reports the real count ("Showing N of 30 programmes"); the empty state is created only when a filter genuinely returns zero, with a **Reset filters** action; and default (unfiltered) rendering always shows all 30. Verified by tests `finder: default state shows all programmes` and `finder: nonsense query yields a truthful empty state`.

## 7. Functional audit of the build

| Feature | Behaviour |
| --- | --- |
| Opening animation | Fixed navy curtain with the brand mark, wordmark and a gold progress bar; dismisses on `load` or after a 1.8s cap, retracting upward to reveal a staggered hero entrance (pill → title words → sub → CTAs → facts). Auto-removed from the DOM; hidden and page-unlocked without JS; disabled under reduced motion. |
| Navigation | Sticky; transparent over hero → light on scroll; in-page smooth anchors; skip link. |
| Mobile menu | Hamburger → full drawer; `aria-expanded`, Esc to close, focus-visible. |
| Fee finder | Field chips + country `<select>` + debounced text search + reset; empty state; live count. |
| Course cards | Expandable itemised fees (from dataset), points, "original post" source link, book CTA that pre-selects the course. |
| Booking | Calendar (60-day window, Sundays disabled, past dates disabled, today disabled once all slots pass notice), time slots with 1-hour notice, validated form, WhatsApp deep link, `.ics`, Google Calendar. |
| FAQ | Native `<details>` accordion — keyboard accessible by default. |
| States | Loading/empty/error-safe: no network dependency, so an "error state" cannot be triggered by a failed request; the empty state is explicit and recoverable. |

## 8. Accessibility

Semantic landmarks (`header/main/footer/nav`), single `h1`, ordered headings, associated labels, labelled icon-only controls, `role="grid"` calendar with `aria-label`s, `aria-live` finder status, visible focus rings, `prefers-reduced-motion`, meaningful alt text (decorative images marked `alt=""`). Not formally WCAG-audited — targeted AA where practical (see `SEO_AND_PERFORMANCE.md`).

## 9. SEO

Unique title/description, canonical, Open Graph/Twitter, `EducationalOrganization` JSON-LD (no fabricated ratings), `sitemap.xml`, `robots.txt`, descriptive alt text, mobile-friendly, `404.html`. Course content is crawl-rendered from JS — **caveat:** for full indexability the owner may prefer server-rendering or a static pre-render; documented in `ISSUES.md`.

## 10. Architecture & data model

See `architecture.mmd`. Implemented: static front end + WhatsApp integration (verified). Recommended-but-not-built: serverless booking API + PostgreSQL (`appointments`, `leads`, `courses`, `institutions`) — fully specified in `SECURITY_AND_PRIVACY.md`.

## 11. Prioritised issues

See `docs/ISSUES.md`.
