/// <reference lib="webworker" />
import type { ShotSig, WorkerRequest, WorkerResponse } from './protocol'
import { orderShots } from '../lib/order'
import { detectAllSeams } from '../lib/stitch'

// 워커가 보유하는 sig registry. 샷을 add할 때 1회 전송하면, 이후 process 요청은
// id 목록 + 마스크/파라미터만 보내면 되어 큰 sig 배열을 매번 복사하지 않는다.
const registry = new Map<string, ShotSig>()

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  if (msg.type === 'upsert') {
    for (const s of msg.shots) registry.set(s.id, s)
    return
  }
  if (msg.type === 'evict') {
    for (const id of msg.ids) registry.delete(id)
    return
  }
  if (msg.type === 'process') {
    const shots = msg.ids.map((id) => registry.get(id)).filter((s): s is ShotSig => s != null)
    // registry에 아직 없는 샷이 있으면(경합) 아무 것도 하지 않음 — 메인의 gen 가드가 폐기 처리.
    if (shots.length !== msg.ids.length) return
    const order = msg.reorder
      ? orderShots(shots, msg.mask, msg.top, msg.bottom)
      : shots.map((_, i) => i)
    const ordered = order.map((i) => shots[i])
    const seams = detectAllSeams(ordered, msg.mask, msg.top, msg.bottom)
    const res: WorkerResponse = { type: 'result', reqId: msg.reqId, order, seams }
    ;(self as unknown as Worker).postMessage(res)
  }
}
