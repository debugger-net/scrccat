import type { Shot, Seam } from './types'
import { matchPair, minTrustOverlap } from './match'

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

// A(위), B(아래)의 최적 겹침(스크롤 전진량 s)을 오버레이 마스크를 제외하고 찾는다.
export function detectSeam(
  a: Shot,
  b: Shot,
  mask: Uint8Array,
  top: number,
  bottom: number,
): Seam {
  const len = Math.min(a.height, b.height) - top - bottom
  const minTrust = minTrustOverlap(len)
  const m = matchPair(a, b, mask, top, bottom, minTrust)
  if (m.overlap <= 0) {
    const s = Math.max(0, Math.floor(len / 2))
    return { advance: s, auto: s, cost: 1, confidence: 0, overridden: false }
  }
  // 신뢰도: 절대 비용이 낮을수록, 유효 셀이 많을수록 높다.
  const absolute = clamp01(1 - m.cost / 0.12)
  const coverage = clamp01(m.cover / 400)
  const confidence = clamp01(absolute * 0.7 + coverage * 0.3)
  return { advance: m.advance, auto: m.advance, cost: m.cost, confidence, overridden: false }
}

// 인접 쌍마다 이음새 계산. prev가 있으면 수동 조정(overridden)은 인덱스 기준으로 보존.
export function detectAllSeams(
  shots: Shot[],
  mask: Uint8Array,
  top: number,
  bottom: number,
  prev?: Seam[],
): Seam[] {
  const out: Seam[] = []
  for (let i = 0; i < shots.length - 1; i++) {
    const auto = detectSeam(shots[i], shots[i + 1], mask, top, bottom)
    const p = prev?.[i]
    if (p?.overridden) {
      out.push({
        ...auto,
        advance: clampAdvance(p.advance, shots[i + 1], top, bottom),
        overridden: true,
      })
    } else {
      out.push(auto)
    }
  }
  return out
}

// 수동 재정렬용: 이전과 "같은 인접쌍(아이디 기준)"의 이음새는 그대로 재사용하고(수동조정 포함),
// 바뀐 경계만 새로 감지한다. 이음새는 위치와 무관하게 두 이미지쌍에만 의존하므로 안전하다.
export function reconcileSeams(
  newShots: Shot[],
  oldShots: Shot[],
  oldSeams: Seam[],
  mask: Uint8Array,
  top: number,
  bottom: number,
): Seam[] {
  const prevByPair = new Map<string, Seam>()
  for (let i = 0; i < oldShots.length - 1; i++) {
    prevByPair.set(`${oldShots[i].id}|${oldShots[i + 1].id}`, oldSeams[i])
  }
  const out: Seam[] = []
  for (let i = 0; i < newShots.length - 1; i++) {
    const prev = prevByPair.get(`${newShots[i].id}|${newShots[i + 1].id}`)
    out.push(prev ?? detectSeam(newShots[i], newShots[i + 1], mask, top, bottom))
  }
  return out
}

export function clampAdvance(s: number, lower: Shot, top: number, bottom: number): number {
  const len = lower.height - bottom - top
  return Math.max(0, Math.min(s, len))
}
