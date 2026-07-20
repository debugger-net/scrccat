import { useEffect, useRef, useState } from 'react'
import type { Shot } from '../lib/types'

interface Props {
  first: Shot
  top: number
  bottom: number
  onChange: (top: number, bottom: number) => void
}

const VIEW_W = 200

// 첫 이미지 위에 상/하단 고정 영역을 드래그 핸들과 숫자 입력으로 지정한다.
export default function FixedRegionEditor({ first, top, bottom, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drag, setDrag] = useState<null | 'top' | 'bottom'>(null)
  const scale = VIEW_W / first.width
  const viewH = first.height * scale

  // 드래그 중 최신 값 참조 (리스너 재구독 없이)
  const stateRef = useRef({ scale, height: first.height, top, bottom, onChange })
  stateRef.current = { scale, height: first.height, top, bottom, onChange }

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = VIEW_W
    c.height = Math.round(viewH)
    const ctx = c.getContext('2d')!
    ctx.drawImage(first.bitmap, 0, 0, VIEW_W, viewH)
  }, [first, viewH])

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const st = stateRef.current
      const rect = canvasRef.current!.getBoundingClientRect()
      const yImg = Math.round((e.clientY - rect.top) / st.scale)
      const clamped = Math.max(0, Math.min(st.height, yImg))
      if (drag === 'top') {
        onChange(Math.min(clamped, st.height - st.bottom - 10), st.bottom)
      } else {
        onChange(st.top, Math.max(0, Math.min(st.height - clamped, st.height - st.top - 10)))
      }
    }
    const up = () => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, onChange])

  const topY = top * scale
  const botY = viewH - bottom * scale

  return (
    <div className="space-y-2">
      <div className="relative inline-block select-none" style={{ width: VIEW_W }}>
        <canvas ref={canvasRef} className="block rounded border border-neutral-700" />
        <div
          className="pointer-events-none absolute left-0 top-0 w-full bg-sky-500/25"
          style={{ height: topY }}
        />
        <div
          className="pointer-events-none absolute left-0 w-full bg-emerald-500/25"
          style={{ top: botY, height: bottom * scale }}
        />
        <Handle color="sky" y={topY} onDown={() => setDrag('top')} />
        <Handle color="emerald" y={botY} onDown={() => setDrag('bottom')} />
      </div>
      <div className="flex gap-3 text-xs">
        <label className="flex items-center gap-1">
          <span className="text-sky-400">상단</span>
          <input
            type="number"
            className="input-num"
            value={top}
            onChange={(e) => onChange(clampNum(e.target.value, 0, first.height - bottom - 10), bottom)}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-emerald-400">하단</span>
          <input
            type="number"
            className="input-num"
            value={bottom}
            onChange={(e) => onChange(top, clampNum(e.target.value, 0, first.height - top - 10))}
          />
        </label>
      </div>
    </div>
  )
}

function Handle({ color, y, onDown }: { color: 'sky' | 'emerald'; y: number; onDown: () => void }) {
  const line = color === 'sky' ? 'bg-sky-400' : 'bg-emerald-400'
  return (
    <div
      className="absolute left-0 flex w-full cursor-ns-resize items-center"
      style={{ top: y - 5, height: 10 }}
      onPointerDown={onDown}
    >
      <div className={`h-0.5 w-full ${line}`} />
    </div>
  )
}

function clampNum(v: string, min: number, max: number): number {
  const n = parseInt(v || '0', 10)
  if (Number.isNaN(n)) return min
  return Math.max(min, Math.min(max, n))
}
