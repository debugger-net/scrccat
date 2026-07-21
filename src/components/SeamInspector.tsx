import { useEffect, useRef, useState } from 'react'
import type { Seam, Shot } from '../lib/types'
import type { Layout } from '../lib/compose'

interface Props {
  shots: Shot[]
  layout: Layout
  seamIndex: number
  seam: Seam
  onSeamEditStart: () => void
  onSeamEditEnd: () => void
  onSeamAdvance: (i: number, advance: number) => void
  onSeamCut: (i: number, cut: number) => void
  onResetAdvance: (i: number) => void
  onResetCut: (i: number) => void
  onClose: () => void
}

const PANEL_W = 520
const MARGIN = 120 // 오버랩 위·아래로 보여줄 여유(문맥)

// 이음새 정밀 조정: 오버랩 구간을 확대해 A(위)/B(아래)를 어니언스킨으로 겹쳐 보여준다.
// 정렬(advance)이 맞으면 두 층이 또렷하게 겹치고, 어긋나면 잔상(ghost)이 보인다.
export default function SeamInspector({
  shots,
  layout,
  seamIndex,
  seam,
  onSeamEditStart,
  onSeamEditEnd,
  onSeamAdvance,
  onSeamCut,
  onResetAdvance,
  onResetCut,
  onClose,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [blend, setBlend] = useState(0.5)
  const i = seamIndex
  const A = shots[i]
  const B = shots[i + 1]
  const pA = layout.placements[i]
  const pB = layout.placements[i + 1]
  const ov = layout.overlaps.find((o) => o.i === i)

  const geom = (() => {
    if (!A || !B || !pA || !pB || !ov) return null
    const top = layout.top
    const cStartA = pA.cStart
    const cStartB = pB.cStart
    const bandA = pA.band
    const bandB = pB.band
    const topContent = cStartB // 오버랩 상단
    const botContent = cStartA + bandA // 오버랩 하단
    const cutContent = ov.cutY - layout.headerH
    const winTop = Math.max(0, topContent - MARGIN)
    const winBot = botContent + MARGIN
    const scale = PANEL_W / layout.width
    return { top, cStartA, cStartB, bandA, bandB, topContent, botContent, cutContent, winTop, winBot, scale }
  })()

  // 어니언스킨 렌더
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !geom || !A || !B) return
    const { top, cStartA, cStartB, bandA, bandB, winTop, winBot, scale } = geom
    const winH = winBot - winTop
    const w = Math.max(1, Math.round(layout.width * scale))
    const h = Math.max(1, Math.round(winH * scale))
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, w, h)
    ctx.imageSmoothingQuality = 'high'
    // A 층(위 이미지) — 자기 밴드 범위 안에서
    const drawSlice = (shot: Shot, cStart: number, band: number, alpha: number) => {
      const c0 = Math.max(winTop, cStart)
      const c1 = Math.min(winBot, cStart + band)
      if (c1 <= c0) return
      ctx.globalAlpha = alpha
      ctx.drawImage(
        shot.bitmap,
        0,
        top + (c0 - cStart),
        shot.width,
        c1 - c0,
        0,
        (c0 - winTop) * scale,
        w,
        (c1 - c0) * scale,
      )
    }
    drawSlice(A, cStartA, bandA, 1)
    drawSlice(B, cStartB, bandB, blend)
    ctx.globalAlpha = 1
  }, [shots, layout, seamIndex, blend, geom, A, B])

  // 드래그(advance/cut) — rAF 스로틀
  const dragRef = useRef<{ kind: 'advance' | 'cut'; startY: number; base: number } | null>(null)
  const rafId = useRef(0)
  const pending = useRef(0)
  const moveH = useRef<((e: PointerEvent) => void) | null>(null)
  const upH = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      if (moveH.current) window.removeEventListener('pointermove', moveH.current)
      if (upH.current) window.removeEventListener('pointerup', upH.current)
      if (rafId.current) cancelAnimationFrame(rafId.current)
    }
  }, [])

  const flush = () => {
    rafId.current = 0
    const d = dragRef.current
    if (!d) return
    if (d.kind === 'advance') onSeamAdvance(i, pending.current)
    else onSeamCut(i, pending.current)
  }

  const startDrag = (kind: 'advance' | 'cut', e: React.PointerEvent) => {
    if (!geom) return
    e.preventDefault()
    e.stopPropagation()
    onSeamEditStart()
    // advance: 아래로 끌면 +advance. cut: 아래로 끌면 자르는 선이 내려가 cut 감소.
    dragRef.current = { kind, startY: e.clientY, base: kind === 'advance' ? seam.advance : seam.cut }
    moveH.current = (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d || !geom) return
      const dContent = (ev.clientY - d.startY) / geom.scale
      pending.current = d.kind === 'advance' ? d.base + dContent : d.base - dContent
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
      onSeamEditEnd()
      dragRef.current = null
    }
    window.addEventListener('pointermove', moveH.current)
    window.addEventListener('pointerup', upH.current)
  }

  const nudge = (kind: 'advance' | 'cut', delta: number) => {
    onSeamEditStart()
    if (kind === 'advance') onSeamAdvance(i, seam.advance + delta)
    else onSeamCut(i, seam.cut + delta)
    onSeamEditEnd()
  }

  const cutLineTop = geom ? (geom.cutContent - geom.winTop) * geom.scale : 0
  const overlapPx = geom ? Math.round(geom.botContent - geom.topContent) : 0

  return (
    <div className="flex flex-col gap-2 border-t border-neutral-800 bg-neutral-900 p-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold text-amber-300">
          이음새 {i + 1} 정밀 조정 <span className="font-normal text-neutral-500">({i + 1}→{i + 2})</span>
        </span>
        <span className="text-neutral-500">겹침 {overlapPx}px · 신뢰도 {((seam.confidence ?? 0) * 100).toFixed(0)}%</span>
        <button className="ml-auto btn-icon" onClick={onClose} title="정밀 조정 닫기">
          ✕
        </button>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        {/* 어니언스킨 확대 뷰 */}
        <div className="relative shrink-0 select-none" style={{ width: PANEL_W }}>
          <canvas
            ref={canvasRef}
            className="block w-full cursor-ns-resize rounded border border-neutral-700"
            onPointerDown={(e) => startDrag('advance', e)}
            title="세로로 드래그: 두 이미지 정렬(offset) 맞추기"
          />
          {/* 오버랩 상/하단 경계 */}
          {geom && (
            <>
              <div
                className="pointer-events-none absolute left-0 w-full border-t border-emerald-400/60"
                style={{ top: (geom.topContent - geom.winTop) * geom.scale }}
              />
              <div
                className="pointer-events-none absolute left-0 w-full border-t border-emerald-400/60"
                style={{ top: (geom.botContent - geom.winTop) * geom.scale }}
              />
              {/* 자르는 선(드래그) */}
              <div
                className="absolute left-0 flex w-full cursor-ns-resize items-center"
                style={{ top: cutLineTop - 7, height: 14, touchAction: 'none' }}
                onPointerDown={(e) => startDrag('cut', e)}
                title="드래그: 자르는 선"
              >
                <div className="h-0 w-full border-t-2 border-dashed border-amber-300" />
                <span className="absolute left-1 -top-2 rounded bg-amber-500 px-1 text-[9px] font-medium text-white">자르기</span>
              </div>
            </>
          )}
        </div>

        {/* 컨트롤 */}
        <div className="flex min-w-[180px] flex-1 flex-col gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-neutral-400">A ↔ B 겹쳐보기 (정렬 확인)</span>
            <input type="range" min={0} max={1} step={0.02} value={blend} onChange={(e) => setBlend(parseFloat(e.target.value))} />
          </label>

          <div className="flex items-center gap-1">
            <span className="w-16 text-emerald-400">정렬 {seam.advance}px</span>
            {[-5, -1, 1, 5].map((d) => (
              <button key={d} className="btn-nudge" onClick={() => nudge('advance', d)}>
                {d > 0 ? `+${d}` : d}
              </button>
            ))}
            {seam.overridden && (
              <button className="btn-nudge text-sky-400" onClick={() => onResetAdvance(i)} title="자동 정렬값으로">
                자동
              </button>
            )}
          </div>

          <div className="flex items-center gap-1">
            <span className="w-16 text-amber-300">자르기 {seam.cut}px</span>
            {[-5, -1, 1, 5].map((d) => (
              <button key={d} className="btn-nudge" onClick={() => nudge('cut', d)}>
                {d > 0 ? `+${d}` : d}
              </button>
            ))}
            {seam.cutOverridden && (
              <button className="btn-nudge text-sky-400" onClick={() => onResetCut(i)} title="기본(밴드 끝)으로">
                기본
              </button>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-neutral-500">
            확대 뷰를 세로로 드래그하면 두 이미지의 <b className="text-emerald-400">정렬</b>이 맞춰집니다(잔상이 사라지면 정확).
            점선을 드래그하면 <b className="text-amber-300">자르는 선</b>이 이동해, 겹치는 플로팅 UI를 피할 수 있습니다.
          </p>
        </div>
      </div>
    </div>
  )
}
