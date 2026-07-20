import { useEffect, useRef } from 'react'
import type { Shot } from '../lib/types'

interface Props {
  shots: Shot[]
  onMove: (i: number, dir: -1 | 1) => void
  onRemove: (i: number) => void
}

export default function ImageList({ shots, onMove, onRemove }: Props) {
  if (!shots.length) return null
  return (
    <ul className="space-y-2">
      {shots.map((s, i) => (
        <li
          key={s.id}
          className="flex items-center gap-2 rounded border border-neutral-700 bg-neutral-800/50 p-2"
        >
          <span className="w-4 shrink-0 text-center text-xs text-neutral-400">{i + 1}</span>
          <Thumbnail shot={s} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs text-neutral-200" title={s.name}>
              {s.name}
            </div>
            <div className="text-[11px] text-neutral-500">
              {s.width}×{s.height}
            </div>
          </div>
          <div className="flex flex-col">
            <button className="btn-icon" onClick={() => onMove(i, -1)} disabled={i === 0} title="위로">
              ↑
            </button>
            <button
              className="btn-icon"
              onClick={() => onMove(i, 1)}
              disabled={i === shots.length - 1}
              title="아래로"
            >
              ↓
            </button>
          </div>
          <button
            className="btn-icon text-red-400 hover:bg-red-500/20"
            onClick={() => onRemove(i)}
            title="삭제"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  )
}

function Thumbnail({ shot }: { shot: Shot }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const w = 32
    const h = Math.min(80, Math.round((shot.height / shot.width) * w))
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')!
    ctx.drawImage(shot.bitmap, 0, 0, w, h)
  }, [shot])
  return <canvas ref={ref} className="shrink-0 rounded border border-neutral-700" />
}
