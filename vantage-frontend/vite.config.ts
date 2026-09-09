import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  server: {
    // Pinned + strict: VITE_JIRA_REDIRECT_URI (vantage-frontend/.env) is
    // a fixed http://localhost:5174/... URL registered as-is in the
    // Atlassian app's callback list — Atlassian rejects anything else.
    // Without strictPort, Vite silently falls back to the next free
    // port (5175, ...) whenever 5174 is already taken, and the app
    // keeps running there with no visible warning — except every Jira
    // OAuth login then breaks, since the redirect_uri sent to Atlassian
    // no longer matches wherever this dev server actually landed. This
    // makes that mismatch impossible instead of intermittent: either
    // the app runs on the one port the OAuth app expects, or `npm run
    // dev` fails immediately with a clear "port already in use".
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
