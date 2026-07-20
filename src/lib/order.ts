import type { Shot } from './types'
import { SIG_W } from './signature'
import { rowDist } from './fixedRegion'

const MIN_OVERLAP = 40
// 매칭 비용이 이보다 낮으면 "실제로 겹친다"고 인정한다.
const REAL_MATCH = 0.06

interface PairInfo {
  cost: number // 최소 매칭 비용(낮을수록 잘 맞음)
  advance: number // 그때의 스크롤 전진량 s (작을수록 많이 겹침 = 더 가까운 아래)
}

// A(위)→B(아래) coarse 매칭. 순서 정렬 랭킹용.
function pairInfo(a: Shot, b: Shot, top: number, bottom: number): PairInfo {
  const lenA = a.height - bottom - top
  const lenB = b.height - bottom - top
  const len = Math.min(lenA, lenB)
  if (len < MIN_OVERLAP) return { cost: 1, advance: 0 }

  const sMax = len - MIN_OVERLAP
  const step = Math.max(2, Math.round(len / 200))
  const stride = 6

  let best = Infinity
  let bestS = 1
  for (let s = 1; s <= sMax; s += step) {
    let sum = 0
    let count = 0
    for (let k = s; k < len; k += stride) {
      sum += rowDist(a.sig, top + k, b.sig, top + (k - s), SIG_W)
      count++
    }
    const c = count > 0 ? sum / count : 1
    if (c < best) {
      best = c
      bestS = s
    }
  }
  return { cost: best, advance: bestS }
}

// 스크린샷들의 올바른 위→아래 순서를 매칭으로 자동 추정한다. 인덱스 순열 반환.
//
// 핵심: 스크롤 스텝이 커도 인접하지 않은 쌍이 겹칠 수 있어 "비용 최소"만으로는
// 바로 다음 장과 건너뛴 장을 구분하지 못한다. 그래서 실제로 겹치는(비용이 낮은)
// 후보 중 advance가 가장 작은(=가장 많이 겹치는) 장을 다음으로 택하는
// "최근접 아래" 그리디로 체인을 만든다.
export function orderShots(shots: Shot[], top: number, bottom: number): number[] {
  const n = shots.length
  if (n <= 1) return shots.map((_, i) => i)

  const info: PairInfo[][] = Array.from({ length: n }, () => new Array<PairInfo>(n))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) info[i][j] = pairInfo(shots[i], shots[j], top, bottom)
    }
  }

  // 시작(최상단): 어떤 이미지도 자신을 아래로 잘 잇지 못하는(incoming 최소비용이 가장 큰) 이미지
  let start = 0
  let worstIncoming = -Infinity
  for (let j = 0; j < n; j++) {
    let inBest = Infinity
    for (let i = 0; i < n; i++) if (i !== j) inBest = Math.min(inBest, info[i][j].cost)
    if (inBest > worstIncoming) {
      worstIncoming = inBest
      start = j
    }
  }

  const used = new Array<boolean>(n).fill(false)
  const order = [start]
  used[start] = true
  let cur = start

  for (let s = 1; s < n; s++) {
    // 현재 노드의 미사용 후보 중 최소 비용
    let bestCost = Infinity
    for (let j = 0; j < n; j++) {
      if (!used[j] && info[cur][j].cost < bestCost) bestCost = info[cur][j].cost
    }
    // 실제 겹침으로 인정할 임계값 (적응적, 단 절대 상한 REAL_MATCH)
    const T = Math.min(REAL_MATCH, Math.max(bestCost * 3, bestCost + 0.02))

    // 1순위: 겹침 후보(T 이하) 중 advance 최소, 동률이면 비용 낮은 쪽
    let next = -1
    let bestAdv = Infinity
    let bestSelCost = Infinity
    for (let j = 0; j < n; j++) {
      if (used[j]) continue
      const inf = info[cur][j]
      if (inf.cost > T) continue
      if (inf.advance < bestAdv || (inf.advance === bestAdv && inf.cost < bestSelCost)) {
        bestAdv = inf.advance
        bestSelCost = inf.cost
        next = j
      }
    }

    // 2순위(겹침 후보 없음): 비용 최소로 이어붙임
    if (next === -1) {
      let bc = Infinity
      for (let j = 0; j < n; j++) {
        if (!used[j] && info[cur][j].cost < bc) {
          bc = info[cur][j].cost
          next = j
        }
      }
    }

    order.push(next)
    used[next] = true
    cur = next
  }

  return order
}

export function isIdentityOrder(order: number[]): boolean {
  return order.every((v, i) => v === i)
}
