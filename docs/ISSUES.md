# Prioritised Issue List

| # | Priority | Issue | Impact | Recommendation |
| --- | --- | --- | --- | --- |
| 1 | P0 | `privacy.html` / `terms.html` contain `[bracketed]` placeholders (legal name, address, email, jurisdiction). | Legal exposure if published as-is. | Owner completes them; legal review before launch. |
| 2 | P0 | Course fees and recognition (NMC/WHO, PCI, UGC) are as published at extraction time and may change. | Misleading admissions/fee claims. | Re-verify against institution + regulator before publishing; keep `last_verified_at`. |
| 3 | P1 | Large JPEGs — `graduates-band.jpg` 416 KB, `hero-classroom.jpg` 350 KB, `final-grads.jpg` 331 KB (the hero is the likely LCP element). | Slower LCP (> 2.5 s on mobile). | Serve ~150–250 KB WebP/AVIF at display size; add `width`/`height`. |
| 4 | P1 | Booking is not persisted; a WhatsApp message can be lost if the user doesn't press send. | Missed leads; no audit trail. | Implement the optional serverless booking API + PostgreSQL (see `SECURITY_AND_PRIVACY.md`). |
| 5 | P2 | Course content is client-rendered; a non-JS crawler sees placeholders (the reference's own bug). | Weaker indexability for course listings. | Pre-render/SSR the dataset into static HTML at build time. |
| 6 | P2 | No analytics. | Cannot measure conversions. | Add a privacy-friendly, consent-gated analytics script. |
| 7 | P2 | No live availability check on the calendar. | A user may request an already-taken slot. | Backend slot lookup (or clearly label slots as "requested"). |
| 8 | P3 | Reference has no `robots.txt`/`sitemap.xml` (we added them). | — | Keep the added files; submit the sitemap to Search Console. |
| 9 | P3 | Supplied repository was the wrong site ("Northlight Studio"). | Confusion for future work. | Owner to supply the correct source if one exists. |
| 10 | P3 | Instagram thumbnails are static copies; content may age. | Stale "updates". | Refresh periodically or integrate an authorised embed. |
