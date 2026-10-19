import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Vite runs the game while we develop (npm run dev) and packs it for release (npm run build).
// The PWA plugin adds an offline helper (service worker) so the installed game works without internet.
export default defineConfig({
  base: './', // relative paths, so the game works on GitHub Pages and from any folder
  build: { chunkSizeWarningLimit: 6000 }, // the physics engine alone is several MB; that's expected
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Project Drop',
        short_name: 'Project Drop',
        description: 'Single-player battle royale: loot, shoot, build and survive.',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        background_color: '#0b1b4d',
        theme_color: '#0b1b4d',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,woff,png}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024, // the physics engine is a big file
      },
    }),
  ],
});
