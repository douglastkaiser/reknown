import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

function normalizeBasePath(basePath: string): string {
  if (!basePath) {
    return '/';
  }

  let normalized = basePath.trim();
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  if (!normalized.endsWith('/')) {
    normalized = `${normalized}/`;
  }
  return normalized;
}

function withBase(basePath: string, path: string): string {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `${basePath}${cleanPath}`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = normalizeBasePath(env.VITE_BASE_PATH ?? '/reknown/');

  return {
    base,
    build: {
      outDir: 'dist',
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          id: base,
          name: 'Reknown',
          short_name: 'Reknown',
          description: 'Learn names and faces with spaced repetition from LinkedIn CSV imports.',
          start_url: base,
          scope: base,
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#020617',
          theme_color: '#0f172a',
          lang: 'en-US',
          categories: ['education', 'productivity'],
          icons: [
            {
              src: withBase(base, 'favicon.svg'),
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
          ],
        },
        workbox: {
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          navigateFallback: withBase(base, 'index.html'),
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'google-fonts-stylesheets',
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'google-fonts-webfonts',
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
      }),
    ],
    test: {
      environment: 'node',
      globals: true,
    },
  };
});
