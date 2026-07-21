import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Seam, SigShot } from '../lib/types'
import type { ShotSig, WorkerRequest, WorkerResponse } from '../worker/protocol'
import { orderShots } from '../lib/order'
import { detectAllSeams } from '../lib/stitch'

export interface ProcessInput {
  shots: SigShot[] // 현재 문서 순서 (id·sig 포함)
  mask: Uint8Array
  top: number
  bottom: number
  reorder: boolean
}
export interface ProcessOutput {
  order: number[]
  seams: Seam[]
}

export interface StitchWorker {
  process: (input: ProcessInput) => Promise<ProcessOutput>
  evict: (ids: string[]) => void
}

// 메인 스레드 폴백 계산(워커 생성 실패/무응답 시). 순수 lib 함수만 사용.
function computeMain(input: ProcessInput): ProcessOutput {
  const { shots, mask, top, bottom, reorder } = input
  const order = reorder ? orderShots(shots, mask, top, bottom) : shots.map((_, i) => i)
  const ordered = order.map((i) => shots[i])
  const seams = detectAllSeams(ordered, mask, top, bottom)
  return { order, seams }
}

// 무거운 정렬·이음새 계산을 Web Worker로 위임한다(메인 스레드 비블로킹).
// 워커 생성 실패/무응답 시 메인 스레드 계산으로 폴백 — 절대 멈추지 않게 한다.
export function useStitchWorker(): StitchWorker {
  const workerRef = useRef<Worker | null>(null)
  const pending = useRef(new Map<number, { input: ProcessInput; resolve: (o: ProcessOutput) => void; timer: number }>())
  const upserted = useRef(new Set<string>())
  const reqCounter = useRef(0)

  useEffect(() => {
    let worker: Worker | null = null
    try {
      worker = new Worker(new URL('../worker/stitchWorker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data
        if (msg.type === 'result') {
          const p = pending.current.get(msg.reqId)
          if (p) {
            window.clearTimeout(p.timer)
            pending.current.delete(msg.reqId)
            p.resolve({ order: msg.order, seams: msg.seams })
          }
        }
      }
      worker.onerror = () => {
        workerRef.current = null // 이후 요청은 폴백. 대기 중인 건 타임아웃이 처리.
      }
    } catch {
      worker = null
    }
    workerRef.current = worker
    const pendingMap = pending.current
    const upsertedSet = upserted.current
    return () => {
      worker?.terminate()
      workerRef.current = null
      upsertedSet.clear()
      pendingMap.forEach((p) => window.clearTimeout(p.timer))
      pendingMap.clear()
    }
  }, [])

  const process = useCallback((input: ProcessInput): Promise<ProcessOutput> => {
    const worker = workerRef.current
    if (!worker) return Promise.resolve(computeMain(input))

    // registry에 없는 샷은 먼저 upsert (sig 복사본 transfer — 메인의 Shot.sig는 보존)
    const missing = input.shots.filter((s) => !upserted.current.has(s.id))
    if (missing.length) {
      const lites: ShotSig[] = missing.map((s) => ({
        id: s.id,
        name: s.name,
        width: s.width,
        height: s.height,
        sigW: s.sigW,
        sig: s.sig.slice(),
      }))
      const req: WorkerRequest = { type: 'upsert', shots: lites }
      worker.postMessage(
        req,
        lites.map((l) => l.sig.buffer),
      )
      missing.forEach((s) => upserted.current.add(s.id))
    }

    const reqId = ++reqCounter.current
    return new Promise<ProcessOutput>((resolve) => {
      // 무응답 안전망: 워커가 응답하지 않으면 메인 계산으로 폴백해 절대 멈추지 않는다.
      const timer = window.setTimeout(() => {
        const p = pending.current.get(reqId)
        if (p) {
          pending.current.delete(reqId)
          resolve(computeMain(p.input))
        }
      }, 15000)
      pending.current.set(reqId, { input, resolve, timer })
      const req: WorkerRequest = {
        type: 'process',
        reqId,
        ids: input.shots.map((s) => s.id),
        mask: input.mask,
        top: input.top,
        bottom: input.bottom,
        reorder: input.reorder,
      }
      worker.postMessage(req)
    })
  }, [])

  const evict = useCallback((ids: string[]) => {
    ids.forEach((id) => upserted.current.delete(id))
    const worker = workerRef.current
    if (worker) {
      const req: WorkerRequest = { type: 'evict', ids }
      worker.postMessage(req)
    }
  }, [])

  return useMemo(() => ({ process, evict }), [process, evict])
}
