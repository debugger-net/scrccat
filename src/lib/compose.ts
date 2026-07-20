import type { Shot, Seam } from './types'

export interface ComposeOptions {
  top: number
  bottom: number
  seams: Seam[]
  includeHeader: boolean
  includeFooter: boolean
}

// 출력 이미지에 그릴 한 조각(소스 사각형 → 목적지 y). 세로 스케일은 없다(sh == 목적지 높이).
export interface Piece {
  shotIndex: number
  sx: number
  sy: number
  sw: number
  sh: number
  dy: number
}

export interface Layout {
  width: number
  height: number
  pieces: Piece[]
  seamYs: number[] // 각 이음새의 출력 y (구분선 표시용)
}

// 캔버스 한 변 한도(Safari 기준 보수적). 이보다 길면 타일로 나눠 내보낸다.
export const MAX_TILE = 16384

export function computeLayout(shots: Shot[], opts: ComposeOptions): Layout {
  const { top, bottom, seams, includeHeader, includeFooter } = opts
  const width = shots[0].width
  const pieces: Piece[] = []
  const seamYs: number[] = []
  let y = 0

  // 헤더: 첫 이미지의 상단 고정 영역을 한 번만
  if (includeHeader && top > 0) {
    pieces.push({ shotIndex: 0, sx: 0, sy: 0, sw: shots[0].width, sh: top, dy: y })
    y += top
  }

  // 첫 이미지의 스크롤 밴드 전체
  const first = shots[0]
  const band0 = first.height - bottom - top
  if (band0 > 0) {
    pieces.push({ shotIndex: 0, sx: 0, sy: top, sw: first.width, sh: band0, dy: y })
    y += band0
  }

  // 이후 이미지들: 각자 새로 더하는 하단 s행만 이어붙임
  for (let i = 1; i < shots.length; i++) {
    seamYs.push(y)
    const shot = shots[i]
    const s = Math.max(0, Math.min(seams[i - 1]?.advance ?? 0, shot.height - bottom - top))
    if (s > 0) {
      const sy = shot.height - bottom - s
      pieces.push({ shotIndex: i, sx: 0, sy, sw: shot.width, sh: s, dy: y })
      y += s
    }
  }

  // 푸터: 마지막 이미지의 하단 고정 영역을 한 번만
  if (includeFooter && bottom > 0) {
    const last = shots[shots.length - 1]
    pieces.push({
      shotIndex: shots.length - 1,
      sx: 0,
      sy: last.height - bottom,
      sw: last.width,
      sh: bottom,
      dy: y,
    })
    y += bottom
  }

  return { width, height: y, pieces, seamYs }
}

// 레이아웃의 [y0, y1) 구간을 캔버스에 scale 배로 렌더한다.
// 미리보기(축소)와 내보내기(scale=1, 타일)에서 공용으로 쓴다.
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
    ctx.drawImage(
      shot.bitmap,
      p.sx,
      p.sy + srcOffset,
      p.sw,
      iy1 - iy0,
      0,
      (iy0 - y0) * scale,
      layout.width * scale,
      (iy1 - iy0) * scale,
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
