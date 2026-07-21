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

## Pipeline (`src/lib/`, pure — operates on per-shot row signatures; params typed `SigShot`, no DOM)

- `signature.ts` — each image → 48-wide (`SIG_W`) luma **row signature**; all matching is 1-D over rows.
- `overlay.ts` — `computeOverlay`: **temporal-variance mask** over the shot stack. A viewport cell
  (y,x) that barely changes across shots = fixed/floating UI (status bar, nav, sticky sub-header,
  floating button, pinned ad). Returns `mask` (for matching) + dilated `composeMask` (for
  compositing). `detectFixedBands` derives the top/bottom fixed bars from it.
- `match.ts` — overlay-masked, texture-weighted overlap cost. `minTrustOverlap` (~12% of band)
  rejects degenerate tiny "sliver" matches — makes ordering/seams robust, don't drop it. Per-shot
  derived cache (WeakMap on `shot.sig`) precomputes texture weights + a ½-res pyramid. `matchPair` =
  precise **full-res** coarse+fine (seams; pyramid aliases on repetitive content, don't use it here);
  `pairCostFast` = **½-res pyramid** coarse (the n² ordering matrix, relative cost only). Robustness:
  truncated-L1 per-cell cap `TRUNC` + 2nd-best `margin` (→ seam confidence; flags ambiguous seams).
- `order.ts` — `orderShots`: directed min-cost Hamiltonian path (Held-Karp n≤12, else greedy+2-opt)
  over pairwise costs, with a *gentle* filename-order prior (heuristic only, not authoritative).
- `stitch.ts` — `detectAllSeams`/`detectSeam`; a seam's `advance` = rows the lower image adds, `cut`
  = px the A→B transition is raised from the overlap bottom (0 = default). `reconcileSeams` reuses
  unchanged adjacent-pair seams (by shot id) on manual reorder (preserves advance/cut overrides).
- `compose.ts` — `computeLayout` → `Piece[]`, rendered by `renderRange`/`exportPng` (Canvas 2D,
  tiled past 16384px). Transition `T[i]=clamp(C[i]+band[i]-cut, C[i+1], C[i]+band[i])`; **strip** cuts
  exactly at T[i], **multi-source** (`cleanOverlays`) picks per content column the most-central
  covering shot whose cell isn't in `composeMask` (removes repeated floating buttons / sticky headers),
  with `buildCutConstraints` biasing to the cut when overridden. Residual UI remains only where every
  covering shot has UI there. Content axis `C[i]=Σ advance`; `Layout.overlaps` exposes handle Ys.

## App / state (`src/`)

- Heavy **ordering + seam detection run in a Web Worker** (`worker/stitchWorker.ts`, id-keyed sig
  registry; `hooks/useStitchWorker.ts` = promise wrapper, generation token, sig sent as transferred
  copies so main keeps its own, main-thread fallback on timeout). Overlay stays on main (cheap; its
  `composeMask` is needed for render). Manual reorder/remove use `reconcileSeams` on main (instant).
- `App.tsx` — one undoable `Doc` (`types.ts`) via `hooks/useHistory.ts`. Add/reprocess run through a
  **cancellable, non-reentrant job runner** (generation token + `runningRef` lock) that awaits the
  worker, NOT an effect. ⚠️ Do not move heavy work into an effect whose body sets its own deps — that
  caused the old infinite "처리 중" freeze. Overlay memoized on a set-key (order-independent).
- `ImageList` — whole-bar pointer drag reorder (threshold; touch drags via grip to keep scroll),
  file-drop insertion at a position, per-item move (↑↓⤒⤓) buttons. `PreviewCanvas` — hover maps
  output-y → active/overlapped shot; in review mode draggable **advance + cut handles** on the
  selected seam (rAF-throttled live re-render), overlap band + "구조 보기" tint, hover reorder toolbar.
  `SeamInspector` — zoomed A-over-B onion-skin (crisp=aligned) with fine advance/cut controls.
  Plus `FixedRegionEditor`, `SeamControls`, `DropZone`.

## Validating algorithm changes

This sandbox has **no browser** (Chromium absent, download CDN firewalled). The `lib/` code is pure,
so validate headlessly: bundle it with esbuild (`esbuild <entry> --bundle --format=esm
--platform=node`) and feed row signatures from a small Node PNG decoder. Reference set:
`.work-temp/photos-set1` (11 iPhone shots; correct order = filename order 1292→1302).
