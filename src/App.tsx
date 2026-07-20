import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Shot, Seam } from './lib/types'
import { loadShot } from './lib/imageLoad'
import { detectFixedRegions } from './lib/fixedRegion'
import { detectAllSeams, clampAdvance } from './lib/stitch'
import { orderShots, isIdentityOrder } from './lib/order'
import { computeLayout } from './lib/compose'
import { downloadStitched } from './lib/download'
import DropZone from './components/DropZone'
import ImageList from './components/ImageList'
import FixedRegionEditor from './components/FixedRegionEditor'
import SeamControls from './components/SeamControls'
import PreviewCanvas from './components/PreviewCanvas'

export default function App() {
  const [shots, setShots] = useState<Shot[]>([])
  const [top, setTop] = useState(0)
  const [bottom, setBottom] = useState(0)
  const [seams, setSeams] = useState<Seam[]>([])
  const [includeHeader, setIncludeHeader] = useState(true)
  const [includeFooter, setIncludeFooter] = useState(false)
  const [selectedSeam, setSelectedSeam] = useState<number | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [autoOrder, setAutoOrder] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const fixedTouched = useRef(false)

  const notify = useCallback((m: string) => {
    setMessage(m)
    window.setTimeout(() => setMessage(null), 4000)
  }, [])

  // 파일 추가: 디코드 후 뒤에 붙이고, 처리 파이프라인(고정영역 감지 + 자동 정렬) 예약
  const addFiles = useCallback(async (files: File[]) => {
    setBusy(true)
    try {
      const loaded = await Promise.all(files.map(loadShot))
      setShots((prev) => [...prev, ...loaded])
      setPending(true)
    } catch {
      notify('이미지를 불러오지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }, [notify])

  // 처리 파이프라인: 고정 영역 자동 감지 + 순서 자동 정렬
  useEffect(() => {
    if (!pending) return
    setPending(false)
    if (shots.length < 2) return
    setBusy(true)
    // 무거운 동기 연산이 스피너를 가리지 않도록 다음 틱에서 실행
    const id = window.setTimeout(() => {
      let t = top
      let b = bottom
      if (!fixedTouched.current) {
        const fr = detectFixedRegions(shots)
        t = fr.top
        b = fr.bottom
        setTop(t)
        setBottom(b)
      }
      if (autoOrder) {
        const order = orderShots(shots, t, b)
        if (!isIdentityOrder(order)) setShots(order.map((i) => shots[i]))
      }
      setBusy(false)
    }, 0)
    return () => window.clearTimeout(id)
  }, [pending, shots, top, bottom, autoOrder])

  // 이음새(겹침) 재계산 — 수동 조정(overridden)은 보존
  useEffect(() => {
    setSeams((prev) => detectAllSeams(shots, top, bottom, prev))
  }, [shots, top, bottom])

  const changeFixed = useCallback((t: number, b: number) => {
    fixedTouched.current = true
    setTop(t)
    setBottom(b)
  }, [])

  const moveShot = useCallback((i: number, dir: -1 | 1) => {
    setShots((prev) => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }, [])

  const removeShot = useCallback((i: number) => {
    setSelectedSeam(null)
    setShots((prev) => {
      const next = prev.filter((_, k) => k !== i)
      if (next.length === 0) {
        setTop(0)
        setBottom(0)
        fixedTouched.current = false
      }
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setShots([])
    setSeams([])
    setTop(0)
    setBottom(0)
    setSelectedSeam(null)
    fixedTouched.current = false
  }, [])

  const nudgeSeam = useCallback(
    (i: number, delta: number) => {
      setSeams((prev) =>
        prev.map((s, k) =>
          k === i
            ? { ...s, advance: clampAdvance(s.advance + delta, shots[i + 1], top, bottom), overridden: true }
            : s,
        ),
      )
      setSelectedSeam(i)
    },
    [shots, top, bottom],
  )

  const resetSeam = useCallback((i: number) => {
    setSeams((prev) => prev.map((s, k) => (k === i ? { ...s, advance: s.auto, overridden: false } : s)))
  }, [])

  const runAutoOrder = useCallback(() => {
    if (shots.length >= 2) setPending(true)
  }, [shots.length])

  const layout = useMemo(() => {
    if (shots.length === 0) return null
    return computeLayout(shots, { top, bottom, seams, includeHeader, includeFooter })
  }, [shots, top, bottom, seams, includeHeader, includeFooter])

  const doExport = useCallback(async () => {
    if (!layout) return
    setBusy(true)
    try {
      const n = await downloadStitched(shots, layout)
      notify(n > 1 ? `완료 · ${n}개 파일로 저장했습니다.` : '완료 · PNG로 저장했습니다.')
    } catch {
      notify('내보내기에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }, [shots, layout, notify])

  const lowConfidence = seams.some((s) => s.confidence < 0.33)

  return (
    <div className="flex h-screen flex-col bg-neutral-900 text-neutral-100">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <h1 className="text-sm font-semibold">🐈‍⬛ Scrccat</h1>
        <span className="hidden text-xs text-neutral-500 sm:inline">스크롤 스크린샷 이어붙이기</span>
        {busy && <span className="text-xs text-sky-400">처리 중…</span>}
        {message && <span className="text-xs text-emerald-400">{message}</span>}
        <span className="ml-auto hidden text-[11px] text-neutral-600 md:inline">
          모든 처리는 브라우저 안에서 · 업로드 없음
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 좌측: 이미지 목록 */}
        <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-neutral-800 p-3">
          <DropZone onFiles={addFiles} />
          {shots.length > 0 && (
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={autoOrder}
                  onChange={(e) => setAutoOrder(e.target.checked)}
                />
                추가 시 자동 정렬
              </label>
              <div className="flex gap-2">
                <button className="hover:text-neutral-300" onClick={runAutoOrder}>
                  정렬 다시
                </button>
                <button className="hover:text-red-400" onClick={clearAll}>
                  모두 지우기
                </button>
              </div>
            </div>
          )}
          <ImageList shots={shots} onMove={moveShot} onRemove={removeShot} />
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
              <span className="text-[11px] text-amber-400">
                신뢰도 낮은 이음새가 있어요 · 검수를 권장합니다
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-6">
            <PreviewCanvas
              shots={shots}
              layout={layout}
              selectedSeam={selectedSeam}
              onSelectSeam={(i) => {
                setSelectedSeam(i)
                setReviewOpen(true)
              }}
            />
          </div>
        </main>

        {/* 우측: 검수 패널 (선택적) */}
        {reviewOpen && shots.length > 0 && (
          <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-neutral-800 p-3">
            <section>
              <h2 className="section-title">고정 영역 (상태바·헤더·탭바)</h2>
              <FixedRegionEditor first={shots[0]} top={top} bottom={bottom} onChange={changeFixed} />
              <div className="mt-2 space-y-1 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={includeHeader}
                    onChange={(e) => setIncludeHeader(e.target.checked)}
                  />
                  최종 출력에 상단(헤더) 포함
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={includeFooter}
                    onChange={(e) => setIncludeFooter(e.target.checked)}
                  />
                  최종 출력에 하단(푸터) 포함
                </label>
              </div>
            </section>

            <section>
              <h2 className="section-title">이음새 조정</h2>
              <SeamControls
                seams={seams}
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
                  {Math.ceil(layout.height / 16384) > 1 && (
                    <> · 세로가 길어 {Math.ceil(layout.height / 16384)}개 파일로 분할</>
                  )}
                </p>
              )}
            </section>
          </aside>
        )}
      </div>
    </div>
  )
}
