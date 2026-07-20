import { useEffect, useRef, useState } from 'react'
import type { Shot } from '../lib/types'

interface Props {
  shots: Shot[]
  onReorder: (newOrder: number[]) => void // newOrder[newPos] = 기존 표시위치
  onRemove: (i: number) => void
  onSortByName: () => void
  sortDir: 1 | -1 | 0
  hoverShot: number | null
  onHoverShot: (i: number | null) => void
  disabled?: boolean
}

interface DragState {
  fromPos: number
  grabOffset: number // 아이템 내부에서 잡은 y 위치
  containerTop: number
  slotPitch: number
  pointerY: number
  targetPos: number
}

export default function ImageList({
  shots,
  onReorder,
  onRemove,
  onSortByName,
  sortDir,
  hoverShot,
  onHoverShot,
  disabled,
}: Props) {
  const listRef = useRef<HTMLUListElement>(null)
  const itemRefs = useRef<(HTMLLIElement | null)[]>([])
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag
  const dragging = drag != null

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      const list = listRef.current
      if (!d || !list) return
      const containerTop = list.getBoundingClientRect().top // 스크롤에도 안전하게 매 이동 갱신
      const relTop = e.clientY - d.grabOffset - containerTop
      const targetPos = Math.max(0, Math.min(shots.length - 1, Math.round(relTop / d.slotPitch)))
      setDrag({ ...d, pointerY: e.clientY, targetPos, containerTop })
    }
    const up = () => {
      const d = dragRef.current
      if (d && d.targetPos !== d.fromPos) {
        const order = shots.map((_, i) => i)
        const [moved] = order.splice(d.fromPos, 1)
        order.splice(d.targetPos, 0, moved)
        onReorder(order)
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [dragging, shots, onReorder])

  const startDrag = (pos: number, e: React.PointerEvent) => {
    if (disabled || shots.length < 2) return
    e.preventDefault()
    const list = listRef.current
    const el = itemRefs.current[pos]
    if (!list || !el) return
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    } catch {
      /* noop */
    }
    const rect = el.getBoundingClientRect()
    const containerTop = list.getBoundingClientRect().top
    // 슬롯 간격: 인접 두 아이템의 offsetTop 차이(없으면 자기 높이+간격)
    const a = itemRefs.current[0]
    const b = itemRefs.current[1]
    const slotPitch = a && b ? b.offsetTop - a.offsetTop : rect.height + 8
    setDrag({
      fromPos: pos,
      grabOffset: e.clientY - rect.top,
      containerTop,
      slotPitch,
      pointerY: e.clientY,
      targetPos: pos,
    })
  }

  if (!shots.length) return null

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-0.5 text-[11px] text-neutral-500">
        <span>이미지 {shots.length}장 · 위→아래 순서</span>
        <button
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-40"
          onClick={onSortByName}
          disabled={disabled}
          title="파일명 순으로 정렬 (다시 누르면 역순)"
        >
          파일명순 {sortDir === 1 ? '↓' : sortDir === -1 ? '↑' : '⇅'}
        </button>
      </div>
      <ul ref={listRef} className="relative space-y-2">
        {shots.map((s, pos) => {
          const isDragged = drag?.fromPos === pos
          let translateY = 0
          let transition = 'transform 160ms cubic-bezier(0.2,0,0,1)'
          if (drag) {
            if (isDragged) {
              translateY = drag.pointerY - drag.grabOffset - (drag.containerTop + pos * drag.slotPitch)
              transition = 'none'
            } else if (drag.fromPos < drag.targetPos && pos > drag.fromPos && pos <= drag.targetPos) {
              translateY = -drag.slotPitch
            } else if (drag.fromPos > drag.targetPos && pos < drag.fromPos && pos >= drag.targetPos) {
              translateY = drag.slotPitch
            }
          }
          const highlighted = hoverShot === pos
          return (
            <li
              key={s.id}
              ref={(el) => (itemRefs.current[pos] = el)}
              onPointerEnter={() => !drag && onHoverShot(pos)}
              onPointerLeave={() => !drag && onHoverShot(null)}
              style={{
                transform: translateY ? `translateY(${translateY}px)` : undefined,
                transition,
                zIndex: isDragged ? 50 : undefined,
                position: 'relative',
              }}
              className={`flex items-center gap-2 rounded-md border bg-neutral-800/60 p-2 ${
                isDragged
                  ? 'border-x-2 border-x-sky-400 border-y-neutral-600 shadow-xl shadow-black/50'
                  : highlighted
                    ? 'border-sky-400/70 ring-1 ring-sky-400/40'
                    : 'border-neutral-700'
              }`}
            >
              {/* 드래그 핸들 (모바일에서도 잡기 쉬운 넓은 히트영역) */}
              <button
                className="shrink-0 cursor-grab touch-none select-none rounded px-0.5 text-neutral-500 hover:text-neutral-200 active:cursor-grabbing disabled:opacity-30"
                style={{ touchAction: 'none' }}
                onPointerDown={(e) => startDrag(pos, e)}
                disabled={disabled || shots.length < 2}
                title="드래그해서 순서 변경"
                aria-label="드래그 핸들"
              >
                <GripIcon />
              </button>
              <span className="w-4 shrink-0 text-center text-xs tabular-nums text-neutral-400">{pos + 1}</span>
              <Thumbnail shot={s} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-neutral-200" title={s.name}>
                  {s.name}
                </div>
                <div className="text-[11px] text-neutral-500">
                  {s.width}×{s.height}
                </div>
              </div>
              <button
                className="btn-icon shrink-0 text-red-400 hover:bg-red-500/20"
                onClick={() => onRemove(pos)}
                disabled={disabled}
                title="삭제"
              >
                ✕
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function GripIcon() {
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden>
      {[3, 9, 15].map((cy) =>
        [4, 10].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.5" />),
      )}
    </svg>
  )
}

function Thumbnail({ shot }: { shot: Shot }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const w = 30
    const h = Math.min(72, Math.round((shot.height / shot.width) * w))
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')!
    ctx.drawImage(shot.bitmap, 0, 0, w, h)
  }, [shot])
  return <canvas ref={ref} className="shrink-0 rounded border border-neutral-700" />
}
