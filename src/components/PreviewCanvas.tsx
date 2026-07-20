import { useEffect, useMemo, useRef, useState } from 'react'
import type { Shot } from '../lib/types'
import { renderRange, type Layout } from '../lib/compose'

interface Props {
  shots: Shot[]
  layout: Layout | null
  selectedSeam: number | null
  onSelectSeam: (i: number) => void
  hoverShot: number | null
  onHoverShot: (i: number | null) => void
}

const DISPLAY_W = 340
const MAX_PREVIEW_H = 16000

interface HoverInfo {
  region: 'header' | 'footer' | 'content'
  active: number // shot index
  bands: { shot: number; y0: number; y1: number; primary: boolean }[] // 출력 좌표
  label: string
}

export default function PreviewCanvas({ shots, layout, selectedSeam, onSelectSeam, hoverShot, onHoverShot }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pointerOut, setPointerOut] = useState<number | null>(null) // 포인터가 가리키는 출력 y
  const scale = layout ? Math.min(DISPLAY_W / layout.width, MAX_PREVIEW_H / layout.height, 1) : 1

  useEffect(() => {
    if (!layout || !canvasRef.current) return
    renderRange(shots, layout, canvasRef.current, 0, layout.height, scale)
  }, [shots, layout, scale])

  // 포인터가 가리키는 출력 y로부터 활성/겹침 이미지·헤더·푸터 계산
  const pointerHover = useMemo<HoverInfo | null>(() => {
    if (!layout || pointerOut == null) return null
    return hoverInfoAt(layout, pointerOut)
  }, [layout, pointerOut])

  // 리스트에서 온 hoverShot을 예비 표시로 사용(포인터 호버가 우선)
  const shownHover = useMemo<HoverInfo | null>(() => {
    if (pointerHover) return pointerHover
    if (layout && hoverShot != null && hoverShot < layout.placements.length) {
      const pl = layout.placements[hoverShot]
      return {
        region: 'content',
        active: hoverShot,
        bands: [{ shot: hoverShot, y0: layout.headerH + pl.cStart, y1: layout.headerH + pl.cStart + pl.band, primary: true }],
        label: `이미지 ${hoverShot + 1}`,
      }
    }
    return null
  }, [pointerHover, layout, hoverShot])

  // 포인터 호버 시 리스트로 동기화
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
    const rect = canvasRef.current!.getBoundingClientRect()
    setPointerOut((e.clientY - rect.top) / scale)
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative inline-block select-none"
        onPointerMove={onMove}
        onPointerLeave={() => {
          setPointerOut(null)
          onHoverShot(null)
        }}
      >
        <canvas ref={canvasRef} className="block rounded border border-neutral-700 shadow-lg" />

        {/* 호버 오버레이: 겹침(낮은 우선순위) 밴드 먼저, 활성 밴드 위에 */}
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
                shownHover.region === 'content'
                  ? 'border-x-sky-400 bg-sky-400/10'
                  : 'border-x-amber-400 bg-amber-400/10'
              }`}
              style={{ top: b.y0 * scale, height: (b.y1 - b.y0) * scale }}
            >
              <span className="absolute left-1 top-1 rounded bg-neutral-900/80 px-1.5 py-0.5 text-[10px] font-medium text-neutral-100">
                {shownHover.label}
              </span>
            </div>
          ))}

        {/* 이음새 마커 */}
        {layout.seamYs.map((sy, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSelectSeam(i)}
            title={`이음새 ${i + 1}`}
            className="group absolute left-0 flex w-full items-center"
            style={{ top: sy * scale - 6, height: 12 }}
          >
            <span
              className={`h-px w-full ${
                selectedSeam === i ? 'bg-amber-400' : 'bg-sky-400/30 group-hover:bg-sky-300'
              }`}
            />
          </button>
        ))}
      </div>
      <div className="text-[11px] text-neutral-500">
        출력 {layout.width}×{layout.height}px · 마우스를 올리면 어느 이미지 영역인지 표시됩니다
      </div>
    </div>
  )
}

// 출력 y에서 활성/겹침 이미지, 헤더/푸터 판정
function hoverInfoAt(layout: Layout, outY: number): HoverInfo | null {
  const { headerH, footerH, height, placements } = layout
  if (outY < 0 || outY > height) return null
  if (headerH > 0 && outY < headerH) {
    return { region: 'header', active: placements[0]?.shotIndex ?? 0, bands: [{ shot: 0, y0: 0, y1: headerH, primary: true }], label: '고정 헤더 (한 번만 포함)' }
  }
  if (footerH > 0 && outY >= height - footerH) {
    const last = placements.length - 1
    return { region: 'footer', active: last, bands: [{ shot: last, y0: height - footerH, y1: height, primary: true }], label: '고정 푸터 (한 번만 포함)' }
  }
  const p = outY - headerH
  const covering = placements.filter((pl) => pl.cStart <= p && p < pl.cStart + pl.band)
  if (!covering.length) return null
  // 활성 = 이 콘텐츠를 가장 중앙에 담은 장(합성에서 실제로 주로 쓰인 소스)
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
  }
}
