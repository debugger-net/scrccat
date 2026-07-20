import { computeRowSignature, SIG_W } from './signature'
import type { Shot } from './types'

let idCounter = 0

// File → ImageBitmap 디코드 + 행 시그니처 계산. 모든 처리는 브라우저 안에서 이뤄진다.
export async function loadShot(file: File): Promise<Shot> {
  // 사진(EXIF 회전)이 섞여 들어와도 보이는 방향대로 처리
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const sig = computeRowSignature(bitmap)
  return {
    id: `shot-${idCounter++}-${file.name}`,
    file,
    name: file.name,
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    sig,
    sigW: SIG_W,
  }
}
