# Ventis Design Glow-Up — Spec (2026-06-09)

Visual / brand pass on the two live front-ends. Code-only (Claude Code ships;
Claude Design assets are an optional later layer). No feature changes, no copy
rewrites, claim-integrity intact.

## Decisions (locked with Diego)

- **Scope:** both surfaces — the public site (`site/`) and the data library (`library/`).
- **Site direction:** "Dialed-up field report" — keep the editorial green system,
  add craft (warmer paper + subtle grain, one signature hero data-moment, pull-quote
  typography, finer micro-interactions). Refine, don't reinvent. The site is the
  outward-facing credibility asset (Conklin / ResOps / beta), so low risk.
- **Library:** full system port. It's a barely-touched Vite starter (orphaned
  `index.css`/`App.css` with a purple `--accent`, system font, inline-styled tables).
  Bring it onto the site's editorial system so it reads like a credible data *product*.
- **Council note:** the June 6 "stop polishing the catalog" ruling was about
  *features*. This is purely visual/brand, which supports the moat/acquisition story
  (a credible-looking dataset), so it's in-bounds.

## Phase A — Data library port

Files:
- `library/index.html` — add DM Serif Display / Outfit / DM Mono (mirror `site/index.html`),
  real `<title>` + description + theme-color, keep favicon.
- `library/src/theme.css` — rewrite into the full system: port the site's token set
  (greens, bone/mist neutrals, ink/muted/faint, line, shadow trio, serif/sans/mono,
  radii, maxw), atmospheric `body::before` backdrop, selection color. Keep the
  device-app aliases (`--fg`, `--border`, `--tile-alt`, `--green-light`, etc.) mapped
  to the new tokens so existing references stay valid. Add component classes
  (header, run-index, table, cards, chips, badges, stat tiles, prose).
- Delete orphaned `library/src/index.css` + `library/src/App.css` (dead Vite cruft).
- `library/src/components/Header.tsx` (new) — glassy fixed header: air-flow brand mark
  (mirror `site/.../Nav.tsx`) + "Ventis · Data Library" serif wordmark + nav
  (Runs / Compare / About / Operations). Footer with the private-catalog note.
- `library/src/App.tsx` — wrap routes in the Header/footer shell.
- `RunTable.tsx` — branded run index: refined table, CO₂-tier chips, mono numerals,
  ASHRAE / quality / consent badges. Remove the 🔍 emoji + em-dash placeholders.
- `RunDetail.tsx` — editorial run page; replace ⬇ emoji with an SVG; mono stat values.
- `ComparePage.tsx` — restyle controls + chart card; tune recharts to the palette.
- `StatsBar.tsx` — serif-numeral stat tiles (like the site `.point-k`).
- `AboutPage.tsx` / `OperationsPage.tsx` / `DeployPage.tsx` — restyle to match.

Unchanged: gated/private (Cloudflare Access), all catalog logic, `build_catalog`
output contract, the `Run` shape. Visual only.

## Phase B — Public site craft pass ("dialed-up field report")

- `site/src/global.css` — warmer paper (`--bone`/`--bg` tuned) + a subtle SVG grain
  overlay (gated behind reduced-motion-safe, low-opacity, fixed). Pull-quote class.
  Finer hover/lift micro-interactions on existing primitives.
- Signature hero data-moment on `site/src/pages/Home.tsx` — the 1,111 ppm reading
  rising against the ASHRAE 1,000 line (a small self-contained animated SVG/Recharts
  "live air ribbon" in the hero), reduced-motion safe, traces to real data.
- `site/DESIGN.md` — update to record the changes (the doc's own rule).
- Copy untouched. Re-run `grep -rn "—" site/src` before finishing (em-dash bar = 0).

## Verification

- `npm run build` green in both `site/` and `library/` (tsc + vite; library vitest stays green).
- Render-verify each changed route (desktop + ≤640px). Library is gated, so verify via `npm run dev` locally.
- Site pre-ship checklist (`DESIGN.md` §9): contrast, focus, reduced-motion,
  375/768/1024/1440, no emoji icons, claim integrity, no pricing.
- Branch `Ventis/feat-design-glowup`; commit atomically; **do not push** (auto-deploys) —
  Diego previews locally and merges.

## Out of scope (deferred)

- Claude Design assets (hero illustration, OG/social image) — drop in later, no rework.
- Any feature work on the catalog (council ruling).
- Copy/positioning rewrites (Claude Desktop's domain; handoff if needed).
