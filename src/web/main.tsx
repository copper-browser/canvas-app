/**
 * Canvas App: the canvas page plus a host that lives in the same tab, for any
 * browser. The host listens before the page module runs, so it hears `ready`.
 */
import { createRoot } from 'react-dom/client'
import { CanvasDb } from './store'
import { WebHost } from './host'
import { WebShell } from './Home'
import './web.css'

async function boot() {
  let db: CanvasDb
  try {
    db = await CanvasDb.open()
  } catch (error) {
    document.body.textContent = `Canvas needs IndexedDB, which this browser refused (${error instanceof Error ? error.message : String(error)}). A private window may block it.`
    return
  }
  const host = new WebHost(db)
  host.attach()
  await import('../main')
  createRoot(document.getElementById('web-root')!).render(<WebShell host={host} />)
  await host.start()
  Object.defineProperty(window, '__canvasApp', { value: host, configurable: true })
}

void boot()
