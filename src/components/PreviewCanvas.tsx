import { useEffect, useRef } from 'react'
import type { Shot } from '../lib/types'
import { renderRange, type Layout } from '../lib/compose'

interface Props {
  shots: Shot[]
  layout: Layout | null
  selectedSeam: number | null
  onSelectSeam: (i: number) => void
}

const DISPLAY_W = 320
const MAX_PREVIEW_H = 15000

export default function PreviewCanvas({ shots, layout, selectedSeam, onSelectSeam }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scale = layout ? Math.min(DISPLAY_W / layout.width, MAX_PREVIEW_H / layout.height, 1) : 1

  useEffect(() => {
    if (!layout || !canvasRef.current) return
    renderRange(shots, layout, canvasRef.current, 0, layout.height, scale)
  }, [shots, layout, scale])

  if (!layout) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-neutral-500">
        왼쪽에서 스크린샷을 추가하면 이어붙인 결과가 여기에 표시됩니다.
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative inline-block select-none">
        <canvas ref={canvasRef} className="block rounded border border-neutral-700 shadow-lg" />
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
                selectedSeam === i ? 'bg-amber-400' : 'bg-sky-400/40 group-hover:bg-sky-300'
              }`}
            />
          </button>
        ))}
      </div>
      <div className="text-[11px] text-neutral-500">
        출력 {layout.width}×{layout.height}px
      </div>
    </div>
  )
}
