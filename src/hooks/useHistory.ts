import { useCallback, useRef, useState } from 'react'

const HISTORY_MAX = 60

interface HistState<T> {
  past: T[]
  present: T
  future: T[]
}

export interface History<T> {
  present: T
  ref: React.MutableRefObject<T> // 콜백에서 최신 값을 동기 참조
  canUndo: boolean
  canRedo: boolean
  // 되돌리기 지점을 남기며 상태 변경
  commit: (updater: (prev: T) => T) => void
  // 되돌리기 지점 없이 상태 변경(파생/실시간 갱신)
  update: (updater: (prev: T) => T) => void
  // 인터랙션(드래그 등) 시작: 현재 상태를 base로 반환
  beginTx: () => T
  // 인터랙션 종료: base를 되돌리기 지점으로 커밋(변화가 있었을 때만)
  endTx: (base: T) => void
  undo: () => void
  redo: () => void
}

// 단일 Doc 상태에 대한 실행취소/다시실행 관리. present는 렌더용 state이자 ref로도 노출.
export function useHistory<T>(initial: T): History<T> {
  const [hist, setHist] = useState<HistState<T>>({ past: [], present: initial, future: [] })
  const ref = useRef<T>(initial)
  ref.current = hist.present

  const commit = useCallback((updater: (prev: T) => T) => {
    setHist((h) => {
      const next = updater(h.present)
      if (next === h.present) return h
      return { past: [...h.past, h.present].slice(-HISTORY_MAX), present: next, future: [] }
    })
  }, [])

  const update = useCallback((updater: (prev: T) => T) => {
    setHist((h) => {
      const next = updater(h.present)
      if (next === h.present) return h
      return { ...h, present: next }
    })
  }, [])

  const beginTx = useCallback(() => ref.current, [])

  const endTx = useCallback((base: T) => {
    setHist((h) => {
      if (h.present === base) return h
      return { past: [...h.past, base].slice(-HISTORY_MAX), present: h.present, future: [] }
    })
  }, [])

  const undo = useCallback(() => {
    setHist((h) => {
      if (!h.past.length) return h
      const prev = h.past[h.past.length - 1]
      return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future].slice(0, HISTORY_MAX) }
    })
  }, [])

  const redo = useCallback(() => {
    setHist((h) => {
      if (!h.future.length) return h
      const next = h.future[0]
      return { past: [...h.past, h.present].slice(-HISTORY_MAX), present: next, future: h.future.slice(1) }
    })
  }, [])

  return {
    present: hist.present,
    ref,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
    commit,
    update,
    beginTx,
    endTx,
    undo,
    redo,
  }
}
