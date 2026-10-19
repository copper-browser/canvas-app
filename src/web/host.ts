/**
 * The browser host: what Copper does for the page, done in the page's own tab.
 *
 * The page posts to `window.__copperHost` whenever there is no native handler
 * (`host-bridge.ts`); this host is that double's `onMessage`. It keeps each
 * canvas's Yjs log in IndexedDB (`store.ts`), opens canvases with
 * `copperCanvas.init`, relays updates between tabs of the same browser over a
 * BroadcastChannel, and routes on the URL hash: `#/` is the list of canvases,
 * `#/c/<id>` one canvas.
 */
import * as Y from 'yjs'
import { fromBase64, toBase64 } from '../canvas/base64'
import { hostDouble, type PageMessage } from '../host-bridge'
import { CanvasDb, type CanvasRecord } from './store'
import { loadMe, newId, saveMe, type Me } from './identity'

/** Compact a canvas's log into one snapshot past this many entries (Copper: 500). */
export const COMPACT_AFTER = 500
export const PLACE = 'in this browser'
export const EXPORT_FORMAT = 'canvas-app'

export type Route = { view: 'home' } | { view: 'canvas'; id: string }

export interface HostState {
  route: Route
  canvases: CanvasRecord[]
  me: Me
  /** The open canvas's record, once loaded. */
  current: CanvasRecord | null
  /** The share sheet is open (the page's Share button). */
  sharing: boolean
  error: string | null
}

export interface CanvasFile {
  format: typeof EXPORT_FORMAT
  version: 1
  name: string
  exportedAt: string
  /** base64 of `Y.encodeStateAsUpdate`. */
  state: string
}

type Listener = () => void

interface TabMessage {
  type: 'update' | 'list'
  tab: string
  canvasId?: string
  b64?: string
}

export function parseRoute(hash: string): Route {
  const m = /^#\/c\/([A-Za-z0-9_-]{1,80})$/.exec(hash)
  return m ? { view: 'canvas', id: m[1]! } : { view: 'home' }
}

export const routeHash = (route: Route) => (route.view === 'canvas' ? `#/c/${route.id}` : '#/')

/** Merge a stored log (or a file's state) into one update. */
export const mergeLog = (log: readonly string[]): string | null =>
  log.length === 0 ? null : log.length === 1 ? log[0]! : toBase64(Y.mergeUpdates(log.map(fromBase64)))

export function parseCanvasFile(text: string): CanvasFile {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    throw new Error('Not a canvas file (it is not JSON).')
  }
  const f = v as Partial<CanvasFile> | null
  if (!f || f.format !== EXPORT_FORMAT || typeof f.state !== 'string') throw new Error('Not a canvas file.')
  // Throws on bytes that are not a Yjs update.
  Y.decodeUpdate(fromBase64(f.state))
  return {
    format: EXPORT_FORMAT,
    version: 1,
    name: typeof f.name === 'string' && f.name.trim() ? f.name.trim() : 'Imported canvas',
    exportedAt: typeof f.exportedAt === 'string' ? f.exportedAt : new Date().toISOString(),
    state: f.state,
  }
}

export class WebHost {
  private listeners = new Set<Listener>()
  private state: HostState
  private ready = false
  private readyWaiters: Array<() => void> = []
  private writes: Promise<unknown> = Promise.resolve()
  private readonly tab = newId()
  private channel: BroadcastChannel | null = null
  /** The canvas the page holds now (set before `init`, so its first updates are kept). */
  private openId: string | null = null

  constructor(private readonly db: CanvasDb) {
    this.state = { route: parseRoute(location.hash), canvases: [], me: loadMe(), current: null, sharing: false, error: null }
  }

  // ---- React store ----------------------------------------------------------------

  subscribe = (fn: Listener) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  getState = () => this.state
  private set(patch: Partial<HostState>) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  // ---- start ----------------------------------------------------------------------

  /** Listen to the page; call before the page module runs, so `ready` is heard. */
  attach() {
    const double = hostDouble()
    double.onMessage = msg => this.received(msg)
    // The page may already have said ready (a reload of this module in dev).
    if (double.messages.some(m => m.type === 'ready')) this.markReady()
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('canvas-app')
      this.channel.onmessage = e => this.fromTab(e.data as TabMessage)
    }
    window.addEventListener('hashchange', () => void this.route(parseRoute(location.hash)))
  }

  async start() {
    await this.refresh()
    // A first visit opens a canvas straight away rather than an empty list.
    if (this.state.route.view === 'home' && this.state.canvases.length === 0 && !sessionStorage.getItem('canvas-app:home')) {
      const record = await this.create('My canvas')
      this.navigate({ view: 'canvas', id: record.id })
      return
    }
    await this.route(this.state.route)
  }

  private markReady() {
    if (this.ready) return
    this.ready = true
    for (const fn of this.readyWaiters.splice(0)) fn()
  }
  private whenReady() {
    return this.ready ? Promise.resolve() : new Promise<void>(resolve => this.readyWaiters.push(resolve))
  }

  private get api() {
    const api = window.copperCanvas
    if (!api) throw new Error('canvas page not installed')
    return api
  }

  // ---- page → host ----------------------------------------------------------------

  private received(msg: PageMessage) {
    switch (msg.type) {
      case 'ready':
        this.markReady()
        return
      case 'update':
        // An update names its canvas, so a session closing as the next opens keeps to its own log.
        if (msg.docId) this.keep(msg.docId, msg.b64, true)
        return
      case 'openUrl':
        window.open(msg.url, '_blank', 'noopener,noreferrer')
        return
      case 'home':
        this.navigate({ view: 'home' })
        return
      case 'share':
        this.set({ sharing: true })
        return
      default:
        return
    }
  }

  /** Append to the log (in order), tell other tabs, compact a long log. */
  private keep(canvasId: string, b64: string, broadcast: boolean) {
    if (broadcast) this.post({ type: 'update', tab: this.tab, canvasId, b64 })
    this.writes = this.writes
      .then(async () => {
        const count = await this.db.append(canvasId, b64)
        if (count > COMPACT_AFTER && this.openId === canvasId) await this.db.compact(canvasId, this.api.exportState())
      })
      .catch(error => this.fail(`Could not save the canvas in this browser: ${message(error)}`))
  }

  private post(msg: TabMessage) {
    try {
      this.channel?.postMessage(msg)
    } catch {
      // A closed channel only loses the cross-tab echo; the log has the update.
    }
  }

  private fromTab(msg: TabMessage) {
    if (!msg || msg.tab === this.tab) return
    if (msg.type === 'update' && msg.canvasId && msg.canvasId === this.openId && msg.b64) {
      // Kept by the tab that made it; here it is only drawn.
      this.api.applyUpdate(msg.b64)
    }
    if (msg.type === 'list' || msg.type === 'update') void this.refresh()
  }

  // ---- routing --------------------------------------------------------------------

  navigate(route: Route) {
    const hash = routeHash(route)
    if (location.hash !== hash) location.hash = hash
    else void this.route(route)
  }

  private async route(route: Route) {
    this.set({ route, sharing: false })
    if (route.view === 'home') {
      sessionStorage.setItem('canvas-app:home', '1')
      document.title = 'Canvas'
      await this.refresh()
      return
    }
    await this.open(route.id)
  }

  private async open(id: string) {
    const record = await this.db.get(id)
    if (!record) {
      this.fail('That canvas is not in this browser.')
      this.navigate({ view: 'home' })
      return
    }
    // Wait for queued writes, so the log read back holds everything.
    await this.writes
    const state = mergeLog(await this.db.updates(id))
    await this.whenReady()
    this.openId = id
    this.api.init({ docId: id, name: record.name, kind: record.kind, me: this.state.me, state, online: false, readOnly: false, place: PLACE })
    this.api.setNav({ home: true })
    this.api.setShare({ canShare: true })
    document.title = `${record.name} · Canvas`
    this.set({ current: record })
  }

  // ---- canvases -------------------------------------------------------------------

  async refresh() {
    this.set({ canvases: await this.db.list() })
  }

  async create(name = 'Untitled canvas', state: string | null = null): Promise<CanvasRecord> {
    const now = Date.now()
    const record: CanvasRecord = { id: newId(), name: name.trim() || 'Untitled canvas', kind: 'personal', createdAt: now, updatedAt: now }
    await this.db.put(record)
    if (state) await this.db.append(record.id, state, now)
    this.post({ type: 'list', tab: this.tab })
    await this.refresh()
    return record
  }

  async rename(id: string, name: string) {
    const next = await this.db.patch(id, { name: name.trim() || 'Untitled canvas', updatedAt: Date.now() })
    if (next && this.state.current?.id === id) {
      this.set({ current: next })
      document.title = `${next.name} · Canvas`
    }
    this.post({ type: 'list', tab: this.tab })
    await this.refresh()
  }

  async remove(id: string) {
    await this.writes
    await this.db.remove(id)
    if (this.openId === id) this.openId = null
    this.post({ type: 'list', tab: this.tab })
    await this.refresh()
  }

  /** A canvas as a file anyone with this app (or Copper) can open. */
  async exportFile(id: string): Promise<{ name: string; file: CanvasFile }> {
    await this.writes
    const record = await this.db.get(id)
    if (!record) throw new Error('That canvas is not in this browser.')
    const state = this.openId === id ? this.api.exportState() : (mergeLog(await this.db.updates(id)) ?? toBase64(Y.encodeStateAsUpdate(new Y.Doc())))
    return { name: record.name, file: { format: EXPORT_FORMAT, version: 1, name: record.name, exportedAt: new Date().toISOString(), state } }
  }

  async importFile(text: string): Promise<CanvasRecord> {
    const file = parseCanvasFile(text)
    return this.create(file.name, file.state)
  }

  setName(name: string) {
    const me = { ...this.state.me, name: name.trim() || 'You' }
    saveMe(me)
    this.set({ me })
    // The board shows the new name the next time it opens.
  }

  closeShare() {
    this.set({ sharing: false })
  }

  fail(error: string | null) {
    this.set({ error })
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
