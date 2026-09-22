import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  // Relative Pfade in dist/index.html, damit Electron sie per file:// findet.
  base: './',
  plugins: [svelte()],
  server: {
    allowedHosts: ['launcher.sorexclient.com']
  }
})
