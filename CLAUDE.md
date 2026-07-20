<!-- padenv:managed start v1 module=agent-instructions -->
If present, also read `.portable-dev/agent-instructions/CLAUDE.md`.
This optional file is used only by contributors who install the Portable AI Development Environment.
<!-- padenv:managed end -->

# Scrccat — project guide

Browser-only tool that stitches overlapping scrolling screenshots (e.g. a long mobile page
captured in pieces) into one long image. **All processing is client-side; nothing is uploaded.**
React + Vite + TypeScript + Tailwind. Deployed to GitHub Pages by `.github/workflows/deploy.yml`
on push to `main`; Vite `base` is `/scrccat/`. Commands: `npm run dev`, `npm run build`
(tsc + vite), `npm run typecheck`. Code comments are Korean — keep that.

## Pipeline (`src/lib/`, pure — operates on per-shot row signatures, DOM only in signature/render)

- `signature.ts` — each image → 48-wide (`SIG_W`) luma **row signature**; all matching is 1-D over rows.
- `overlay.ts` — `computeOverlay`: **temporal-variance mask** over the shot stack. A viewport cell
  (y,x) that barely changes across shots = fixed/floating UI (status bar, nav, sticky sub-header,
  floating button, pinned ad). Returns `mask` (for matching) + dilated `composeMask` (for
  compositing). `detectFixedBands` derives the top/bottom fixed bars from it.
- `match.ts` — overlay-masked, texture-weighted overlap cost. `minTrustOverlap` (~12% of band)
  rejects degenerate tiny "sliver" matches — this is what makes ordering/seams robust, don't drop it.
  `matchPair` = precise (seams); `pairCostFast` = coarse (the n² ordering matrix).
- `order.ts` — `orderShots`: directed min-cost Hamiltonian path (Held-Karp n≤12, else greedy+2-opt)
  over pairwise costs, with a *gentle* filename-order prior (heuristic only, not authoritative).
- `stitch.ts` — `detectAllSeams`/`detectSeam`; a seam's `advance` = rows the lower image adds.
  `reconcileSeams` reuses unchanged adjacent-pair seams (by shot id) on manual reorder.
- `compose.ts` — `computeLayout` → `Piece[]`, rendered by `renderRange`/`exportPng` (Canvas 2D,
  tiled past 16384px). With `cleanOverlays`, **per-column multi-source** picks, for each content
  column, the most-central covering shot whose cell isn't in `composeMask` — this removes repeated
  floating buttons / sticky headers and header/footer shadow streaks. Residual UI remains only where
  every covering shot has UI at that spot (unavoidable). Content axis: `C[i] = Σ advance`.

## App / state (`src/`)

- `App.tsx` — one undoable `Doc` (`types.ts`) managed by `hooks/useHistory.ts` (undo/redo). Heavy
  add/reorder analysis runs in a **cancellable, non-reentrant job runner** (generation token +
  `runningRef` lock), NOT an effect. ⚠️ Do not move heavy work into an effect whose body sets its own
  deps — that caused the old infinite "처리 중" freeze. Overlay is memoized on a set-key so reorder
  doesn't recompute it (it's order-independent).
- `ImageList` — pointer drag-drop reorder (handle + placeholder gap + slide), filename-sort toggle,
  hover sync. `PreviewCanvas` — hover maps output-y → active/overlapped shot + header/footer.
  Plus `FixedRegionEditor`, `SeamControls`, `DropZone`.

## Validating algorithm changes

This sandbox has **no browser** (Chromium absent, download CDN firewalled). The `lib/` code is pure,
so validate headlessly: bundle it with esbuild (`esbuild <entry> --bundle --format=esm
--platform=node`) and feed row signatures from a small Node PNG decoder. Reference set:
`.work-temp/photos-set1` (11 iPhone shots; correct order = filename order 1292→1302).
