// 매칭(순수 파이프라인)에 필요한, 시그니처만 담은 경량 샷.
// DOM/비트맵 없이 워커로 넘길 수 있어 lib 함수들은 이 타입만 요구한다.
export interface SigShot {
  id: string
  name: string
  width: number
  height: number
  // 행 시그니처: 길이 height * sigW, 값 0~1(luma), row-major. 겹침/순서 매칭에 사용
  sig: Float32Array
  sigW: number
}

// 한 장의 스크린샷: 시그니처 + 디코드된 비트맵/원본 파일(렌더·썸네일용).
export interface Shot extends SigShot {
  file: File
  bitmap: ImageBitmap
}

// 인접한 두 이미지 사이의 이음새(위 이미지 아래쪽과 아래 이미지 위쪽의 겹침)
export interface Seam {
  advance: number // 현재 적용 중인 스크롤 전진량 s(px). 아래 이미지가 새로 더하는 행 수
  auto: number // 자동 감지된 s (되돌리기용)
  cost: number // 매칭 비용(0~1, 낮을수록 잘 맞음)
  confidence: number // 신뢰도(0~1)
  overridden: boolean // 사용자가 advance를 수동 조정했는지
  cut: number // A→B 전환을 오버랩 하단(기본)에서 위로 올린 px. 0=기본(A를 밴드 끝까지 보여줌)
  cutOverridden: boolean // 사용자가 cut(자르는 선)을 수동 조정했는지
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
