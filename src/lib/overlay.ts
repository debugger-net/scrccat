import type { Shot } from './types'
import { SIG_W } from './signature'

// 오버레이 마스크: 여러 장에서 "같은 뷰포트 좌표(y,x)의 셀이 거의 변하지 않는" 곳을 찾는다.
// 상태바·헤더·스크롤에 붙어 다니는 스티키 서브헤더·플로팅 버튼·고정 광고(푸터)가 모두 여기에 잡힌다.
// 순서와 무관하게 동작한다(고정/플로팅 UI는 어느 장에서나 같은 위치에 있으므로).
//
// 반환: Uint8Array(H*SIG_W), 1이면 오버레이 셀. H는 모든 장의 최소 높이.
export interface OverlayInfo {
  mask: Uint8Array // 매칭용(보수적): std < matchStd
  composeMask: Uint8Array // 합성용(관대+팽창): 플로팅 UI 가장자리/그림자까지 덮음
  H: number
  W: number
}

export function computeOverlay(
  shots: Shot[],
  { matchStd = 0.03, composeStd = 0.05, dilX = 1, dilY = 3 } = {},
): OverlayInfo {
  const W = SIG_W
  const n = shots.length
  const H = shots.reduce((m, s) => Math.min(m, s.height), Infinity)
  const mask = new Uint8Array(H * W)
  const composeBase = new Uint8Array(H * W)
  if (n < 2 || !isFinite(H)) return { mask, composeMask: composeBase, H: isFinite(H) ? H : 0, W }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = y * W + x
      let mean = 0
      for (let s = 0; s < n; s++) mean += shots[s].sig[o]
      mean /= n
      let v = 0
      for (let s = 0; s < n; s++) {
        const d = shots[s].sig[o] - mean
        v += d * d
      }
      const std = Math.sqrt(v / n)
      if (std < matchStd) mask[o] = 1
      if (std < composeStd) composeBase[o] = 1
    }
  }

  // 합성용 마스크 = opening(잡음 제거) 후 dilate(가장자리/그림자 포함).
  // 1) 열기(open): 3x3 이웃에 5개 이상 켜진 셀만 남겨 고립 스페클을 지운다
  //    (버튼/바/스티키 같은 덩어리는 살아남고, 저대비 콘텐츠의 산발적 오탐만 제거).
  const opened = new Uint8Array(H * W)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!composeBase[y * W + x]) continue
      let c = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= H) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx >= 0 && xx < W && composeBase[yy * W + xx]) c++
        }
      }
      if (c >= 5) opened[y * W + x] = 1
    }
  }
  // 2) 팽창(dilate): 48열 저해상도라 플로팅 버튼 가장자리/그림자가 새기 쉽다.
  const composeMask = new Uint8Array(H * W)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let hit = 0
      for (let dy = -dilY; dy <= dilY && !hit; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= H) continue
        for (let dx = -dilX; dx <= dilX; dx++) {
          const xx = x + dx
          if (xx >= 0 && xx < W && opened[yy * W + xx]) {
            hit = 1
            break
          }
        }
      }
      composeMask[y * W + x] = hit
    }
  }

  return { mask, composeMask, H, W }
}

// 위/아래 가장자리에서 연속적으로 "행 대부분이 오버레이"인 구간 = 고정 바(상태바/헤더 · 탭바/광고).
export function detectFixedBands(
  overlay: OverlayInfo,
  { rowFrac = 0.75, cap = 0.4 } = {},
): { top: number; bottom: number } {
  const { mask, H, W } = overlay
  if (H === 0) return { top: 0, bottom: 0 }
  const rf = (y: number): number => {
    let c = 0
    for (let x = 0; x < W; x++) c += mask[y * W + x]
    return c / W
  }
  let top = 0
  for (let y = 0; y < H; y++) {
    if (rf(y) >= rowFrac) top = y + 1
    else break
  }
  let bottom = 0
  for (let y = 0; y < H; y++) {
    if (rf(H - 1 - y) >= rowFrac) bottom = y + 1
    else break
  }
  const capPx = Math.floor(H * cap)
  return { top: Math.min(top, capPx), bottom: Math.min(bottom, capPx) }
}
