import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages(project site)에서는 /scrccat/ 하위 경로로 서빙되므로
// 빌드 시에만 base를 지정하고, 로컬 dev/preview는 루트(/)를 쓴다.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/scrccat/' : '/',
  plugins: [react()],
}))
