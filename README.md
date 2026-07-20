# Scrccat

Stitch scrolling mobile screenshots into a single long image — entirely in the browser.

Take a series of overlapping screenshots while scrolling a long app view, drop them in,
and Scrccat finds the correct order, detects the overlaps by content, and joins them into
one image. Fixed UI (status bar, header, tab bar) is detected and can be kept once or
dropped. **All processing runs client-side — nothing is uploaded.**

Live: https://debugger-net.github.io/scrccat/

## Features

- **Add** by drag & drop or a multi-select file dialog (Mac Finder / iOS photo library).
- **Auto ordering** — no need to pre-sort; the correct top-to-bottom order is inferred by
  matching overlaps.
- **Content-based stitching** — robust to a changing status-bar clock or a tab bar that
  scrolls, because matching happens only inside the scrollable band.
- **Two ways to export**
  - _Auto_ — one click produces the result immediately.
  - _Review_ — open the panel to adjust the fixed regions and nudge each seam, then export.
    You can jump back to review after an auto export at any time.
- **Fixed region options** — include or omit the header/footer in the final output.
- Long outputs beyond the browser canvas limit are split into multiple PNG tiles.

## Tech

React + Vite + TypeScript + Tailwind. Stitching is pure TypeScript over Canvas 2D
(row-signature overlap detection — no WASM/OpenCV needed). Deployed to GitHub Pages via
GitHub Actions.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build locally
```

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes to
GitHub Pages. In the repository settings, set **Pages → Build and deployment → Source** to
**GitHub Actions** (one-time).

The Vite `base` is `/scrccat/` for production builds so assets resolve under the project
Pages path. If the repository is renamed, update `base` in `vite.config.ts`.
