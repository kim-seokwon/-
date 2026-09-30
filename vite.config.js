import { defineConfig } from 'vite';

// 빌드 시각을 코드에 심는다 — 화면 오른쪽 위에 뜨는 판 표시에 쓴다.
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');

export default defineConfig({
  define: { __BUILD_TIME__: JSON.stringify(stamp) },
});
