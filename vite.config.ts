import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'VerdFrut Choferes',
        short_name: 'Choferes',
        description: 'Check list de unidad y carga de combustible',
        lang: 'es-MX',
        theme_color: '#2f9e44',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        // SVG y no PNG: los manifests lo aceptan y evita mantener mapas de
        // bits en varios tamaños. Antes apuntaba a icon-192/512.png, que
        // nunca existieron, así que la app quedaba sin icono al instalarse.
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // La app funciona sin señal: nunca cachear las llamadas a Supabase,
        // el estado offline lo maneja la cola en IndexedDB.
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: { host: true, port: 5173 },
  // `allowedHosts` abre el server a dominios externos (túneles tipo ngrok).
  // Vite bloquea hosts desconocidos por defecto como defensa contra DNS
  // rebinding; acá se habilita a propósito para poder compartir un link de
  // prueba. No dejarlo así en un despliegue permanente.
  preview: { host: true, port: 4173, allowedHosts: true },
})
