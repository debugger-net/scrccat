import type { SigShot } from './types'
import { SIG_W } from './signature'

export const MIN_OVERLAP = 24

// 신뢰할 만한 겹침의 하한: 밴드의 약 12% (최소 80px). 이보다 작은 겹침에서 나오는
// "끄트머리 슬라이버" 매칭은 노이즈라 무시한다(순서/이음새가 엉키는 주범).
export function minTrustOverlap(band: number): number {
  return Math.max(80, Math.round(band * 0.12))
}

// 견고 비용 상한: per-cell 잘린 L1(truncated L1). 플로팅 UI가 불가피하게 걸쳐 생기는
// 국소 고diff 셀 무리가 advance 추정을 끌어당기지 못하게, 한 셀의 영향력을 이 값으로 제한한다.
// (매칭된 콘텐츠의 diff는 대개 <0.05, UI 잔재는 0.3~1.0 → 상한에서 포화되어 argmin을 흔들지 못함)
export const TRUNC = 0.6

// 샷별 파생 데이터(텍스처 가중치 + 1/2 해상도 피라미드). sig 배열을 키로 캐시 —
// sig는 샷 로드시 1회 생성되어 안정적이므로, 여러 번의 매칭 호출에서 재사용된다.
interface Derived {
  h: number
  tex: Float32Array // 전해상도 텍스처 가중치 = |c-left| + |c-up|
  h2: number
  sig2: Float32Array // 행 1/2 다운샘플 sig (열은 유지)
  tex2: Float32Array
}
const derivedCache = new WeakMap<Float32Array, Derived>()

function derive(shot: SigShot): Derived {
  const hit = derivedCache.get(shot.sig)
  if (hit) return hit
  const W = SIG_W
  const h = shot.height
  const s = shot.sig
  const tex = new Float32Array(h * W)
  for (let y = 0; y < h; y++) {
    const o0 = y * W
    for (let x = 0; x < W; x++) {
      const o = o0 + x
      const c = s[o]
      const l = x > 0 ? s[o - 1] : c
      const u = y > 0 ? s[o - W] : c
      tex[o] = Math.abs(c - l) + Math.abs(c - u)
    }
  }
  const h2 = h >> 1
  const sig2 = new Float32Array(h2 * W)
  for (let y = 0; y < h2; y++) {
    const o0 = y * W
    const a0 = 2 * y * W
    const b0 = a0 + W
    for (let x = 0; x < W; x++) sig2[o0 + x] = (s[a0 + x] + s[b0 + x]) * 0.5
  }
  const tex2 = new Float32Array(h2 * W)
  for (let y = 0; y < h2; y++) {
    const o0 = y * W
    for (let x = 0; x < W; x++) {
      const o = o0 + x
      const c = sig2[o]
      const l = x > 0 ? sig2[o - 1] : c
      const u = y > 0 ? sig2[o - W] : c
      tex2[o] = Math.abs(c - l) + Math.abs(c - u)
    }
  }
  const d: Derived = { h, tex, h2, sig2, tex2 }
  derivedCache.set(shot.sig, d)
  return d
}

// 마스크의 1/2 해상도 버전(피라미드 coarse 탐색용). 셀이 둘 중 하나라도 오버레이면 오버레이.
const maskCache = new WeakMap<Uint8Array, { mask2: Uint8Array; h2: number }>()
function halfMask(mask: Uint8Array): Uint8Array {
  const hit = maskCache.get(mask)
  if (hit) return hit.mask2
  const W = SIG_W
  const H = mask.length / W
  const h2 = H >> 1
  const mask2 = new Uint8Array(h2 * W)
  for (let y = 0; y < h2; y++) {
    const o0 = y * W
    const a0 = 2 * y * W
    const b0 = a0 + W
    for (let x = 0; x < W; x++) mask2[o0 + x] = mask[a0 + x] | mask[b0 + x]
  }
  maskCache.set(mask, { mask2, h2 })
  return mask2
}

export interface Match {
  cost: number // 텍스처 가중 평균 잘린-L1 행거리(0~1, 낮을수록 잘 맞음)
  advance: number // 스크롤 전진량 s(px): 아래 이미지 B가 새로 더하는 행 수
  overlap: number // 겹치는 행 수
  cover: number // 유효(비오버레이) 셀 수 — 신뢰도 판단용
  margin: number // best와 두 번째 국소최소의 상대 격차(0~1, 높을수록 뚜렷) — 신뢰도용
}

// 전해상도 비용: advance s에서 비오버레이 셀만 텍스처 가중 잘린-L1 평균.
function costFull(
  a: SigShot,
  b: SigShot,
  da: Derived,
  db: Derived,
  mask: Uint8Array,
  top: number,
  len: number,
  s: number,
  stride: number,
  colStep: number,
): { c: number; cnt: number } {
  const W = SIG_W
  const at = da.tex
  const bt = db.tex
  const as = a.sig
  const bs = b.sig
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
      const wt = 0.02 + at[oa + x] + bt[ob + x]
      let d = as[oa + x] - bs[ob + x]
      if (d < 0) d = -d
      if (d > TRUNC) d = TRUNC
      ws += wt
      ds += wt * d
      cnt++
    }
  }
  return { c: ws > 1e-6 ? ds / ws : 1, cnt }
}

// 1/2 해상도 비용(피라미드 coarse 탐색용, 열 서브샘플). 순서 정렬처럼 상대 비용만 필요할 때.
function costHalf(
  da: Derived,
  db: Derived,
  mask2: Uint8Array,
  top2: number,
  len2: number,
  s2: number,
  stride: number,
  colStep: number,
): { c: number; cnt: number } {
  const W = SIG_W
  const as = da.sig2
  const bs = db.sig2
  const at = da.tex2
  const bt = db.tex2
  let ws = 0
  let ds = 0
  let cnt = 0
  for (let k = s2; k < len2; k += stride) {
    const ya = top2 + k
    const yb = top2 + (k - s2)
    const oa = ya * W
    const ob = yb * W
    for (let x = 0; x < W; x += colStep) {
      if (mask2[oa + x] || mask2[ob + x]) continue
      const wt = 0.02 + at[oa + x] + bt[ob + x]
      let d = as[oa + x] - bs[ob + x]
      if (d < 0) d = -d
      if (d > TRUNC) d = TRUNC
      ws += wt
      ds += wt * d
      cnt++
    }
  }
  return { c: ws > 1e-6 ? ds / ws : 1, cnt }
}

// 순서 정렬용 "빠른" 겹침 비용. 정확한 advance는 필요 없고 상대 비용만 있으면 되므로
// 1/2 해상도 피라미드에서 성근 스윕으로 최소 비용만 구한다(n^2 쌍 계산 대폭 감소).
export function pairCostFast(
  a: SigShot,
  b: SigShot,
  mask: Uint8Array,
  top: number,
  bottom: number,
  minTrust: number,
): number {
  const len = Math.min(a.height, b.height) - top - bottom
  if (len < MIN_OVERLAP) return 1
  const sMax = len - Math.max(MIN_OVERLAP, Math.min(minTrust, len - MIN_OVERLAP))
  if (sMax < 1) return 1
  const da = derive(a)
  const db = derive(b)
  const mask2 = halfMask(mask)
  const top2 = top >> 1
  const len2 = len >> 1
  const sMax2 = sMax >> 1
  // 순서 정렬은 상대 비용만 필요하므로 성글게: advance step·행 stride·열 서브샘플을 크게.
  const step = Math.max(2, Math.round(len2 / 120))
  let best = 1
  for (let s2 = 1; s2 <= sMax2; s2 += step) {
    const { c, cnt } = costHalf(da, db, mask2, top2, len2, s2, 4, 2)
    if (cnt < 8) continue
    if (c < best) best = c
  }
  return best
}

// A(위)→B(아래) 최적 겹침. 오버레이 셀은 제외하고 텍스처 가중으로 매칭한다.
// 이음새 advance는 정확해야 하므로 전해상도 coarse+fine으로 탐색한다(사전계산 텍스처로 가속).
export function matchPair(
  a: SigShot,
  b: SigShot,
  mask: Uint8Array,
  top: number,
  bottom: number,
  minTrust: number,
): Match {
  const len = Math.min(a.height, b.height) - top - bottom
  if (len < MIN_OVERLAP) return { cost: 1, advance: 0, overlap: 0, cover: 0, margin: 0 }
  const sMax = len - Math.max(MIN_OVERLAP, Math.min(minTrust, len - MIN_OVERLAP))
  if (sMax < 1) return { cost: 1, advance: 0, overlap: 0, cover: 0, margin: 0 }
  const da = derive(a)
  const db = derive(b)
  const coarse = Math.max(2, Math.round(len / 300))

  // coarse 스윕(전 advance, stride 4) — best + 두 번째 국소최소(margin)
  let best = Infinity
  let bestS = 1
  let second = Infinity
  const gap = Math.max(coarse * 3, Math.round(len * 0.03))
  const coarseCosts: { s: number; c: number }[] = []
  for (let s = 1; s <= sMax; s += coarse) {
    // 이음새 advance는 정확해야 하므로 coarse도 전 열(colStep 1)로 — 반복 콘텐츠의
    // 애매한 최소들을 제대로 변별한다. 사전계산 텍스처로 여전히 원본보다 빠르다.
    const { c, cnt } = costFull(a, b, da, db, mask, top, len, s, 4, 1)
    if (cnt < 8) continue
    coarseCosts.push({ s, c })
    if (c < best) {
      best = c
      bestS = s
    }
  }
  if (!isFinite(best)) return { cost: 1, advance: 0, overlap: 0, cover: 0, margin: 0 }
  for (const { s, c } of coarseCosts) {
    if (Math.abs(s - bestS) <= gap) continue
    if (c < second) second = c
  }
  const margin = isFinite(second) && second > 1e-6 ? Math.max(0, Math.min(1, 1 - best / second)) : 1

  // 주변 정밀 탐색(전 열, stride 1)로 정확한 advance/비용
  let rB = Infinity
  let rS = bestS
  let rCnt = 0
  const lo = Math.max(1, bestS - coarse)
  const hi = Math.min(sMax, bestS + coarse)
  for (let s = lo; s <= hi; s++) {
    const { c, cnt } = costFull(a, b, da, db, mask, top, len, s, 1, 1)
    if (c < rB) {
      rB = c
      rS = s
      rCnt = cnt
    }
  }
  return { cost: rB, advance: rS, overlap: len - rS, cover: rCnt, margin }
}
