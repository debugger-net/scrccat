import { useEffect, useMemo, useRef, useState } from 'react'
import type { Seam, Shot } from '../lib/types'
import { renderRange, type Layout } from '../lib/compose'

interface Props {
  shots: Shot[]
  layout: Layout | null
  seams: Seam[]
  selectedSeam: number | null
  onSelectSeam: (i: number | null) => void
  hoverShot: number | null
  onHoverShot: (i: number | null) => void
  reviewOpen: boolean
  onSeamEditStart: () => void
  onSeamEditEnd: () => void
  onSeamAdvance: (i: number, advance: number) => void
  onSeamCut: (i: number, cut: number) => void
  onMoveShot: (pos: number, to: 'up' | 'down' | 'top' | 'bottom') => void
  onRemoveShot: (pos: number) => void
}

const DISPLAY_W = 360
const MAX_PREVIEW_H = 16000

interface HoverInfo {
  region: 'header' | 'footer' | 'content'
  active: number
  bands: { shot: number; y0: number; y1: number; primary: boolean }[]
  label: string
  overlapN: number
}

export default function PreviewCanvas({
  shots,
  layout,
  seams,
  selectedSeam,
  onSelectSeam,
  hoverShot,
  onHoverShot,
  reviewOpen,
  onSeamEditStart,
  onSeamEditEnd,
  onSeamAdvance,
  onSeamCut,
  onMoveShot,
  onRemoveShot,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pointerOut, setPointerOut] = useState<number | null>(null)
  const [structure, setStructure] = useState(false)
  const scale = layout ? Math.min(DISPLAY_W / layout.width, MAX_PREVIEW_H / layout.height, 1) : 1

  // 드래그 중 최신 값 참조(리스너 재구독 없이)
  const layoutRef = useRef<Layout | null>(layout)
  layoutRef.current = layout
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const cbRef = useRef({ onSeamAdvance, onSeamCut, onSeamEditEnd })
  cbRef.current = { onSeamAdvance, onSeamCut, onSeamEditEnd }

  const dragRef = useRef<{ kind: 'advance' | 'cut'; seam: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const rafId = useRef(0)
  const pendingVal = useRef(0)
  const moveH = useRef<((e: PointerEvent) => void) | null>(null)
  const upH = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!layout || !canvasRef.current) return
    renderRange(shots, layout, canvasRef.current, 0, layout.height, scale)
  }, [shots, layout, scale])

  const flush = () => {
    rafId.current = 0
    const d = dragRef.current
    if (!d) return
    if (d.kind === 'advance') cbRef.current.onSeamAdvance(d.seam, pendingVal.current)
    else cbRef.current.onSeamCut(d.seam, pendingVal.current)
  }

  const startHandleDrag = (kind: 'advance' | 'cut', i: number, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onSeamEditStart()
    dragRef.current = { kind, seam: i }
    setDragging(true)
    onSelectSeam(i)
    moveH.current = (ev: PointerEvent) => {
      const lay = layoutRef.current
      const canvas = canvasRef.current
      if (!lay || !canvas) return
      const rect = canvas.getBoundingClientRect()
      const outY = (ev.clientY - rect.top) / scaleRef.current
      const pl = lay.placements[i]
      if (!pl) return
      pendingVal.current =
        kind === 'advance' ? outY - lay.headerH - pl.cStart : pl.cStart + pl.band - (outY - lay.headerH)
      if (!rafId.current) rafId.current = requestAnimationFrame(flush)
    }
    upH.current = () => {
      if (moveH.current) window.removeEventListener('pointermove', moveH.current)
      if (upH.current) window.removeEventListener('pointerup', upH.current)
      if (rafId.current) {
        cancelAnimationFrame(rafId.current)
        rafId.current = 0
      }
      flush()
      cbRef.current.onSeamEditEnd()
      dragRef.current = null
      setDragging(false)
    }
    window.addEventListener('pointermove', moveH.current)
    window.addEventListener('pointerup', upH.current)
  }

  useEffect(() => {
    return () => {
      if (moveH.current) window.removeEventListener('pointermove', moveH.current)
      if (upH.current) window.removeEventListener('pointerup', upH.current)
      if (rafId.current) cancelAnimationFrame(rafId.current)
    }
  }, [])

  const pointerHover = useMemo<HoverInfo | null>(() => {
    if (!layout || pointerOut == null || dragging) return null
    return hoverInfoAt(layout, pointerOut)
  }, [layout, pointerOut, dragging])

  const shownHover = useMemo<HoverInfo | null>(() => {
    if (pointerHover) return pointerHover
    if (layout && hoverShot != null && hoverShot < layout.placements.length) {
      const pl = layout.placements[hoverShot]
      return {
        region: 'content',
        active: hoverShot,
        bands: [{ shot: hoverShot, y0: layout.headerH + pl.cStart, y1: layout.headerH + pl.cStart + pl.band, primary: true }],
        label: `이미지 ${hoverShot + 1}`,
        overlapN: 0,
      }
    }
    return null
  }, [pointerHover, layout, hoverShot])

  useEffect(() => {
    if (pointerHover) onHoverShot(pointerHover.active)
  }, [pointerHover, onHoverShot])

  if (!layout) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-neutral-500">
        왼쪽에서 스크린샷을 추가하면 이어붙인 결과가 여기에 표시됩니다.
      </div>
    )
  }

  const onMove = (e: React.PointerEvent) => {
    if (dragging) return
    const rect = canvasRef.current!.getBoundingClientRect()
    setPointerOut((e.clientY - rect.top) / scale)
  }

  const sel = selectedSeam != null && reviewOpen ? layout.overlaps.find((o) => o.i === selectedSeam) : undefined
  const overlapPx = sel ? Math.round(sel.botY - sel.topY) : 0
  const cutFromBottom = sel ? Math.round(sel.botY - sel.cutY) : 0
  const hoverActivePl = shownHover && shownHover.region === 'content' ? layout.placements[shownHover.active] : null

  return (
    <div className="flex flex-col items-center gap-2">
      {shots.length > 1 && (
        <div className="flex items-center gap-3 self-stretch justify-center text-[11px]">
          <label className="flex cursor-pointer items-center gap-1 text-neutral-400 hover:text-neutral-200">
            <input type="checkbox" checked={structure} onChange={(e) => setStructure(e.target.checked)} />
            구조 보기 (각 장이 차지하는 영역)
          </label>
          {reviewOpen && <span className="text-neutral-600">이음새 선을 드래그해 조정</span>}
        </div>
      )}
      <div
        className="relative inline-block select-none"
        onPointerMove={onMove}
        onPointerLeave={() => {
          if (dragging) return
          setPointerOut(null)
          onHoverShot(null)
        }}
      >
        <canvas ref={canvasRef} className="block rounded border border-neutral-700 shadow-lg" />

        {/* 구조 보기: 각 장의 기여 영역을 색으로 구분(겹침은 블렌드) */}
        {structure &&
          layout.placements.map((pl, i) => (
            <div
              key={`st-${i}`}
              className="pointer-events-none absolute left-0 w-full"
              style={{
                top: (layout.headerH + pl.cStart) * scale,
                height: pl.band * scale,
                background: `hsla(${(i * 47) % 360}, 80%, 55%, 0.14)`,
                borderTop: `1px solid hsla(${(i * 47) % 360}, 80%, 60%, 0.5)`,
              }}
            >
              <span
                className="absolute left-1 top-0.5 rounded px-1 text-[9px] font-medium text-white"
                style={{ background: `hsla(${(i * 47) % 360}, 70%, 40%, 0.85)` }}
              >
                {i + 1}
              </span>
            </div>
          ))}

        {/* 호버 오버레이: 겹침 밴드 → 활성 밴드 */}
        {shownHover?.bands
          .filter((b) => !b.primary)
          .map((b, i) => (
            <div
              key={`o-${i}`}
              className="pointer-events-none absolute left-0 w-full bg-fuchsia-400/10 outline-dashed outline-1 outline-fuchsia-300/40"
              style={{ top: b.y0 * scale, height: (b.y1 - b.y0) * scale }}
            />
          ))}
        {shownHover?.bands
          .filter((b) => b.primary)
          .map((b, i) => (
            <div
              key={`p-${i}`}
              className={`pointer-events-none absolute left-0 w-full border-x-2 ${
                shownHover.region === 'content' ? 'border-x-sky-400 bg-sky-400/10' : 'border-x-amber-400 bg-amber-400/10'
              }`}
              style={{ top: b.y0 * scale, height: (b.y1 - b.y0) * scale }}
            >
              <span className="absolute left-1 top-1 rounded bg-neutral-900/80 px-1.5 py-0.5 text-[10px] font-medium text-neutral-100">
                {shownHover.label}
              </span>
            </div>
          ))}

        {/* 호버 재정렬 툴바 (미리보기에서 순서 변경) */}
        {!dragging && hoverActivePl && (
          <div
            className="absolute right-1 flex flex-col gap-0.5 rounded bg-neutral-900/85 p-0.5 shadow-lg"
            style={{ top: Math.max(2, (layout.headerH + hoverActivePl.cStart + hoverActivePl.band / 2) * scale - 52) }}
            onPointerEnter={() => onHoverShot(shownHover!.active)}
          >
            <TB label="맨 위로" sym="⤒" onClick={() => onMoveShot(shownHover!.active, 'top')} disabled={shownHover!.active === 0} />
            <TB label="위로" sym="↑" onClick={() => onMoveShot(shownHover!.active, 'up')} disabled={shownHover!.active === 0} />
            <TB label="아래로" sym="↓" onClick={() => onMoveShot(shownHover!.active, 'down')} disabled={shownHover!.active === shots.length - 1} />
            <TB label="맨 아래로" sym="⤓" onClick={() => onMoveShot(shownHover!.active, 'bottom')} disabled={shownHover!.active === shots.length - 1} />
            <TB label="삭제" sym="✕" danger onClick={() => onRemoveShot(shownHover!.active)} />
          </div>
        )}

        {/* 이음새 마커(전체) — 클릭해서 선택 */}
        {reviewOpen &&
          layout.overlaps.map((o) => {
            const conf = seams[o.i]?.confidence ?? 1
            const isSel = selectedSeam === o.i
            if (isSel) return null // 선택된 이음새는 아래 편집 UI로 렌더
            return (
              <button
                key={`m-${o.i}`}
                type="button"
                onClick={() => onSelectSeam(o.i)}
                title={`이음새 ${o.i + 1} · 신뢰도 ${(conf * 100).toFixed(0)}%`}
                className="group absolute left-0 flex w-full items-center"
                style={{ top: o.cutY * scale - 6, height: 12 }}
              >
                <span className={`h-px w-full ${conf < 0.33 ? 'bg-red-400/60' : conf < 0.66 ? 'bg-amber-400/50' : 'bg-sky-400/30'} group-hover:bg-sky-300`} />
              </button>
            )
          })}

        {/* 선택된 이음새: 오버랩 밴드 + 정렬/자르기 핸들 */}
        {sel && (
          <>
            <div
              className="pointer-events-none absolute left-0 w-full border-y border-amber-300/40 bg-amber-300/10"
              style={{ top: sel.topY * scale, height: Math.max(0, (sel.botY - sel.topY) * scale) }}
            >
              <span className="absolute right-1 top-1 rounded bg-neutral-900/80 px-1 text-[9px] text-amber-200">
                겹침 {overlapPx}px
              </span>
            </div>
            {/* 정렬(offset) 핸들 = 오버랩 상단(B 시작) */}
            <div
              className="absolute left-0 flex w-full cursor-ns-resize items-center"
              style={{ top: sel.topY * scale - 7, height: 14, touchAction: 'none' }}
              onPointerDown={(e) => startHandleDrag('advance', sel.i, e)}
              title="드래그: 겹침 정렬(offset)"
            >
              <div className="h-0.5 w-full bg-emerald-400" />
              <span className="absolute left-1 -top-0.5 rounded bg-emerald-500 px-1 text-[9px] font-medium text-white">정렬 ↕</span>
            </div>
            {/* 자르기(cut) 핸들 = A→B 전환 */}
            <div
              className="absolute left-0 flex w-full cursor-ns-resize items-center"
              style={{ top: sel.cutY * scale - 7, height: 14, touchAction: 'none' }}
              onPointerDown={(e) => startHandleDrag('cut', sel.i, e)}
              title="드래그: 자르는 선 위치"
            >
              <div className="h-0 w-full border-t-2 border-dashed border-amber-300" />
              <span className="absolute left-1 -top-0.5 rounded bg-amber-500 px-1 text-[9px] font-medium text-white">자르기 ↕ ({cutFromBottom}px)</span>
            </div>
          </>
        )}
      </div>

      <div className="text-center text-[11px] text-neutral-500">
        출력 {layout.width}×{layout.height}px
        {shownHover && shownHover.overlapN > 0 && <> · 이 지점 {shownHover.overlapN + 1}장 겹침</>}
        {!reviewOpen && <> · 마우스를 올리면 어느 이미지 영역인지 표시됩니다</>}
      </div>
    </div>
  )
}

function TB({ label, sym, onClick, disabled, danger }: { label: string; sym: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      className={`flex h-5 w-5 items-center justify-center rounded text-[11px] leading-none disabled:opacity-25 ${
        danger ? 'text-red-400 hover:bg-red-500/25' : 'text-neutral-200 hover:bg-neutral-700'
      }`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {sym}
    </button>
  )
}

// 출력 y에서 활성/겹침 이미지, 헤더/푸터 판정
function hoverInfoAt(layout: Layout, outY: number): HoverInfo | null {
  const { headerH, footerH, height, placements } = layout
  if (outY < 0 || outY > height) return null
  if (headerH > 0 && outY < headerH) {
    return { region: 'header', active: placements[0]?.shotIndex ?? 0, bands: [{ shot: 0, y0: 0, y1: headerH, primary: true }], label: '고정 헤더 (한 번만 포함)', overlapN: 0 }
  }
  if (footerH > 0 && outY >= height - footerH) {
    const last = placements.length - 1
    return { region: 'footer', active: last, bands: [{ shot: last, y0: height - footerH, y1: height, primary: true }], label: '고정 푸터 (한 번만 포함)', overlapN: 0 }
  }
  const p = outY - headerH
  const covering = placements.filter((pl) => pl.cStart <= p && p < pl.cStart + pl.band)
  if (!covering.length) return null
  let active = covering[0]
  let bestC = -Infinity
  for (const pl of covering) {
    const k = p - pl.cStart
    const c = Math.min(k, pl.band - k)
    if (c > bestC) {
      bestC = c
      active = pl
    }
  }
  const bands = covering.map((pl) => ({
    shot: pl.shotIndex,
    y0: headerH + pl.cStart,
    y1: headerH + pl.cStart + pl.band,
    primary: pl.shotIndex === active.shotIndex,
  }))
  const overlapN = covering.length - 1
  return {
    region: 'content',
    active: active.shotIndex,
    bands,
    label: overlapN > 0 ? `이미지 ${active.shotIndex + 1} · 겹침 ${overlapN}장` : `이미지 ${active.shotIndex + 1}`,
    overlapN,
  }
}
