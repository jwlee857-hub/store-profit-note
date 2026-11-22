import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * 링크 공유 미리보기(og:image 등)는 대부분의 서비스가 전체 주소(https://…)를 요구한다.
 * index.html의 __SITE_URL__을 SITE_URL 값(예: https://example.com 또는 https://example.com/app)으로 바꾼다.
 * SITE_URL이 없으면 상대 주소(/og-image.png)로 두고 og:url은 뺀다 — 개발·로컬 확인용이며 이대로는 미리보기가 안 뜰 수 있다.
 */
function siteUrlPlugin(siteUrl: string): Plugin {
  const base = siteUrl.trim().replace(/\/+$/, '');
  return {
    name: 'site-url',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!base) {
          if (!ctx.server) console.warn('\n[site-url] SITE_URL이 없어 링크 공유 미리보기 이미지가 상대 주소로 들어갑니다. 배포 주소를 SITE_URL로 지정하세요.');
          return html.replace(/\s*<meta property="og:url"[^>]*>/, '').replace(/__SITE_URL__/g, '');
        }
        return html.replace(/__SITE_URL__/g, base);
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  // .env 파일 또는 셸 환경 변수의 SITE_URL (접두어 '' = VITE_로 시작하지 않는 값도 읽음. 앱 코드에는 노출되지 않음)
  const env = loadEnv(mode, '.', '');
  // 배포 경로. GitHub Pages(https://<계정>.github.io/<저장소>/)에서는 GitHub Actions가 '/<저장소>/'를 넘긴다. 로컬은 '/'
  const base = (env.BASE_PATH || '/').replace(/\/?$/, '/');
  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      siteUrlPlugin(env.SITE_URL ?? ''),
      // 홈 화면 설치(웹 앱 매니페스트) + 오프라인(서비스 워커가 앱 파일을 미리 받아 둠). 데이터는 그대로 localStorage에 저장된다
      VitePWA({
        // 새 버전은 앱을 모두 닫았다 다시 열 때 적용 (입력 중에 화면이 저절로 새로고침되지 않게)
        registerType: 'prompt',
        injectRegister: 'script-defer',
        includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
        manifest: {
          id: base,
          name: '가게 이익 노트',
          short_name: '가게 이익 노트',
          description: '홀·배달·포장 매출과 비용을 기록하고 가게 전체 영업이익을 확인합니다.',
          lang: 'ko',
          start_url: base,
          scope: base,
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#f6f6f4',
          theme_color: '#f6f6f4',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // 앱 화면에 필요한 파일만 미리 받는다. 공유 썸네일(og-image)은 앱 안에서 쓰지 않으므로 제외
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          globIgnores: ['og-image.png'],
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    build: {
      // 차트 라이브러리(Recharts)는 별도 청크로 분리. 오프라인 단일 페이지 앱이라 경고 기준을 조정
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            charts: ['recharts'],
          },
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      // 실행 날짜·시간대와 무관한 결과 (src/test-setup.ts)
      setupFiles: ['src/test-setup.ts'],
      env: { TZ: 'Asia/Seoul' },
    },
  } as any;
});
