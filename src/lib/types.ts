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

// 실행취소/다시실행 대상이 되는 편집 상태 전체(스냅샷 단위).
export interface Doc {
  shots: Shot[] // 최종 표시 순서
  top: number // 상단 고정 영역 높이
  bottom: number // 하단 고정 영역 높이
  seams: Seam[] // 이음새들 (shots.length - 1개)
  includeHeader: boolean
  includeFooter: boolean
  cleanOverlays: boolean // 플로팅/스티키 UI 자동 정리
  fixedTouched: boolean // 사용자가 고정 영역을 직접 건드렸는지(자동 감지 억제)
}
