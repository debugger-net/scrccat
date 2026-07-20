import type { Shot, Seam } from './types'
import { SIG_W } from './signature'

export interface ComposeOptions {
  top: number
  bottom: number
  seams: Seam[]
  includeHeader: boolean
  includeFooter: boolean
  cleanOverlays: boolean // 플로팅 버튼/스티키 UI를 이웃 장에서 채워 지울지
  composeMask?: Uint8Array // overlay.composeMask (H*SIG_W)
  maskH?: number
}

// 출력 이미지에 그릴 한 조각(소스 사각형 → 목적지 y). 세로 스케일 없음(sh == 목적지 높이).
export interface Piece {
  shotIndex: number
  sx: number
  sy: number
  sw: number
  sh: number
  dy: number
}

// 각 장이 콘텐츠 좌표에서 차지하는 구간(호버 오버레이/리스트 동기화용).
export interface Placement {
  shotIndex: number
  cStart: number // 콘텐츠 좌표 시작
  band: number // 스크롤 밴드 높이
}

export interface Layout {
  width: number
  height: number
  pieces: Piece[]
  seamYs: number[]
  headerH: number
  footerH: number
  contentTop: number // = headerH (콘텐츠 시작 출력 y)
  totalContent: number
  placements: Placement[]
  top: number
  bottom: number
}

// 캔버스 한 변 한도(Safari 기준 보수적). 이보다 길면 타일로 나눠 내보낸다.
export const MAX_TILE = 16384

export function computeLayout(shots: Shot[], opts: ComposeOptions): Layout {
  const { top, bottom, seams, includeHeader, includeFooter, cleanOverlays } = opts
  const n = shots.length
  const width = shots[0].width

  const band = shots.map((s) => Math.max(0, s.height - bottom - top))
  const C: number[] = new Array(n)
  C[0] = 0
  for (let i = 1; i < n; i++) {
    const adv = Math.max(0, Math.min(seams[i - 1]?.advance ?? 0, band[i]))
    C[i] = C[i - 1] + adv
  }
  let totalContent = 0
  for (let i = 0; i < n; i++) totalContent = Math.max(totalContent, C[i] + band[i])

  const headerH = includeHeader && top > 0 ? top : 0
  const footerH = includeFooter && bottom > 0 ? bottom : 0
  const height = headerH + totalContent + footerH

  const pieces: Piece[] = []
  if (headerH > 0) pieces.push({ shotIndex: 0, sx: 0, sy: 0, sw: width, sh: headerH, dy: 0 })

  if (cleanOverlays && opts.composeMask && n > 1) {
    pieces.push(...composeMultiSource(shots, C, band, top, width, headerH, totalContent, opts.composeMask, opts.maskH ?? 0))
  } else {
    // 단순 스트립: 각 장의 새 구간만 이어붙임(정본 = 가장 이른 장).
    let filled = 0
    for (let i = 0; i < n; i++) {
      const cEnd = C[i] + band[i]
      if (cEnd <= filled) continue
      const cStart = filled
      const sy = top + (cStart - C[i])
      pieces.push({ shotIndex: i, sx: 0, sy, sw: width, sh: cEnd - cStart, dy: headerH + cStart })
      filled = cEnd
    }
  }

  if (footerH > 0) {
    const last = shots[n - 1]
    pieces.push({ shotIndex: n - 1, sx: 0, sy: last.height - bottom, sw: width, sh: footerH, dy: headerH + totalContent })
  }

  const seamYs: number[] = []
  for (let i = 0; i < n - 1; i++) seamYs.push(headerH + Math.min(totalContent, C[i] + band[i]))

  const placements: Placement[] = shots.map((_, i) => ({ shotIndex: i, cStart: C[i], band: band[i] }))

  return { width, height, pieces, seamYs, headerH, footerH, contentTop: headerH, totalContent, placements, top, bottom }
}

// 열(column)마다 콘텐츠를 따라 내려가며, 오버레이(플로팅 UI)에 걸리지 않는 가장 중앙에 가까운
// 소스 장을 골라 세로 런(run) 조각을 만든다. 겹침이 충분하면 플로팅 버튼/스티키 UI가 지워진다.
function composeMultiSource(
  shots: Shot[],
  C: number[],
  band: number[],
  top: number,
  width: number,
  headerH: number,
  totalContent: number,
  composeMask: Uint8Array,
  maskH: number,
): Piece[] {
  const n = shots.length
  const W = SIG_W
  const colX0: number[] = []
  const colX1: number[] = []
  for (let c = 0; c < W; c++) {
    colX0.push(Math.floor((c * width) / W))
    colX1.push(Math.floor(((c + 1) * width) / W))
  }
  const pieces: Piece[] = []
  const HYS = 40 // 히스테리시스: 소스 전환을 줄여 조각/이음 아티팩트 최소화

  // 열마다 현재 진행 중인 세로 런(run) 상태
  const runShot = new Int32Array(W).fill(-1)
  const runStart = new Int32Array(W)
  const flush = (c: number, endP: number) => {
    const rs = runShot[c]
    if (rs < 0 || endP <= runStart[c]) return
    const sy = top + (runStart[c] - C[rs])
    pieces.push({ shotIndex: rs, sx: colX0[c], sy, sw: colX1[c] - colX0[c], sh: endP - runStart[c], dy: headerH + runStart[c] })
  }

  const covering: number[] = []
  for (let p = 0; p < totalContent; p++) {
    // 이 콘텐츠 행을 덮는 후보 장(행마다 한 번만 계산)
    covering.length = 0
    for (let i = 0; i < n; i++) if (C[i] <= p && p < C[i] + band[i]) covering.push(i)
    if (covering.length === 0) continue
    for (let c = 0; c < W; c++) {
      let chosen = runShot[c]
      let chosenScore = Infinity
      if (chosen >= 0 && C[chosen] <= p && p < C[chosen] + band[chosen]) {
        const vy = top + (p - C[chosen])
        const masked = vy >= 0 && vy < maskH && composeMask[vy * W + c] === 1
        const k = p - C[chosen]
        chosenScore = (masked ? 1e6 : 0) - Math.min(k, band[chosen] - k)
      } else {
        chosen = -1
      }
      for (const i of covering) {
        const vy = top + (p - C[i])
        const masked = vy >= 0 && vy < maskH && composeMask[vy * W + c] === 1
        const k = p - C[i]
        const s = (masked ? 1e6 : 0) - Math.min(k, band[i] - k)
        if (s < chosenScore - (i === runShot[c] ? 0 : HYS)) {
          chosenScore = s
          chosen = i
        }
      }
      if (chosen !== runShot[c]) {
        flush(c, p)
        runShot[c] = chosen
        runStart[c] = p
      }
    }
  }
  for (let c = 0; c < W; c++) flush(c, totalContent)
  return pieces
}

// 레이아웃의 [y0, y1) 구간을 캔버스에 scale 배로 렌더한다. 미리보기/내보내기 공용.
export function renderRange(
  shots: Shot[],
  layout: Layout,
  canvas: HTMLCanvasElement,
  y0: number,
  y1: number,
  scale: number,
): void {
  const outW = Math.max(1, Math.round(layout.width * scale))
  const outH = Math.max(1, Math.round((y1 - y0) * scale))
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, outW, outH)

  for (const p of layout.pieces) {
    const pTop = p.dy
    const pBot = p.dy + p.sh
    const iy0 = Math.max(pTop, y0)
    const iy1 = Math.min(pBot, y1)
    if (iy1 <= iy0) continue

    const srcOffset = iy0 - p.dy
    const shot = shots[p.shotIndex]
    // 가장자리 기반 반올림: 인접 열/세로 런이 소수 배율에서도 빈틈 없이 맞물리게 한다.
    const dx = Math.round(p.sx * scale)
    const dxr = Math.round((p.sx + p.sw) * scale)
    const dyt = Math.round((iy0 - y0) * scale)
    const dyb = Math.round((iy1 - y0) * scale)
    ctx.drawImage(
      shot.bitmap,
      p.sx,
      p.sy + srcOffset,
      p.sw,
      iy1 - iy0,
      dx,
      dyt,
      Math.max(1, dxr - dx),
      Math.max(1, dyb - dyt),
    )
  }
}

// 최종 PNG(들)을 만든다. 세로가 MAX_TILE을 넘으면 여러 장으로 분할.
export async function exportPng(shots: Shot[], layout: Layout): Promise<Blob[]> {
  const blobs: Blob[] = []
  const tiles = Math.max(1, Math.ceil(layout.height / MAX_TILE))
  for (let t = 0; t < tiles; t++) {
    const y0 = t * MAX_TILE
    const y1 = Math.min(layout.height, (t + 1) * MAX_TILE)
    const canvas = document.createElement('canvas')
    renderRange(shots, layout, canvas, y0, y1, 1)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 인코딩 실패'))), 'image/png'),
    )
    blobs.push(blob)
  }
  return blobs
}
