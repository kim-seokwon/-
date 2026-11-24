import { defineConfig } from 'vite';
import { RELEASES } from './releaseNotes.js';

// 빌드 시각을 코드에 심는다 — 화면 오른쪽 위에 뜨는 판 표시에 쓴다.
const kst = new Date(Date.now() + 9 * 3600e3).toISOString();
const stamp = kst.slice(5, 16).replace('T', ' ');
//  32 적용 시각(한국) + 이번 빌드 이름 — 화면과 /version.json 이 같은 값을 쓴다
const at = kst.slice(0, 16).replace('T', ' ');
const build = at + ':' + Math.random().toString(36).slice(2, 8);

export default defineConfig({
  define: { __BUILD_TIME__: JSON.stringify(stamp), __BUILD_AT__: JSON.stringify(at), __BUILD_ID__: JSON.stringify(build) },
  plugins: [{
    name: 'version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json',
        source: JSON.stringify({ build, at, notes: RELEASES.slice(0, 3) }) });
    },
  }],
});
