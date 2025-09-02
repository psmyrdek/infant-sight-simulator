import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true, // Allow external connections
    port: 5173,
    https: false, // Camera works on localhost without HTTPS
    open: true // Auto-open browser
  },
  build: {
    outDir: 'docs', // GitHub Pages serves from /docs
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: 'index.html'
      }
    }
  },
  // No need for special handling since we're using vanilla JS
  // Vite will handle the HTML/CSS/JS files as-is
})