import { deflateSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const payload = Buffer.concat([typeBytes, Buffer.from(data)]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(payload), 0);
  return Buffer.concat([length, payload, checksum]);
}

function createSolidPng(size: number, rgb: [number, number, number]): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < size; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 3;
      raw[pixelOffset] = rgb[0];
      raw[pixelOffset + 1] = rgb[1];
      raw[pixelOffset + 2] = rgb[2];
    }
  }

  const compressed = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array()),
  ]);
}

function emitPwaIcons(): Plugin {
  return {
    name: 'emit-pwa-icons',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'icon-192.png',
        source: createSolidPng(192, [15, 23, 42]),
      });

      this.emitFile({
        type: 'asset',
        fileName: 'icon-512.png',
        source: createSolidPng(512, [15, 23, 42]),
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    emitPwaIcons(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        id: '/',
        name: 'Reknown',
        short_name: 'Reknown',
        description: 'Learn names and faces with spaced repetition from LinkedIn CSV imports.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#020617',
        theme_color: '#0f172a',
        lang: 'en-US',
        categories: ['education', 'productivity'],
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
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
});
