import type { Shot, Seam } from './types'
import { SIG_W } from './signature'
import { rowDist } from './fixedRegion'

const MIN_OVERLAP = 40

// band = [top, H-bottom). A(위)의 band행 k 는 B(아래)의 band행 k-s 와 같은 내용.
// s(=scroll advance)는 B가 새로 더하는 행 수. 비용은 겹치는 구간의 평균 행 거리.
function matchCost(
  a: Shot,
  b: Shot,
  bandTopA: number,
  bandTopB: number,
  len: number,
  s: number,
  stride: number,
): number {
  let sum = 0
  let count = 0
  for (let k = s; k < len; k += stride) {
    sum += rowDist(a.sig, bandTopA + k, b.sig, bandTopB + (k - s), SIG_W)
    count++
  }
  return count > 0 ? sum / count : 1
}

// A(위), B(아래)의 최적 겹침(스크롤 전진량 s)을 coarse→fine 으로 탐색한다.
export function detectSeam(a: Shot, b: Shot, top: number, bottom: number): Seam {
  const bandTopA = top
  const bandTopB = top
  const lenA = a.height - bottom - top
  const lenB = b.height - bottom - top
  const len = Math.min(lenA, lenB)

  if (len < MIN_OVERLAP) {
    const s = Math.max(0, Math.floor(len / 2))
    return { advance: s, auto: s, cost: 1, confidence: 0, overridden: false }
  }

  const sMin = 1
  const sMax = len - MIN_OVERLAP
  const coarseStep = Math.max(2, Math.round(len / 400))

  let best = Infinity
  let bestS = sMin
  const costs: number[] = []
  for (let s = sMin; s <= sMax; s += coarseStep) {
    const c = matchCost(a, b, bandTopA, bandTopB, len, s, 3)
    costs.push(c)
    if (c < best) {
      best = c
      bestS = s
    }
  }

  // bestS 주변을 1px 단위(모든 행)로 정밀 탐색
  let refBest = Infinity
  let refS = bestS
  const lo = Math.max(sMin, bestS - coarseStep)
  const hi = Math.min(sMax, bestS + coarseStep)
  for (let s = lo; s <= hi; s++) {
    const c = matchCost(a, b, bandTopA, bandTopB, len, s, 1)
    if (c < refBest) {
      refBest = c
      refS = s
    }
  }

  // 신뢰도: 최적값이 중앙값 대비 얼마나 두드러지는지 × 절대 비용
  const median = medianOf(costs)
  const separation = median > 1e-6 ? clamp01((median - refBest) / median) : 0
  const absolute = clamp01(1 - refBest / 0.08)
  const confidence = clamp01(separation * 0.6 + absolute * 0.4)

  return { advance: refS, auto: refS, cost: refBest, confidence, overridden: false }
}

// 인접 쌍마다 이음새 계산. prev가 있으면 수동 조정(overridden)은 인덱스 기준으로 보존.
export function detectAllSeams(
  shots: Shot[],
  top: number,
  bottom: number,
  prev?: Seam[],
): Seam[] {
  const out: Seam[] = []
  for (let i = 0; i < shots.length - 1; i++) {
    const auto = detectSeam(shots[i], shots[i + 1], top, bottom)
    const p = prev?.[i]
    if (p?.overridden) {
      out.push({ ...auto, advance: clampAdvance(p.advance, shots[i + 1], top, bottom), overridden: true })
    } else {
      out.push(auto)
    }
  }
  return out
}

export function clampAdvance(s: number, lower: Shot, top: number, bottom: number): number {
  const len = lower.height - bottom - top
  return Math.max(0, Math.min(s, len))
}

function medianOf(arr: number[]): number {
  if (!arr.length) return 1
  const a = [...arr].sort((x, y) => x - y)
  return a[Math.floor(a.length / 2)]
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
