// 행 시그니처: 이미지를 (SIG_W × height) 그레이스케일로 다운샘플해
// 각 행을 SIG_W개의 luma 값으로 요약한다. 행 단위 비교를 1D로 만들어 매칭을 빠르게 한다.
export const SIG_W = 48

export function computeRowSignature(bitmap: ImageBitmap): Float32Array {
  const h = bitmap.height
  const canvas = document.createElement('canvas')
  canvas.width = SIG_W
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, SIG_W, h)
  const { data } = ctx.getImageData(0, 0, SIG_W, h)

  const sig = new Float32Array(h * SIG_W)
  for (let i = 0, p = 0; i < sig.length; i++, p += 4) {
    // Rec.601 luma, 0~1 정규화
    sig[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255
  }
  return sig
}
