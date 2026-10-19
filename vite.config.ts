import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

const here = path.dirname(fileURLToPath(import.meta.url))

/** The dev server serves `index.html`/`web.html`; the shipped files are `canvas.html` and `web/index.html`. */
function renameHtml(from: string, to: string): Plugin {
  let outDir = 'dist'
  return {
    name: 'copper-canvas-rename-html',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const src = path.join(outDir, from)
      if (fs.existsSync(src)) fs.renameSync(src, path.join(outDir, to))
    },
  }
}

/**
 * The embedded page never talks to the network: its build allows no
 * connections at all (the host relays the sync socket over the bridge). Dev
 * keeps a socket open for hot reload. Images may come from https URLs, and
 * live web frames (`canvas/frames.ts`) show http(s) pages — those documents
 * are the sites' own, under their own policies; this one still connects nowhere.
 * The web app (`--mode web`) is its own host, so it may reach a sync server.
 */
function csp(web: boolean): Plugin {
  const connect = (dev: boolean) => (web ? "'self' https: wss:" : dev ? "'self' ws: wss:" : "'none'")
  const policy = (dev: boolean) =>
    [
      "default-src 'none'",
      `script-src ${dev ? "'self' 'unsafe-inline'" : "'unsafe-inline'"}`,
      "style-src 'self' 'unsafe-inline'",
      'img-src data: blob: https: http:',
      'frame-src https: http:',
      `connect-src ${connect(dev)}${web && dev ? ' ws:' : ''}`,
      'font-src data:',
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; ')
  let dev = true
  return {
    name: 'copper-canvas-csp',
    configResolved(config) {
      dev = config.command === 'serve'
    },
    transformIndexHtml(html) {
      return html.replace('__CANVAS_CSP__', policy(dev))
    },
  }
}

/**
 * One self-contained file per build, every script, style and asset inlined:
 * - `vite build`: `dist/canvas.html`, the page a host embeds (Copper loads it
 *   from the app bundle with no network);
 * - `vite build --mode web`: `dist/web/index.html`, Canvas App, the page with
 *   its own browser host (`src/web/`) — one file to put on any static server.
 */
export default defineConfig(({ mode }) => {
  const web = mode === 'web'
  return {
    plugins: [
      react(),
      tailwindcss(),
      csp(web),
      viteSingleFile({ removeViteModuleLoader: true }),
      web ? renameHtml('web.html', 'index.html') : renameHtml('index.html', 'canvas.html'),
    ],
    resolve: { alias: { '@': path.resolve(here, 'src') } },
    build: {
      target: 'safari16',
      outDir: web ? 'dist/web' : 'dist',
      // The embed build shares `dist/` with `dist/web/`; each overwrites only its own file.
      emptyOutDir: web,
      rollupOptions: { input: path.resolve(here, web ? 'web.html' : 'index.html') },
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      reportCompressedSize: false,
    },
    server: { port: 5173, strictPort: false },
  }
})
