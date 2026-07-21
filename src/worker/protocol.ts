import type { SigShot, Seam } from '../lib/types'

// 워커로 넘기는 경량 샷: 비트맵/파일 없이 시그니처만. (SigShot과 동일 구조)
export type ShotSig = SigShot

// 메인 → 워커
export type WorkerRequest =
  | { type: 'upsert'; shots: ShotSig[] } // registry에 sig 등록/갱신 (sig buffer transfer)
  | { type: 'evict'; ids: string[] } // registry에서 제거
  | {
      type: 'process'
      reqId: number
      ids: string[] // 현재 문서 순서의 샷 id 목록
      mask: Uint8Array // overlay.mask (H*SIG_W)
      top: number
      bottom: number
      reorder: boolean // true면 순서 재정렬, false면 현재 순서 유지(이음새만)
    }

// 워커 → 메인
export type WorkerResponse = {
  type: 'result'
  reqId: number
  order: number[] // ids 배열에 대한 인덱스 순열
  seams: Seam[] // 재정렬된 순서 기준 이음새들
}
