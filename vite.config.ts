import { defineConfig } from 'vite'

// GitHub Pages serves a project page from /<repo>/, so the base path is
// configurable at build time and defaults to root for local preview.
export default defineConfig({
  base: process.env.PAGES_BASE ?? '/',
  build: { outDir: 'dist', emptyOutDir: true },
})
