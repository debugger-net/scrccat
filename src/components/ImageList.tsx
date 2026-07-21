import { useEffect, useRef, useState } from 'react'
import type { Shot } from '../lib/types'

interface Props {
  shots: Shot[]
  onReorder: (newOrder: number[]) => void // newOrder[newPos] = 기존 표시위치
  onRemove: (i: number) => void
  onSortByName: () => void
  onDropFiles: (files: File[], index: number) => void // 특정 위치에 파일 추가
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

interface Pending {
  pos: number
  grabOffset: number
  containerTop: number
  slotPitch: number
  startY: number
}

const DRAG_THRESH = 4 // 이 픽셀 이상 움직여야 드래그 시작(클릭·터치 스크롤과 구분)

export default function ImageList({
  shots,
  onReorder,
  onRemove,
  onSortByName,
  onDropFiles,
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
  const pendingRef = useRef<Pending | null>(null)
  const [interacting, setInteracting] = useState(false)
  const [dropIndex, setDropIndex] = useState<number | null>(null) // 파일 드롭 삽입 위치

  useEffect(() => {
    if (!interacting) return
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      const list = listRef.current
      if (d) {
        if (!list) return
        const containerTop = list.getBoundingClientRect().top
        const relTop = e.clientY - d.grabOffset - containerTop
        const targetPos = Math.max(0, Math.min(shots.length - 1, Math.round(relTop / d.slotPitch)))
        setDrag({ ...d, pointerY: e.clientY, targetPos, containerTop })
      } else {
        const pend = pendingRef.current
        if (!pend) return
        if (Math.abs(e.clientY - pend.startY) > DRAG_THRESH) {
          setDrag({
            fromPos: pend.pos,
            grabOffset: pend.grabOffset,
            containerTop: pend.containerTop,
            slotPitch: pend.slotPitch,
            pointerY: e.clientY,
            targetPos: pend.pos,
          })
        }
      }
    }
    const up = () => {
      const d = dragRef.current
      if (d && d.targetPos !== d.fromPos) {
        const order = shots.map((_, i) => i)
        const [moved] = order.splice(d.fromPos, 1)
        order.splice(d.targetPos, 0, moved)
        onReorder(order)
      }
      pendingRef.current = null
      setDrag(null)
      setInteracting(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [interacting, shots, onReorder])

  // 바 전체에서 드래그 시작. 버튼(삭제·이동)은 제외. 터치는 그립으로만(리스트 스크롤 보존).
  const onBarPointerDown = (pos: number, e: React.PointerEvent) => {
    if (disabled || shots.length < 2) return
    const target = e.target as HTMLElement
    if (target.closest('button')) return
    const onGrip = !!target.closest('[data-grip]')
    if (e.pointerType === 'touch' && !onGrip) return
    const list = listRef.current
    const el = itemRefs.current[pos]
    if (!list || !el) return
    e.preventDefault()
    const rect = el.getBoundingClientRect()
    const a = itemRefs.current[0]
    const b = itemRefs.current[1]
    const slotPitch = a && b ? b.offsetTop - a.offsetTop : rect.height + 8
    pendingRef.current = {
      pos,
      grabOffset: e.clientY - rect.top,
      containerTop: list.getBoundingClientRect().top,
      slotPitch,
      startY: e.clientY,
    }
    setInteracting(true)
  }

  // 한 칸/맨 끝 이동
  const move = (pos: number, to: 'up' | 'down' | 'top' | 'bottom') => {
    if (shots.length < 2) return
    const order = shots.map((_, i) => i)
    const [m] = order.splice(pos, 1)
    const dest =
      to === 'top' ? 0 : to === 'bottom' ? order.length : to === 'up' ? Math.max(0, pos - 1) : Math.min(order.length, pos + 1)
    if (dest === pos) return
    order.splice(dest, 0, m)
    onReorder(order)
  }

  // 파일 드롭: 포인터 Y로 삽입 index 계산(아이템 중점 기준)
  const computeDropIndex = (clientY: number): number => {
    const refs = itemRefs.current
    let idx = shots.length
    for (let i = 0; i < shots.length; i++) {
      const el = refs[i]
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (clientY < r.top + r.height / 2) {
        idx = i
        break
      }
    }
    return idx
  }

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  if (!shots.length) return null

  const dropLineTop = (() => {
    if (dropIndex == null) return null
    const refs = itemRefs.current
    if (dropIndex < shots.length) {
      const el = refs[dropIndex]
      return el ? el.offsetTop - 4 : null
    }
    const el = refs[shots.length - 1]
    return el ? el.offsetTop + el.offsetHeight + 2 : null
  })()

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
      <ul
        ref={listRef}
        className="relative space-y-2"
        onDragOver={(e) => {
          if (!hasFiles(e) || disabled) return
          e.preventDefault()
          setDropIndex(computeDropIndex(e.clientY))
        }}
        onDragLeave={(e) => {
          // 리스트 바깥으로 나갈 때만 해제(자식 간 이동은 무시)
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          setDropIndex(null)
        }}
        onDrop={(e) => {
          if (!hasFiles(e) || disabled) return
          e.preventDefault()
          const at = computeDropIndex(e.clientY)
          setDropIndex(null)
          const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
          if (files.length) onDropFiles(files, at)
        }}
      >
        {dropLineTop != null && (
          <div className="pointer-events-none absolute left-0 z-10 h-0.5 w-full rounded bg-sky-400" style={{ top: dropLineTop }}>
            <span className="absolute -top-2 left-1 rounded bg-sky-500 px-1 text-[9px] font-medium text-white">여기에 추가</span>
          </div>
        )}
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
          const last = shots.length - 1
          return (
            <li
              key={s.id}
              ref={(el) => (itemRefs.current[pos] = el)}
              onPointerDown={(e) => onBarPointerDown(pos, e)}
              onPointerEnter={() => !drag && onHoverShot(pos)}
              onPointerLeave={() => !drag && onHoverShot(null)}
              style={{
                transform: translateY ? `translateY(${translateY}px)` : undefined,
                transition,
                zIndex: isDragged ? 50 : undefined,
                position: 'relative',
                touchAction: 'pan-y',
              }}
              className={`group flex select-none items-center gap-2 rounded-md border bg-neutral-800/60 p-2 ${
                shots.length > 1 ? 'cursor-grab active:cursor-grabbing' : ''
              } ${
                isDragged
                  ? 'border-x-2 border-x-sky-400 border-y-neutral-600 shadow-xl shadow-black/50'
                  : highlighted
                    ? 'border-sky-400/70 ring-1 ring-sky-400/40'
                    : 'border-neutral-700'
              }`}
            >
              {/* 드래그 핸들(터치 어포던스). 바 전체가 드래그 가능하지만 터치는 이 핸들로만. */}
              <span
                data-grip
                className="shrink-0 touch-none select-none rounded px-0.5 text-neutral-500 group-hover:text-neutral-300"
                title="드래그해서 순서 변경"
                aria-hidden
              >
                <GripIcon />
              </span>
              <span className="w-4 shrink-0 text-center text-xs tabular-nums text-neutral-400">{pos + 1}</span>
              <Thumbnail shot={s} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-neutral-200" title={s.name}>
                  {s.name}
                </div>
                <div className="flex items-center gap-1 text-[11px] text-neutral-500">
                  <span className="shrink-0">
                    {s.width}×{s.height}
                  </span>
                  {/* 이동 버튼(호버/포커스 시 노출) */}
                  <span className="ml-auto flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    <MoveBtn label="맨 위로" sym="⤒" onClick={() => move(pos, 'top')} disabled={disabled || pos === 0} />
                    <MoveBtn label="한 칸 위로" sym="↑" onClick={() => move(pos, 'up')} disabled={disabled || pos === 0} />
                    <MoveBtn label="한 칸 아래로" sym="↓" onClick={() => move(pos, 'down')} disabled={disabled || pos === last} />
                    <MoveBtn label="맨 아래로" sym="⤓" onClick={() => move(pos, 'bottom')} disabled={disabled || pos === last} />
                  </span>
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

function MoveBtn({ label, sym, onClick, disabled }: { label: string; sym: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="flex h-4 w-4 items-center justify-center rounded text-[11px] leading-none text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100 disabled:opacity-25 disabled:hover:bg-transparent"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {sym}
    </button>
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
  return <canvas ref={ref} className="pointer-events-none shrink-0 rounded border border-neutral-700" />
}
