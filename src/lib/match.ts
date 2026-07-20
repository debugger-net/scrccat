import type { Shot } from './types'
import { SIG_W } from './signature'

export const MIN_OVERLAP = 24

// 신뢰할 만한 겹침의 하한: 밴드의 약 12% (최소 80px). 이보다 작은 겹침에서 나오는
// "끄트머리 슬라이버" 매칭은 노이즈라 무시한다(순서/이음새가 엉키는 주범).
export function minTrustOverlap(band: number): number {
  return Math.max(80, Math.round(band * 0.12))
}

// 셀의 국소 텍스처(수평+수직 그라디언트). 밋밋한 영역(여백/하늘)의 가중치를 낮춘다.
function texAt(shot: Shot, y: number, x: number, w: number): number {
  const s = shot.sig
  const c = s[y * w + x]
  const l = x > 0 ? s[y * w + x - 1] : c
  const u = y > 0 ? s[(y - 1) * w + x] : c
  return Math.abs(c - l) + Math.abs(c - u)
}

export interface Match {
  cost: number // 텍스처 가중 평균 행거리(0~1, 낮을수록 잘 맞음)
  advance: number // 스크롤 전진량 s(px): 아래 이미지 B가 새로 더하는 행 수
  overlap: number // 겹치는 행 수
  cover: number // 유효(비오버레이) 셀 수 — 신뢰도 판단용
}

// 순서 정렬용 "빠른" 겹침 비용. 정확한 advance는 필요 없고 상대 비용만 있으면 되므로
// 성근 step·stride·열 서브샘플링으로 n^2 쌍 계산을 크게 줄인다(정밀 탐색 생략).
export function pairCostFast(
  a: Shot,
  b: Shot,
  mask: Uint8Array,
  top: number,
  bottom: number,
  minTrust: number,
): number {
  const W = SIG_W
  const len = Math.min(a.height, b.height) - top - bottom
  if (len < MIN_OVERLAP) return 1
  const sMax = len - Math.max(MIN_OVERLAP, Math.min(minTrust, len - MIN_OVERLAP))
  if (sMax < 1) return 1
  // advance step은 정밀 탐색과 같은 해상도(len/300)를 유지해 최적 정렬을 놓치지 않고,
  // 비용 평균만 행(8)·열(2) 서브샘플링으로 줄인다 → 정확도는 지키고 n^2 계산은 대폭 감소.
  const step = Math.max(4, Math.round(len / 300))
  const rowStride = 8
  const colStep = 2
  let best = 1
  for (let s = 1; s <= sMax; s += step) {
    let ws = 0
    let ds = 0
    let cnt = 0
    for (let k = s; k < len; k += rowStride) {
      const ya = top + k
      const yb = top + (k - s)
      const oa = ya * W
      const ob = yb * W
      for (let x = 0; x < W; x += colStep) {
        if (mask[oa + x] || mask[ob + x]) continue
        const c0 = a.sig[oa + x]
        const l0 = x > 0 ? a.sig[oa + x - 1] : c0
        const u0 = ya > 0 ? a.sig[oa - W + x] : c0
        const c1 = b.sig[ob + x]
        const l1 = x > 0 ? b.sig[ob + x - 1] : c1
        const u1 = yb > 0 ? b.sig[ob - W + x] : c1
        const wt = 0.02 + Math.abs(c0 - l0) + Math.abs(c0 - u0) + Math.abs(c1 - l1) + Math.abs(c1 - u1)
        ws += wt
        ds += wt * Math.abs(c0 - c1)
        cnt++
      }
    }
    if (cnt < 8) continue
    const c = ws > 1e-6 ? ds / ws : 1
    if (c < best) best = c
  }
  return best
}

// A(위)→B(아래) 최적 겹침. 오버레이 셀은 제외하고 텍스처 가중으로 매칭한다.
// 겹침이 minTrust 미만인 후보는 탐색 대상에서 뺀다.
export function matchPair(
  a: Shot,
  b: Shot,
  mask: Uint8Array,
  top: number,
  bottom: number,
  minTrust: number,
): Match {
  const W = SIG_W
  const len = Math.min(a.height, b.height) - top - bottom
  if (len < MIN_OVERLAP) return { cost: 1, advance: 0, overlap: 0, cover: 0 }
  const sMax = len - Math.max(MIN_OVERLAP, Math.min(minTrust, len - MIN_OVERLAP))
  if (sMax < 1) return { cost: 1, advance: 0, overlap: 0, cover: 0 }
  const coarse = Math.max(2, Math.round(len / 300))

  const costAt = (s: number, stride: number, colStep: number): { c: number; cnt: number } => {
    let ws = 0
    let ds = 0
    let cnt = 0
    for (let k = s; k < len; k += stride) {
      const ya = top + k
      const yb = top + (k - s)
      const oa = ya * W
      const ob = yb * W
      for (let x = 0; x < W; x += colStep) {
        if (mask[oa + x] || mask[ob + x]) continue
        const wt = 0.02 + texAt(a, ya, x, W) + texAt(b, yb, x, W)
        ws += wt
        ds += wt * Math.abs(a.sig[oa + x] - b.sig[ob + x])
        cnt++
      }
    }
    return { c: ws > 1e-6 ? ds / ws : 1, cnt }
  }

  // coarse 탐색 — 이음새 advance는 정확해야 하므로 전체 열로(정밀)
  let best = Infinity
  let bestS = 1
  for (let s = 1; s <= sMax; s += coarse) {
    const { c, cnt } = costAt(s, 4, 1)
    if (cnt < 8) continue
    if (c < best) {
      best = c
      bestS = s
    }
  }
  if (!isFinite(best)) return { cost: 1, advance: 0, overlap: 0, cover: 0 }
  // 주변 1px 정밀 탐색(전체 열로 정확한 advance/비용)
  let rB = Infinity
  let rS = bestS
  let rCnt = 0
  const lo = Math.max(1, bestS - coarse)
  const hi = Math.min(sMax, bestS + coarse)
  for (let s = lo; s <= hi; s++) {
    const { c, cnt } = costAt(s, 1, 1)
    if (c < rB) {
      rB = c
      rS = s
      rCnt = cnt
    }
  }
  return { cost: rB, advance: rS, overlap: len - rS, cover: rCnt }
}
