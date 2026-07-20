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
  matching overlaps. A directed min-cost path (Held-Karp for small sets) with a gentle
  filename-order prior makes it robust even when images are added out of order.
- **Drag-and-drop reordering** — grab the handle (works on touch too) to reorder with a
  live placeholder gap and sliding animation. A **filename sort** button toggles
  ascending/descending.
- **Overlay-aware matching** — status bars, sticky sub-headers, floating buttons and pinned
  ads are detected as "overlay" (cells that stay put across shots) and **excluded from
  matching**, so they no longer cause wrong order or bad seams. A minimum-overlap guard
  rejects degenerate edge-of-image "sliver" matches.
- **Floating-UI cleanup** — during compositing, regions covered by a floating button or a
  repeated sticky header are filled from a neighbouring screenshot (per-column, most-central
  source), so those elements don't repeat down the image and header/footer shadows don't
  streak at every seam. Toggle it off for a plain strip stitch. Where every shot has UI in
  the same spot it's unavoidable — add another screenshot of that region and re-run.
- **Hover to inspect** — hovering the preview highlights which image a region came from
  (active vs. overlapped lower-priority shots, and the fixed header/footer), synced with the
  left list; hovering the list highlights the preview.
- **Undo / redo** — `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` (or `Ctrl+Y`), plus toolbar buttons.
- **Responsive, non-blocking processing** — heavy analysis runs as a cancellable job with a
  status message; controls are disabled while it runs (no more stuck "processing").
- **Two ways to export** — _Auto_ (one click) or _Review_ (adjust fixed regions, nudge each
  seam, then export). Long outputs beyond the browser canvas limit split into PNG tiles.

## Tech

React + Vite + TypeScript + Tailwind. Stitching is pure TypeScript over Canvas 2D — a
row-signature (48-wide luma) overlap matcher with a temporal-variance overlay mask and
texture-weighted cost; no WASM/OpenCV. Deployed to GitHub Pages via GitHub Actions.

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
