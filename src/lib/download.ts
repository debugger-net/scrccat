import type { Shot } from './types'
import { exportPng, type Layout } from './compose'

// 이어붙인 결과를 PNG로 저장한다. 세로가 길면 여러 파일로 나뉜다. 저장한 파일 수 반환.
export async function downloadStitched(shots: Shot[], layout: Layout): Promise<number> {
  const blobs = await exportPng(shots, layout)
  blobs.forEach((blob, i) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = blobs.length > 1 ? `scrccat-${i + 1}.png` : 'scrccat.png'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  return blobs.length
}
