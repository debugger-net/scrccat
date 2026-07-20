// 한 장의 스크린샷과 매칭에 필요한 파생 데이터
export interface Shot {
  id: string
  file: File
  name: string
  bitmap: ImageBitmap
  width: number
  height: number
  // 행 시그니처: 길이 height * sigW, 값 0~1(luma), row-major. 겹침/순서 매칭에 사용
  sig: Float32Array
  sigW: number
}

// 인접한 두 이미지 사이의 이음새(위 이미지 아래쪽과 아래 이미지 위쪽의 겹침)
export interface Seam {
  advance: number // 현재 적용 중인 스크롤 전진량 s(px). 아래 이미지가 새로 더하는 행 수
  auto: number // 자동 감지된 s (되돌리기용)
  cost: number // 매칭 비용(0~1, 낮을수록 잘 맞음)
  confidence: number // 신뢰도(0~1)
  overridden: boolean // 사용자가 수동 조정했는지
}
