/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: 'Foodiet',
        short_name: 'Foodiet',
        description: '食事と体重を記録して、今日食べていい量がわかる体重管理アプリ',
        lang: 'ja',
        theme_color: '#16a34a',
        background_color: '#f6f7f9',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 画面遷移は必ずネットワークへ（Cloudflare Access のログインが切れたときに、ログイン画面へ進めるように）
        navigateFallback: null,
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
      },
    }),
  ],
  server: {
    // `npm run dev` のとき API は wrangler pages dev（8788）に転送する
    proxy: { '/api': 'http://localhost:8788' },
  },
  test: {
    include: ['shared/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
