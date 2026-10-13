# SEO & Performance Report

## SEO — implemented

- **Title:** `Symbiosis Education Consultancy — Admissions 2026–27` (unique).
- **Meta description:** present, ~150 chars.
- **Canonical:** `https://symbiosis-consultancy.vercel.app/`.
- **Open Graph + Twitter card** with a real image (`assets/photos/graduates-band.jpg`).
- **JSON-LD `EducationalOrganization`** — name, description, url, telephone, `sameAs`, `areaServed`. **No fabricated `aggregateRating` or `review`.**
- **`sitemap.xml`** and **`robots.txt`** (the reference had neither — a quick win).
- **Semantic headings:** one `h1`, section `h2`s, card `h3`s.
- **Descriptive alt text** on informative images; decorative images `alt=""`.
- **Mobile-friendly**, responsive, explicit viewport.
- **`404.html`** with `noindex`.
- Course content is crawl-rendered from JS. Search engines execute JS, but for maximum robustness consider a pre-render/SSR step (see `ISSUES.md`, P2).

## Performance — approach

No Lighthouse run is included here (metrics must be measured, not invented). The build is deliberately lean:

- **Zero JS dependencies.** Removed GSAP (~70 KB), ScrollTrigger (~40 KB), Lenis, and three.js (~600 KB) that the reference loaded from CDNs. Motion is now CSS + `IntersectionObserver` (~0 KB libs).
- **Local, compressed assets**; hero image uses `fetchpriority="high"`, below-fold images use `loading="lazy"`.
- **No render-blocking third-party JS**; only Google Fonts (with `preconnect`).
- **Stable layout:** fixed aspect ratios on media (`aspect-ratio`) to minimise CLS; images have explicit ratios.
- **CSS** is one file, no framework overhead.
- **Caching:** static assets are immutable on Vercel; long `Cache-Control` recommended on `assets/*`.

### Expected Core Web Vitals posture (to be measured)
- **LCP:** hero `hero-classroom.jpg` is ~350 KB (and the photo-band `graduates-band.jpg` is ~416 KB) — the main optimisation target. Measured sizes: `grad graduates-band.jpg 416 KB`, `hero-classroom.jpg 350 KB`, `final-grads.jpg 331 KB`, `tbilisi.jpg 243 KB`. Recommend serving ~150–250 KB WebP/AVIF at display size. *(Not yet done — see ISSUES P1.)*
- **INP:** trivial — no heavy JS. Should be well under 200 ms.
- **CLS:** low — media use `aspect-ratio`; the hero card/calendar are absolute/stable.

### How to measure (owner)
```bash
npx lighthouse http://localhost:4173 --view
# or PageSpeed Insights against the deployed URL
```
Record the real numbers in this file after deploying.

## Accessibility (targeted, not formally certified)

Keyboard-operable nav/drawer/finder/booking, visible focus, labels, `aria-live` status, reduced-motion. Recommend an axe/Lighthouse accessibility pass before launch; results should be recorded rather than assumed.
