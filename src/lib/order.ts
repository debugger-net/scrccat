import type { SigShot } from './types'
import { pairCostFast, minTrustOverlap } from './match'

// 파일명 순 랭크(자연 정렬). 시작점/동률 판단의 약한 사전(prior)으로만 쓴다.
export function filenameRank(shots: SigShot[]): number[] {
  const idx = shots.map((_, i) => i)
  idx.sort((a, b) => shots[a].name.localeCompare(shots[b].name, undefined, { numeric: true }))
  const rank = new Array<number>(shots.length)
  idx.forEach((si, r) => (rank[si] = r))
  return rank
}

// 스크린샷들의 올바른 위→아래 순서를 매칭으로 추정한다. 인덱스 순열 반환.
//
// 방식: 오버레이(고정/플로팅 UI)를 뺀 텍스처 가중 겹침 비용으로 방향성 그래프를 만들고,
// 최소비용 해밀턴 경로를 찾는다(작은 n은 Held-Karp 정확해, 큰 n은 그리디+2-opt).
// 파일명 순은 강하게 의존하지 않는 약한 tie-break 사전으로만 더한다.
export function orderShots(
  shots: SigShot[],
  mask: Uint8Array,
  top: number,
  bottom: number,
): number[] {
  const n = shots.length
  if (n <= 1) return shots.map((_, i) => i)

  const H = shots.reduce((m, s) => Math.min(m, s.height), Infinity)
  const minTrust = minTrustOverlap(H - top - bottom)

  // 방향성 비용 행렬 (i 위 → j 아래). 순서 정렬은 빠른 근사 비용으로 충분.
  const raw: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(1))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) raw[i][j] = pairCostFast(shots[i], shots[j], mask, top, bottom, minTrust)
    }
  }

  const rank = filenameRank(shots)
  const NAME_PRIOR = 0.004
  const cost = (i: number, j: number): number =>
    raw[i][j] + NAME_PRIOR * Math.max(0, Math.abs(rank[i] - rank[j]) - 1)

  if (n <= 12) return heldKarp(n, cost)
  return greedyTwoOpt(n, cost, rank)
}

// 최소비용 해밀턴 경로 (방향성, 시작/끝 자유). O(n^2 · 2^n).
function heldKarp(n: number, cost: (i: number, j: number) => number): number[] {
  const FULL = 1 << n
  const dp: Float64Array[] = Array.from({ length: FULL }, () => new Float64Array(n).fill(Infinity))
  const par: Int16Array[] = Array.from({ length: FULL }, () => new Int16Array(n).fill(-1))
  for (let i = 0; i < n; i++) dp[1 << i][i] = 0
  for (let mask = 1; mask < FULL; mask++) {
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j)) || dp[mask][j] === Infinity) continue
      const base = dp[mask][j]
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue
        const nm = mask | (1 << k)
        const nc = base + cost(j, k)
        if (nc < dp[nm][k]) {
          dp[nm][k] = nc
          par[nm][k] = j
        }
      }
    }
  }
  let bestEnd = 0
  let bestC = Infinity
  for (let i = 0; i < n; i++) if (dp[FULL - 1][i] < bestC) {
    bestC = dp[FULL - 1][i]
    bestEnd = i
  }
  const path: number[] = []
  let mask = FULL - 1
  let cur = bestEnd
  while (cur !== -1) {
    path.push(cur)
    const p = par[mask][cur]
    mask ^= 1 << cur
    cur = p
  }
  return path.reverse()
}

// 큰 n용: 최근접(최소비용) 그리디 후 2-opt로 개선.
function greedyTwoOpt(n: number, cost: (i: number, j: number) => number, rank: number[]): number[] {
  // 시작: incoming 최소비용이 가장 큰(위에 올 것이 없는) 노드, 동률이면 파일명 첫 장.
  let start = 0
  let worst = -Infinity
  for (let j = 0; j < n; j++) {
    let inb = Infinity
    for (let i = 0; i < n; i++) if (i !== j) inb = Math.min(inb, cost(i, j))
    if (inb > worst || (inb === worst && rank[j] < rank[start])) {
      worst = inb
      start = j
    }
  }
  const used = new Array<boolean>(n).fill(false)
  const order = [start]
  used[start] = true
  let cur = start
  for (let s = 1; s < n; s++) {
    let nx = -1
    let bc = Infinity
    for (let j = 0; j < n; j++) if (!used[j] && cost(cur, j) < bc) {
      bc = cost(cur, j)
      nx = j
    }
    order.push(nx)
    used[nx] = true
    cur = nx
  }
  const pathCost = (o: number[]): number => {
    let c = 0
    for (let i = 0; i < o.length - 1; i++) c += cost(o[i], o[i + 1])
    return c
  }
  let improved = true
  let guard = 0
  while (improved && guard++ < 40) {
    improved = false
    for (let i = 0; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const cand = order.slice(0, i).concat(order.slice(i, k + 1).reverse(), order.slice(k + 1))
        if (pathCost(cand) + 1e-9 < pathCost(order)) {
          order.splice(0, n, ...cand)
          improved = true
        }
      }
    }
  }
  return order
}

export function isIdentityOrder(order: number[]): boolean {
  return order.every((v, i) => v === i)
}
