import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Doc } from './lib/types'
import { loadShot } from './lib/imageLoad'
import { computeOverlay, detectFixedBands, type OverlayInfo } from './lib/overlay'
import { detectAllSeams, reconcileSeams, clampAdvance } from './lib/stitch'
import { orderShots, isIdentityOrder } from './lib/order'
import { computeLayout } from './lib/compose'
import { downloadStitched } from './lib/download'
import { useHistory } from './hooks/useHistory'
import DropZone from './components/DropZone'
import ImageList from './components/ImageList'
import FixedRegionEditor from './components/FixedRegionEditor'
import SeamControls from './components/SeamControls'
import PreviewCanvas from './components/PreviewCanvas'

const EMPTY_OVERLAY: OverlayInfo = { mask: new Uint8Array(0), composeMask: new Uint8Array(0), H: 0, W: 48 }

const INITIAL: Doc = {
  shots: [],
  top: 0,
  bottom: 0,
  seams: [],
  includeHeader: true,
  includeFooter: false,
  cleanOverlays: true,
  fixedTouched: false,
}

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

export default function App() {
  const history = useHistory<Doc>(INITIAL)
  const doc = history.present

  const [autoOrder, setAutoOrder] = useState(true)
  const [sortDir, setSortDir] = useState<0 | 1 | -1>(0)
  const [selectedSeam, setSelectedSeam] = useState<number | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [hoverShot, setHoverShot] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const runningRef = useRef(false) // 동기 재진입 잠금(busy state는 렌더 지연이 있어 별도)
  const autoOrderRef = useRef(autoOrder)
  autoOrderRef.current = autoOrder
  const jobGen = useRef(0)
  const fixedTxBase = useRef<Doc | null>(null)

  const notify = useCallback((m: string) => {
    setMessage(m)
    window.clearTimeout((notify as unknown as { t?: number }).t)
    ;(notify as unknown as { t?: number }).t = window.setTimeout(() => setMessage(null), 4000)
  }, [])

  // 오버레이 마스크: 이미지 "집합"에서 파생(순서 무관). 집합이 바뀔 때만 재계산.
  // key를 정렬된 id 목록으로 두어 드래그 재정렬(순서만 변경)에서는 재계산하지 않는다.
  const overlayKey = useMemo(() => doc.shots.map((s) => s.id).slice().sort().join('|'), [doc.shots])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const overlay = useMemo(() => (doc.shots.length >= 2 ? computeOverlay(doc.shots) : EMPTY_OVERLAY), [overlayKey])
  const overlayRef = useRef<OverlayInfo>(overlay)
  overlayRef.current = overlay

  const setBusyState = (b: boolean, label = '') => {
    setBusy(b)
    setBusyLabel(label)
  }

  // ---- 무거운 처리(고정영역 감지 + 자동 정렬): 취소 가능 + 재진입 금지 ----
  async function processInto(shots: Doc['shots'], reorder: boolean, gen: number) {
    if (shots.length < 2) {
      history.update((d) => ({ ...d, shots, seams: [] }))
      return
    }
    const ov = computeOverlay(shots)
    if (jobGen.current !== gen) return
    const cur = history.ref.current
    let top = cur.top
    let bottom = cur.bottom
    if (!cur.fixedTouched) {
      const fb = detectFixedBands(ov)
      top = fb.top
      bottom = fb.bottom
    }
    let ordered = shots
    let reordered = false
    if (reorder) {
      const order = orderShots(shots, ov.mask, top, bottom)
      reordered = !isIdentityOrder(order)
      ordered = order.map((i) => shots[i])
    }
    if (jobGen.current !== gen) return
    const seams = detectAllSeams(ordered, ov.mask, top, bottom)
    history.update((d) => ({ ...d, shots: ordered, top, bottom, seams }))
    return reordered
  }

  const addFiles = useCallback(
    async (files: File[]) => {
      if (runningRef.current) {
        notify('처리 중입니다. 잠시 후 다시 시도하세요.')
        return
      }
      runningRef.current = true
      const gen = ++jobGen.current
      setBusyState(true, '이미지 불러오는 중…')
      const base = history.beginTx()
      try {
        const loaded = await Promise.all(files.map(loadShot))
        if (jobGen.current !== gen) return
        const merged = [...history.ref.current.shots, ...loaded]
        history.update((d) => ({ ...d, shots: merged }))
        setBusyState(true, '순서·고정영역 분석 중…')
        await raf()
        if (jobGen.current !== gen) return
        await processInto(merged, autoOrderRef.current, gen)
        history.endTx(base)
        notify(`${loaded.length}장 추가${autoOrderRef.current && merged.length >= 2 ? ' · 순서 자동 정렬' : ''}`)
      } catch {
        history.endTx(base)
        notify('이미지를 불러오지 못했습니다.')
      } finally {
        runningRef.current = false
        if (jobGen.current === gen) setBusyState(false)
      }
    },
    [history, notify],
  )

  const reprocess = useCallback(async () => {
    if (runningRef.current) {
      notify('처리 중입니다. 완료 후 다시 시도하세요.')
      return
    }
    if (history.ref.current.shots.length < 2) return
    runningRef.current = true
    const gen = ++jobGen.current
    setBusyState(true, '순서 다시 분석 중…')
    const base = history.beginTx()
    try {
      await raf()
      if (jobGen.current !== gen) return
      const reordered = await processInto(history.ref.current.shots, true, gen)
      history.endTx(base)
      setSortDir(0)
      notify(reordered ? '순서를 다시 정렬했습니다.' : '이미 올바른 순서입니다.')
    } finally {
      runningRef.current = false
      if (jobGen.current === gen) setBusyState(false)
    }
  }, [history, notify])

  // ---- 드래그로 수동 재정렬 (즉시, 되돌리기 지점 1개) ----
  const onReorder = useCallback(
    (newOrder: number[]) => {
      history.commit((d) => {
        const shots = newOrder.map((i) => d.shots[i])
        const seams = reconcileSeams(shots, d.shots, d.seams, overlayRef.current.mask, d.top, d.bottom)
        return { ...d, shots, seams }
      })
      setSortDir(0)
      notify('순서를 변경했습니다.')
    },
    [history, notify],
  )

  const onSortByName = useCallback(() => {
    if (history.ref.current.shots.length < 2) return
    const dir: 1 | -1 = sortDir === 1 ? -1 : 1
    setSortDir(dir)
    history.commit((d) => {
      const order = d.shots.map((_, i) => i)
      order.sort((a, b) => dir * d.shots[a].name.localeCompare(d.shots[b].name, undefined, { numeric: true }))
      const shots = order.map((i) => d.shots[i])
      const seams = reconcileSeams(shots, d.shots, d.seams, overlayRef.current.mask, d.top, d.bottom)
      return { ...d, shots, seams }
    })
    notify(dir === 1 ? '파일명 오름차순으로 정렬했습니다.' : '파일명 내림차순으로 정렬했습니다.')
  }, [history, notify, sortDir])

  const onRemove = useCallback(
    (pos: number) => {
      setSelectedSeam(null)
      history.commit((d) => {
        const shots = d.shots.filter((_, k) => k !== pos)
        if (shots.length < 2) {
          return {
            ...d,
            shots,
            seams: [],
            top: shots.length ? d.top : 0,
            bottom: shots.length ? d.bottom : 0,
            fixedTouched: shots.length ? d.fixedTouched : false,
          }
        }
        const mask = computeOverlay(shots).mask
        const seams = detectAllSeams(shots, mask, d.top, d.bottom, d.seams)
        return { ...d, shots, seams }
      })
      notify('이미지를 삭제했습니다.')
    },
    [history, notify],
  )

  const clearAll = useCallback(() => {
    setSelectedSeam(null)
    setSortDir(0)
    history.commit(() => ({ ...INITIAL }))
    notify('모두 지웠습니다.')
  }, [history, notify])

  // ---- 고정 영역 편집 ----
  const onFixedStart = useCallback(() => {
    fixedTxBase.current = history.beginTx()
  }, [history])
  const onFixedChange = useCallback(
    (top: number, bottom: number) => {
      history.update((d) => ({ ...d, top, bottom, fixedTouched: true }))
    },
    [history],
  )
  const onFixedEnd = useCallback(() => {
    history.update((d) => ({ ...d, seams: detectAllSeams(d.shots, overlayRef.current.mask, d.top, d.bottom, d.seams) }))
    if (fixedTxBase.current) {
      history.endTx(fixedTxBase.current)
      fixedTxBase.current = null
    }
  }, [history])

  // ---- 이음새 조정 ----
  const nudgeSeam = useCallback(
    (i: number, delta: number) => {
      history.commit((d) => ({
        ...d,
        seams: d.seams.map((s, k) =>
          k === i
            ? { ...s, advance: clampAdvance(s.advance + delta, d.shots[i + 1], d.top, d.bottom), overridden: true }
            : s,
        ),
      }))
      setSelectedSeam(i)
    },
    [history],
  )
  const resetSeam = useCallback(
    (i: number) => {
      history.commit((d) => ({
        ...d,
        seams: d.seams.map((s, k) => (k === i ? { ...s, advance: s.auto, overridden: false } : s)),
      }))
    },
    [history],
  )

  const toggle = useCallback(
    (key: 'includeHeader' | 'includeFooter' | 'cleanOverlays', v: boolean) => {
      history.commit((d) => ({ ...d, [key]: v }))
    },
    [history],
  )

  // ---- 실행취소 / 다시실행 ----
  const undo = useCallback(() => {
    if (runningRef.current || !history.canUndo) return
    history.undo()
    setSelectedSeam(null)
    notify('실행취소')
  }, [history, notify])
  const redo = useCallback(() => {
    if (runningRef.current || !history.canRedo) return
    history.redo()
    setSelectedSeam(null)
    notify('다시실행')
  }, [history, notify])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const key = e.key.toLowerCase()
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const layout = useMemo(() => {
    if (doc.shots.length === 0) return null
    return computeLayout(doc.shots, {
      top: doc.top,
      bottom: doc.bottom,
      seams: doc.seams,
      includeHeader: doc.includeHeader,
      includeFooter: doc.includeFooter,
      cleanOverlays: doc.cleanOverlays,
      composeMask: overlay.composeMask,
      maskH: overlay.H,
    })
  }, [doc, overlay])

  const doExport = useCallback(async () => {
    if (!layout || runningRef.current) return
    runningRef.current = true
    setBusyState(true, '내보내는 중…')
    try {
      const n = await downloadStitched(doc.shots, layout)
      notify(n > 1 ? `완료 · ${n}개 파일로 저장했습니다.` : '완료 · PNG로 저장했습니다.')
    } catch {
      notify('내보내기에 실패했습니다.')
    } finally {
      runningRef.current = false
      setBusyState(false)
    }
  }, [doc.shots, layout, notify])

  const lowConfidence = doc.seams.some((s) => s.confidence < 0.33)
  const tiles = layout ? Math.ceil(layout.height / 16384) : 1

  return (
    <div className="flex h-screen flex-col bg-neutral-900 text-neutral-100">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <h1 className="text-sm font-semibold">🐈‍⬛ Scrccat</h1>
        <span className="hidden text-xs text-neutral-500 sm:inline">스크롤 스크린샷 이어붙이기</span>
        <div className="ml-2 flex items-center gap-1">
          <button className="btn-icon" onClick={undo} disabled={!history.canUndo || busy} title="실행취소 (Ctrl/Cmd+Z)">
            ↶
          </button>
          <button className="btn-icon" onClick={redo} disabled={!history.canRedo || busy} title="다시실행 (Ctrl/Cmd+Shift+Z)">
            ↷
          </button>
        </div>
        {busy && (
          <span className="flex items-center gap-1.5 text-xs text-sky-400">
            <Spinner /> {busyLabel || '처리 중…'}
          </span>
        )}
        {!busy && message && <span className="text-xs text-emerald-400">{message}</span>}
        <span className="ml-auto hidden text-[11px] text-neutral-600 md:inline">
          모든 처리는 브라우저 안에서 · 업로드 없음
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 좌측: 이미지 목록 */}
        <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-neutral-800 p-3">
          <DropZone onFiles={addFiles} />
          {doc.shots.length > 0 && (
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={autoOrder} onChange={(e) => setAutoOrder(e.target.checked)} />
                추가 시 자동 정렬
              </label>
              <div className="flex gap-2">
                <button className="hover:text-neutral-300 disabled:opacity-40" onClick={reprocess} disabled={busy || doc.shots.length < 2}>
                  정렬 다시
                </button>
                <button className="hover:text-red-400 disabled:opacity-40" onClick={clearAll} disabled={busy}>
                  모두 지우기
                </button>
              </div>
            </div>
          )}
          <ImageList
            shots={doc.shots}
            onReorder={onReorder}
            onRemove={onRemove}
            onSortByName={onSortByName}
            sortDir={sortDir}
            hoverShot={hoverShot}
            onHoverShot={setHoverShot}
            disabled={busy}
          />
        </aside>

        {/* 중앙: 액션 바 + 미리보기 */}
        <main className="flex min-w-0 flex-1 flex-col bg-neutral-950">
          <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-2">
            <button
              className="rounded-md bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-40"
              onClick={doExport}
              disabled={!layout || busy}
            >
              ⚡ 자동으로 바로 내보내기
            </button>
            <button
              className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${
                reviewOpen
                  ? 'border-amber-400 bg-amber-400/10 text-amber-300'
                  : 'border-neutral-600 text-neutral-200 hover:bg-neutral-800'
              }`}
              onClick={() => setReviewOpen((v) => !v)}
              disabled={!layout}
            >
              🔍 {reviewOpen ? '검수 닫기' : '검수하기'}
            </button>
            {lowConfidence && layout && (
              <span className="text-[11px] text-amber-400">신뢰도 낮은 이음새가 있어요 · 검수를 권장합니다</span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-6">
            <PreviewCanvas
              shots={doc.shots}
              layout={layout}
              selectedSeam={selectedSeam}
              onSelectSeam={(i) => {
                setSelectedSeam(i)
                setReviewOpen(true)
              }}
              hoverShot={hoverShot}
              onHoverShot={setHoverShot}
            />
          </div>
        </main>

        {/* 우측: 검수 패널 */}
        {reviewOpen && doc.shots.length > 0 && (
          <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-neutral-800 p-3">
            <section>
              <h2 className="section-title">고정 영역 (상태바·헤더·탭바)</h2>
              {doc.shots[0] && (
                <FixedRegionEditor
                  first={doc.shots[0]}
                  top={doc.top}
                  bottom={doc.bottom}
                  onChange={onFixedChange}
                  onInteractStart={onFixedStart}
                  onInteractEnd={onFixedEnd}
                />
              )}
              <div className="mt-2 space-y-1 text-xs">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={doc.includeHeader} onChange={(e) => toggle('includeHeader', e.target.checked)} />
                  최종 출력에 상단(헤더) 포함
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={doc.includeFooter} onChange={(e) => toggle('includeFooter', e.target.checked)} />
                  최종 출력에 하단(푸터) 포함
                </label>
                <label className="flex items-center gap-2" title="플로팅 버튼·스티키 헤더 등 겹쳐 나오는 UI를 이웃 스크린샷으로 채워 지웁니다.">
                  <input type="checkbox" checked={doc.cleanOverlays} onChange={(e) => toggle('cleanOverlays', e.target.checked)} />
                  겹치는 플로팅/스티키 UI 자동 정리
                </label>
              </div>
            </section>

            <section>
              <h2 className="section-title">이음새 조정</h2>
              <SeamControls
                seams={doc.seams}
                selected={selectedSeam}
                onSelect={setSelectedSeam}
                onNudge={nudgeSeam}
                onReset={resetSeam}
              />
            </section>

            <section className="mt-auto">
              <button
                className="w-full rounded-md bg-emerald-500 py-2 text-sm font-medium text-white hover:bg-emerald-400 disabled:opacity-40"
                onClick={doExport}
                disabled={!layout || busy}
              >
                검수한 대로 내보내기
              </button>
              {layout && (
                <p className="mt-1 text-[11px] text-neutral-500">
                  출력 {layout.width}×{layout.height}px
                  {tiles > 1 && <> · 세로가 길어 {tiles}개 파일로 분할</>}
                </p>
              )}
            </section>
          </aside>
        )}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-sky-400/30 border-t-sky-400" />
  )
}
