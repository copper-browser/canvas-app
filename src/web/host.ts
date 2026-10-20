/**
 * The browser host: what Copper does for the page, done in the page's own tab.
 *
 * The page posts to `window.__copperHost` whenever there is no native handler
 * (`host-bridge.ts`); this host is that double's `onMessage`. It keeps each
 * canvas's Yjs log in IndexedDB (`store.ts`), opens canvases with
 * `copperCanvas.init`, relays updates between tabs of the same browser over a
 * BroadcastChannel, and routes on the URL hash: `#/` is the list of canvases,
 * `#/c/<id>` one canvas (`?focus=<shape>` fits that shape once it is there), `#/join/<token>`
 * a share link.
 *
 * Signed in to a canvas server (canvas-cloud, or a Copper Cloud; `cloud.ts`), a
 * canvas that lives there keeps its local copy here and opens online: the page's
 * provider talks to the room through a real WebSocket (`room.ts`). Served by a canvas server
 * with single sign-on, a "Continue with Google" leaves for the provider and comes back with the
 * session in the fragment (`auth.ts`); links followed signed out wait for it (`arrive.ts`).
 */
import * as Y from 'yjs'
import { fromBase64, toBase64 } from '../canvas/base64'
import { hostDouble, type PageMessage } from '../host-bridge'
import { CanvasDb, type CanvasRecord } from './store'
import { loadMe, newId, saveMe, type Me } from './identity'
import { CloudClient, homeServerInfo, parseServer, roomUrl, shareUrl, type CloudCanvas, type CloudInvite, type CloudSession } from './cloud'
import { CLOSE_DELETED, RoomRelay } from './room'
import { oidcStartUrl, parseAuthFragment, redirectTarget, signInErrorMessage, stashSignIn, takeSignIn, type AuthResult, type OidcProvider } from './auth'
import { arriveAtCanvas, arriveAtJoin, type Arrival, type ArrivalDeps, type ArrivalError } from './arrive'
import { focusWhenPresent } from './focus'
import { deploymentBrand, type Brand } from './brand'

/** Compact a canvas's log into one snapshot past this many entries or this much base64 (Copper: 500 entries or 2 MB). */
export const COMPACT_AFTER = 500
export const COMPACT_AFTER_CHARS = Math.ceil((2 * 1024 * 1024 * 4) / 3)

export const shouldCompact = ({ count, chars }: { count: number; chars: number }) => count > 1 && (count > COMPACT_AFTER || chars > COMPACT_AFTER_CHARS)
export const PLACE = 'in this browser'
export const EXPORT_FORMAT = 'canvas-app'

export type Route = { view: 'home' } | { view: 'canvas'; id: string; focus?: string } | { view: 'join'; token: string }

/**
 * What covers the board while a linked canvas can't open yet: a sign-in card, a moment of
 * "opening…", or why it won't open.
 */
export type Landing = { kind: 'signin'; reason: 'join' | 'canvas' } | { kind: 'busy'; text: string } | { kind: 'error'; code: ArrivalError; message: string }

/** How often an open cloud canvas folds what the room sent into its local copy. */
export const CLOUD_SNAPSHOT_MS = 60_000

export interface HostState {
  route: Route
  canvases: CanvasRecord[]
  me: Me
  /** The open canvas's record, once loaded. */
  current: CanvasRecord | null
  /** The share sheet is open (the page's Share button). */
  sharing: boolean
  error: string | null
  /** Signed in to a canvas server. */
  cloud: CloudSession | null
  /** The server that serves this page (canvas-cloud's `web_root`), to sign in to by default. */
  homeServer: string | null
  /** Its single sign-on providers (`GET /v1/info` → `auth.oidc`). */
  providers: OidcProvider[]
  /** `/v1/info` has answered (or failed): until then, don't guess which sign-in to show. */
  infoLoaded: boolean
  /** Why the last sign-in failed, shown where the person signs in. */
  authError: string | null
  landing: Landing | null
  /** Invites to other people's canvases, waiting for you (null: not listed). */
  invites: CloudInvite[] | null
  /** The deployment's mark for the host's screens (`brand.ts`). */
  brand: Brand | null
  /** Its canvases, once listed (null: not yet, or the list failed). */
  cloudCanvases: CloudCanvas[] | null
  cloudBusy: boolean
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
  const m = /^#\/c\/([A-Za-z0-9_-]{1,80})(?:\?([^#]*))?$/.exec(hash)
  if (m) {
    const focus = m[2] ? new URLSearchParams(m[2]).get('focus')?.trim() : null
    return focus && focus.length <= 200 ? { view: 'canvas', id: m[1]!, focus } : { view: 'canvas', id: m[1]! }
  }
  const j = /^#\/join\/([A-Za-z0-9_-]{20,80})$/.exec(hash)
  return j ? { view: 'join', token: j[1]! } : { view: 'home' }
}

export const routeHash = (route: Route) =>
  route.view === 'canvas' ? `#/c/${route.id}${route.focus ? `?focus=${encodeURIComponent(route.focus)}` : ''}` : route.view === 'join' ? `#/join/${route.token}` : '#/'

/** Two routes to the same place (a focus is part of it). */
export const sameRoute = (a: Route, b: Route) => routeHash(a) === routeHash(b)

const CLOUD_KEY = 'canvas-app:cloud'
const DEVICE_KEY = 'canvas-app:device'

function loadSession(): CloudSession | null {
  try {
    const v = JSON.parse(localStorage.getItem(CLOUD_KEY) ?? 'null') as CloudSession | null
    // `key` is only there for a Copper Cloud (its gate key); a canvas-cloud session has none.
    return v && typeof v.server === 'string' && typeof v.token === 'string' && (v.key === undefined || typeof v.key === 'string') && v.user ? v : null
  } catch {
    return null
  }
}

function device() {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) localStorage.setItem(DEVICE_KEY, (id = newId()))
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser'
  return { id, name: `Canvas App (${browser})` }
}

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
  /** The open cloud canvas's room socket. */
  private room: RoomRelay | null = null
  private snapshotTimer: ReturnType<typeof setInterval> | undefined
  /** A sign-in's answer, read from the fragment at load (and wiped from the address bar). */
  private returned: { result: AuthResult; provider?: string } | null = null
  private stopFocus: (() => void) | null = null
  private focusFallback: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly db: CanvasDb) {
    const cloud = loadSession()
    const result = parseAuthFragment(location.hash)
    if (result) {
      // Back from the provider: the session (or why not) is in the fragment. Put the route the
      // person left from back in its place, so the token never stays in the address bar or history.
      const ret = takeSignIn()
      this.returned = { result, provider: ret.provider }
      history.replaceState(history.state, '', `${location.pathname}${location.search}${ret.hash}`)
    }
    this.state = {
      route: parseRoute(location.hash),
      canvases: [],
      me: cloud ? { ...loadMe(), name: cloud.user.display_name || loadMe().name } : loadMe(),
      current: null,
      sharing: false,
      error: null,
      cloud,
      cloudCanvases: null,
      cloudBusy: false,
      homeServer: null,
      providers: [],
      infoLoaded: false,
      authError: null,
      landing: null,
      invites: null,
      brand: deploymentBrand(),
    }
  }

  private client(session: CloudSession | null = this.state.cloud) {
    return session ? new CloudClient(session.server, session.key, session.token) : null
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
    const home = await homeServerInfo()
    this.set({ homeServer: home?.server ?? null, providers: home?.providers ?? [], infoLoaded: true })
    if (this.returned) await this.finishSignIn(this.returned.result, this.returned.provider)
    this.returned = null
    void this.refreshCloud()
    void this.refreshInvites()
    // A first visit opens a canvas straight away rather than an empty list — unless this page's
    // server signs people in, where the list leads with that.
    const signsIn = this.state.providers.length > 0
    if (this.state.route.view === 'home' && this.state.canvases.length === 0 && !this.state.cloud && !signsIn && !sessionStorage.getItem('canvas-app:home')) {
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
      case 'wsOpen':
        this.room?.connect()
        if (!this.room) this.api.wsState('closed')
        return
      case 'ws':
        this.room?.send(msg.b64)
        return
      case 'wsClose':
        this.room?.close()
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
        const grown = await this.db.append(canvasId, b64)
        if (shouldCompact(grown) && this.openId === canvasId) await this.db.compact(canvasId, this.api.exportState())
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

  /** Go to `route` in place of the current one (a share link becomes its canvas; Back skips it). */
  private replaceRoute(route: Route) {
    history.replaceState(history.state, '', `${location.pathname}${location.search}${routeHash(route)}`)
    return this.route(route)
  }

  private get currentRoute() {
    return this.state.route
  }

  private arrivalDeps(): ArrivalDeps {
    const client = this.client()
    const missing = () => Promise.reject(new Error('Sign in first.'))
    return {
      session: this.state.cloud,
      homeServer: this.state.homeServer,
      local: id => this.db.get(id),
      fetch: id => (client ? client.canvas(id) : missing()),
      join: token => (client ? client.join(token) : missing()),
      keep: c => this.keepCloud(c),
    }
  }

  private async route(route: Route) {
    this.cancelFocus()
    this.set({ route, sharing: false, landing: null })
    if (route.view === 'join') {
      document.title = 'Join a canvas · Canvas'
      if (this.state.cloud) this.set({ landing: { kind: 'busy', text: 'Opening the shared canvas…' } })
      const arrival = await arriveAtJoin(route.token, this.arrivalDeps())
      if (!sameRoute(this.currentRoute, route)) return
      if (arrival.do === 'open') {
        void this.refreshCloud()
        void this.refreshInvites()
        await this.replaceRoute({ view: 'canvas', id: arrival.record.id })
        return
      }
      await this.land(arrival, 'join')
      return
    }
    if (route.view === 'home') {
      sessionStorage.setItem('canvas-app:home', '1')
      document.title = 'Canvas'
      await this.refresh()
      return
    }
    await this.open(route.id, route.focus)
  }

  /** Show what an arrival that does not open a canvas means. */
  private async land(arrival: Exclude<Arrival, { do: 'open' }>, reason: 'join' | 'canvas') {
    // The canvas open before (if any) stays under the card, no longer live.
    this.closeRoom()
    if (arrival.do === 'signin') {
      // A session the server no longer takes is ended here too.
      if (this.state.cloud) await this.endSession('Your session on the canvas server ended; sign in again.')
      document.title = reason === 'join' ? 'Join a canvas · Canvas' : 'Sign in · Canvas'
      this.set({ landing: { kind: 'signin', reason } })
      return
    }
    if (arrival.do === 'missing') {
      this.fail('That canvas is not in this browser.')
      this.navigate({ view: 'home' })
      return
    }
    document.title = 'Canvas'
    this.set({ landing: { kind: 'error', code: arrival.code, message: arrival.message } })
  }

  private async open(id: string, focus?: string) {
    const route = this.currentRoute
    const local = await this.db.get(id)
    if (!local && this.state.cloud) this.set({ landing: { kind: 'busy', text: 'Opening canvas…' } })
    const arrival = await arriveAtCanvas(id, this.arrivalDeps())
    if (!sameRoute(this.currentRoute, route)) return
    if (arrival.do !== 'open') {
      await this.land(arrival, 'canvas')
      return
    }
    const record = arrival.record
    // Wait for queued writes, so the log read back holds everything.
    await this.writes
    const log = await this.db.updates(id)
    const state = mergeLog(log)
    await this.whenReady()
    this.closeRoom()
    const session = this.state.cloud
    const online = !!record.cloud && !!session && session.server === record.cloud.server
    if (online) {
      const canvasId = record.cloud!.canvasId
      this.room = new RoomRelay(
        () => roomUrl(session!, canvasId),
        () => this.api,
        code => this.fail(code === CLOSE_DELETED ? 'This canvas was deleted on its server.' : 'You no longer have access to this canvas.')
      )
      // What the room sends never comes back as an update to keep; fold it in now and then.
      this.snapshotTimer = setInterval(() => this.compactOpen(id), CLOUD_SNAPSHOT_MS)
    }
    this.openId = id
    this.api.init({ docId: record.cloud?.canvasId ?? id, name: record.name, kind: record.kind, me: this.state.me, state, online, readOnly: false, place: PLACE })
    if (focus) this.focusOn(id, focus, online)
    this.api.setStatus(record.cloud ? { mode: online ? (record.kind === 'personal' ? 'personal-synced' : 'shared-live') : record.kind === 'shared' ? 'shared-offline' : 'local' } : null)
    this.api.setNav({ home: true })
    this.api.setShare(record.kind === 'personal' && record.cloud ? { canShare: false, reason: 'Personal canvases cannot be shared' } : { canShare: true })
    document.title = `${record.name} · Canvas`
    this.set({ current: record, landing: null })
    // A log of several entries (another tab's edits, or one too small to compact) is merged
    // on every open; store the merge once the board is up, so the next open reads one row.
    if (log.length > 1) setTimeout(() => this.compactOpen(id), 1500)
  }

  private closeRoom() {
    this.room?.close()
    this.room = null
    clearInterval(this.snapshotTimer)
  }

  /**
   * Fit `shape` once the board holds it. Online, wait for the room's first sync (a cached copy
   * may hold it somewhere it no longer is); if the room is slow, look anyway after a while.
   */
  private focusOn(canvasId: string, shape: string, online: boolean) {
    this.cancelFocus()
    const look = () => {
      clearTimeout(this.focusFallback)
      if (this.room) this.room.onSynced = null
      this.stopFocus = focusWhenPresent(this.api, shape, { stillWanted: () => this.openId === canvasId })
    }
    if (!online || !this.room) {
      look()
      return
    }
    this.room.onSynced = look
    this.focusFallback = setTimeout(look, 8000)
  }

  private cancelFocus() {
    clearTimeout(this.focusFallback)
    if (this.room) this.room.onSynced = null
    this.stopFocus?.()
    this.stopFocus = null
  }

  private compactOpen(id: string) {
    this.writes = this.writes
      .then(async () => {
        if (this.openId === id) await this.db.compact(id, this.api.exportState())
      })
      .catch(error => this.fail(`Could not save the canvas in this browser: ${message(error)}`))
  }

  // ---- Copper Cloud -----------------------------------------------------------------

  /** Sign in to `server` (an address, or a Copper Cloud link code). */
  async connect(opts: { server: string; email: string; password: string; signup: boolean; displayName?: string }) {
    const { server, key } = parseServer(opts.server)
    const session = await new CloudClient(server, key).signIn(opts.email, opts.password, { signup: opts.signup, device: device(), displayName: opts.displayName })
    await this.signedIn(session)
  }

  /** Keep a new session (password or single sign-on alike), then carry on where the person was. */
  private async signedIn(session: CloudSession) {
    localStorage.setItem(CLOUD_KEY, JSON.stringify(session))
    this.set({ cloud: session, authError: null, me: { ...this.state.me, name: session.user.display_name || this.state.me.name } })
    void this.refreshInvites()
    await this.refreshCloud()
    // A link that waited for the sign-in opens now (joining again is harmless).
    if (this.state.landing?.kind === 'signin') await this.route(this.state.route)
  }

  /** Sign in with a provider of this page's server: leaves the page, comes back with `#token=…`. */
  signInWith(provider: OidcProvider) {
    const server = this.state.homeServer
    if (!server) return
    stashSignIn({ hash: routeHash(this.state.route), provider: provider.name })
    this.set({ authError: null })
    location.assign(oidcStartUrl(server, provider, redirectTarget(location)))
  }

  /** The provider's answer: keep the session, or say why there is none. */
  private async finishSignIn(result: AuthResult, provider?: string) {
    const domain = this.state.brand?.domain ?? null
    if (result.kind === 'error') {
      this.set({ authError: signInErrorMessage(result.code, result.description, { provider, domain }) })
      return
    }
    const server = this.state.homeServer ?? location.origin
    try {
      const user = await new CloudClient(server, undefined, result.token).me()
      await this.signedIn({ server, token: result.token, user })
    } catch (error) {
      this.set({ authError: (error as { status?: number }).status === 0 ? message(error) : signInErrorMessage('session_check_failed', '', { provider, domain }) })
    }
  }

  async disconnect() {
    const client = this.client()
    localStorage.removeItem(CLOUD_KEY)
    this.closeRoom()
    this.set({ cloud: null, cloudCanvases: null, invites: null })
    try {
      await client?.signOut()
    } catch {
      // Signed out here either way; the server's session expires on its own.
    }
    // An open server canvas can't stay live without a session.
    if (this.state.route.view === 'canvas' && this.state.current?.cloud) await this.route(this.state.route)
  }

  /** The server refused the session: forget it, and say so. */
  private async endSession(why: string) {
    localStorage.removeItem(CLOUD_KEY)
    this.closeRoom()
    this.set({ cloud: null, cloudCanvases: null, invites: null, authError: why })
  }

  async refreshCloud() {
    const client = this.client()
    if (!client) return
    this.set({ cloudBusy: true })
    try {
      this.set({ cloudCanvases: await client.canvases(), cloudBusy: false })
    } catch (error) {
      this.set({ cloudBusy: false, cloudCanvases: null })
      if ((error as { status?: number }).status === 401) {
        this.fail('Your session on the canvas server ended; sign in again.')
        await this.disconnect()
      } else this.fail(message(error))
    }
  }

  /** Invites waiting for you; a failure only hides the list. */
  async refreshInvites() {
    const client = this.client()
    if (!client) return
    try {
      this.set({ invites: await client.invites() })
    } catch {
      this.set({ invites: null })
    }
  }

  /** Accept an invite and open its canvas. */
  async acceptInvite(invite: CloudInvite) {
    const client = this.client()
    if (!client) return
    const c = await client.acceptInvite(invite.id)
    this.set({ invites: (this.state.invites ?? []).filter(i => i.id !== invite.id) })
    void this.refreshCloud()
    await this.openCloud(c)
  }

  async declineInvite(invite: CloudInvite) {
    const client = this.client()
    if (!client) return
    await client.declineInvite(invite.id)
    this.set({ invites: (this.state.invites ?? []).filter(i => i.id !== invite.id) })
  }

  /** Open a canvas from the server: its local copy, created on first open. */
  async openCloud(c: CloudCanvas) {
    if (!this.state.cloud) return
    await this.keepCloud(c)
    this.navigate({ view: 'canvas', id: c.id })
  }

  /** The local record of a server canvas: made on first open, its name and kind kept current. */
  private async keepCloud(c: CloudCanvas): Promise<CanvasRecord> {
    const session = this.state.cloud
    if (!session) throw new Error('Sign in to a canvas server first.')
    const now = Date.now()
    const cloud = { server: session.server, canvasId: c.id }
    const next = await this.db.patch(c.id, { name: c.name, kind: c.kind, cloud })
    if (next) return next
    const record: CanvasRecord = { id: c.id, name: c.name, kind: c.kind, createdAt: now, updatedAt: now, cloud }
    await this.db.put(record)
    return record
  }

  /** A share link anyone can open: in Copper, or here (`/canvas/#/join/…` on the server). */
  async shareLink(id: string): Promise<string> {
    const record = await this.db.get(id)
    const client = this.client()
    if (!record?.cloud || !client) throw new Error('Put the canvas on your canvas server first.')
    const link = await client.createLink(record.cloud.canvasId)
    return shareUrl(record.cloud.server, link.token)
  }

  /** A new canvas on the server, opened. */
  async createOnServer(name = 'Untitled canvas') {
    const client = this.client()
    if (!client) throw new Error('Sign in to a canvas server first.')
    const c = await client.create(name)
    void this.refreshCloud()
    await this.openCloud(c)
  }

  /** Make a canvas of this browser a shared one on the server, carrying what it holds. */
  async moveToCloud(id: string): Promise<CanvasRecord> {
    const client = this.client()
    const session = this.state.cloud
    if (!client || !session) throw new Error('Sign in to a canvas server first.')
    await this.writes
    const record = await this.db.get(id)
    if (!record) throw new Error('That canvas is not in this browser.')
    const state = this.openId === id ? this.api.exportState() : mergeLog(await this.db.updates(id))
    const c = await client.create(record.name)
    const now = Date.now()
    const next: CanvasRecord = { id: c.id, name: c.name, kind: 'shared', createdAt: record.createdAt, updatedAt: now, cloud: { server: session.server, canvasId: c.id } }
    await this.db.put(next)
    // The room merges this copy in on first sync (the provider sends what the server lacks).
    if (state) await this.db.compact(next.id, state)
    await this.remove(id)
    await this.refreshCloud()
    this.navigate({ view: 'canvas', id: next.id })
    return next
  }

  // ---- canvases -------------------------------------------------------------------

  async refresh() {
    this.set({ canvases: await this.db.list() })
  }

  async create(name = 'Untitled canvas', state: string | null = null): Promise<CanvasRecord> {
    const now = Date.now()
    const record: CanvasRecord = { id: newId(), name: name.trim() || 'Untitled canvas', kind: 'personal', createdAt: now, updatedAt: now }
    await this.db.put(record)
    if (state) await this.db.compact(record.id, state)
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
    if (this.openId === id) {
      this.openId = null
      this.closeRoom()
    }
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

  clearAuthError() {
    this.set({ authError: null })
  }

  /** Try the current route again (a canvas that failed to open). */
  retry() {
    void this.route(this.state.route)
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
