import type { Seam } from '../lib/types'

interface Props {
  seams: Seam[]
  selected: number | null
  onSelect: (i: number) => void
  onNudge: (i: number, delta: number) => void
  onReset: (i: number) => void
}

function confColor(c: number): string {
  if (c >= 0.66) return 'bg-emerald-500'
  if (c >= 0.33) return 'bg-amber-500'
  return 'bg-red-500'
}

export default function SeamControls({ seams, selected, onSelect, onNudge, onReset }: Props) {
  if (seams.length === 0) {
    return <div className="text-xs text-neutral-500">이음새가 없습니다 (이미지 2장 이상 필요).</div>
  }
  return (
    <ul className="space-y-1.5">
      {seams.map((s, i) => (
        <li
          key={i}
          onClick={() => onSelect(i)}
          className={`cursor-pointer rounded border p-2 text-xs ${
            selected === i ? 'border-amber-400 bg-amber-400/10' : 'border-neutral-700'
          }`}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-neutral-300">
              이음새 {i + 1} <span className="text-neutral-500">({i + 1}→{i + 2})</span>
            </span>
            <span className="flex items-center gap-1">
              {s.cutOverridden && (
                <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300" title={`자르는 선 ${s.cut}px 조정됨`}>
                  ✂ {s.cut}
                </span>
              )}
              <span
                className={`inline-block h-2 w-2 rounded-full ${confColor(s.confidence)}`}
                title={`신뢰도 ${(s.confidence * 100).toFixed(0)}%`}
              />
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-neutral-500">추가 {s.advance}px</span>
            <div className="ml-auto flex items-center gap-1">
              {[-5, -1, 1, 5].map((d) => (
                <button
                  key={d}
                  className="btn-nudge"
                  onClick={(e) => {
                    e.stopPropagation()
                    onNudge(i, d)
                  }}
                >
                  {d > 0 ? `+${d}` : d}
                </button>
              ))}
              {s.overridden && (
                <button
                  className="btn-nudge text-sky-400"
                  onClick={(e) => {
                    e.stopPropagation()
                    onReset(i)
                  }}
                  title="자동값으로 되돌리기"
                >
                  자동
                </button>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
