import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const target = process.env.OBI_API || 'http://localhost:3000'

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  plugins: [react()],
  resolve: {
    alias: { '@shared': path.resolve(import.meta.dirname, 'shared') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/p': { target, changeOrigin: true },
      '/ws': { target, ws: true, changeOrigin: true },
    },
    fs: { allow: ['..'] },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          const core = [
            '@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/language/',
            '@codemirror/autocomplete', '@codemirror/search', '@codemirror/lang-markdown',
            '@lezer/common', '@lezer/highlight', '@lezer/markdown', 'y-codemirror',
          ]
          if (core.some((p) => id.includes(p))) return 'editor'
          if (id.includes('/yjs/') || id.includes('y-protocols') || id.includes('/lib0/')) return 'yjs'
          if (id.includes('/react/') || id.includes('react-dom') || id.includes('zustand') || id.includes('scheduler')) return 'react'
          if (id.includes('/katex/')) return 'katex'
          if (id.includes('markdown-it') || id.includes('dompurify') || id.includes('/yaml/') || id.includes('diff-match-patch')) return 'markdown'
        },
      },
    },
  },
})
