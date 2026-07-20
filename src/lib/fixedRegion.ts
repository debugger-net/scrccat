import type { Shot } from './types'
import { SIG_W } from './signature'

// 두 행 시그니처 간 거리(평균 절대차, 0~1)
export function rowDist(
  a: Float32Array,
  ai: number,
  b: Float32Array,
  bi: number,
  w: number,
): number {
  let sum = 0
  const oa = ai * w
  const ob = bi * w
  for (let k = 0; k < w; k++) sum += Math.abs(a[oa + k] - b[ob + k])
  return sum / w
}

// 여러 장에서 "같은 y의 행이 얼마나 변하지 않는가"로 상/하단 고정 UI 높이를 추정한다.
// 상태바 시계나 스크롤되는 탭바처럼 일부만 변하는 경우를 견디도록,
// 임계값 이하이면 고정으로 보고 다수(60%) 쌍에서 고정이면 고정 영역으로 판정한다.
// 순서와 무관하게 동작한다(고정 행은 모든 이미지에서 동일하므로).
export function detectFixedRegions(
  shots: Shot[],
  threshold = 0.02,
): { top: number; bottom: number } {
  if (shots.length < 2) return { top: 0, bottom: 0 }
  const w = SIG_W
  const h = shots.reduce((m, s) => Math.min(m, s.height), Infinity)
  const pairs = Math.min(shots.length - 1, 4)

  let top = 0
  for (let y = 0; y < h; y++) {
    if (rowFixedAcrossPairs(shots, pairs, y, w, threshold)) top = y + 1
    else break
  }

  let bottom = 0
  for (let y = 0; y < h; y++) {
    if (rowFixedAcrossPairs(shots, pairs, h - 1 - y, w, threshold)) bottom = y + 1
    else break
  }

  // 과도 감지 방지: 각 최대 25%
  const cap = Math.floor(h * 0.25)
  return { top: Math.min(top, cap), bottom: Math.min(bottom, cap) }
}

function rowFixedAcrossPairs(
  shots: Shot[],
  pairs: number,
  y: number,
  w: number,
  threshold: number,
): boolean {
  let ok = 0
  for (let i = 0; i < pairs; i++) {
    if (rowDist(shots[i].sig, y, shots[i + 1].sig, y, w) < threshold) ok++
  }
  return ok >= Math.ceil(pairs * 0.6)
}
