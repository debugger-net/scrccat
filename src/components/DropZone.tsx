import { useCallback, useRef, useState } from 'react'

interface Props {
  onFiles: (files: File[]) => void
}

// 드래그앤드롭(Mac) + 클릭 시 다중선택 파일창.
// input[accept=image/*][multiple] 은 Mac Finder 다중선택과 iOS 사진 다중선택을 모두 지원한다.
export default function DropZone({ onFiles }: Props) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const pick = useCallback(
    (list: FileList | null) => {
      if (!list) return
      const files = Array.from(list).filter((f) => f.type.startsWith('image/'))
      if (files.length) onFiles(files)
    },
    [onFiles],
  )

  return (
    <div
      className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-4 text-center text-xs transition ${
        over ? 'border-sky-400 bg-sky-400/10' : 'border-neutral-600 hover:border-neutral-500'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        pick(e.dataTransfer.files)
      }}
    >
      <span className="text-neutral-200">📥 이미지 드래그 또는 클릭해서 추가</span>
      <span className="text-neutral-500">여러 장 선택 가능 · 순서는 자동 정렬됩니다</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          pick(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
