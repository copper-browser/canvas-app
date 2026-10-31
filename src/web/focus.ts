/**
 * What an open brings into view once the board holds it. A deep link's focus
 * (`#/c/<canvas>?focus=<shape>`): that shape, fitted and centred. Any other open: the whole
 * board, fitted and centred, never closer than 100%. What is looked for may arrive with the
 * room's first sync, or never (a shape deleted since the link was made, an empty canvas) —
 * then nothing happens.
 */

export interface FocusPage {
  read(optsJson?: unknown): string
  zoomTo(ids: unknown, opts?: unknown): void
}

export interface FocusOptions {
  /** Give up after this long (the shape is not coming). */
  timeoutMs?: number
  intervalMs?: number
  /** False once the person has moved on (another canvas, home): stop quietly. */
  stillWanted?: () => boolean
  /** Called once, right after the shape was found and fitted. */
  onFound?: () => void
  /** Called once when the time ran out with nothing found. */
  onGiveUp?: () => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/** Whether the board holds `id` (any shape type, frames included). */
export function boardHas(page: Pick<FocusPage, 'read'>, id: string): boolean {
  try {
    const out = JSON.parse(page.read(JSON.stringify({ ids: [id] }))) as { shapes?: { id?: unknown }[]; frames?: { id?: unknown }[] } | null
    return !!out && [...(out.shapes ?? []), ...(out.frames ?? [])].some(s => s?.id === id)
  } catch {
    return false
  }
}

/** Whether the board holds anything to fit (an arrow alone does not count). */
export function boardHasContent(page: Pick<FocusPage, 'read'>): boolean {
  try {
    const out = JSON.parse(page.read(JSON.stringify({ overview: true }))) as { counts?: Record<string, unknown> } | null
    return !!out?.counts && Object.entries(out.counts).some(([kind, n]) => kind !== 'arrow' && typeof n === 'number' && n > 0)
  } catch {
    return false
  }
}

/** How a fit-on-open zooms: the whole board, never past 100%. */
export const FIT_ALL = { fit: true, all: true, maxZoom: 1 } as const

/** Poll until `present()`, then `act()` once. Answers a cancel. */
function whenPresent(present: () => boolean, act: () => void, opts: FocusOptions): () => void {
  const { timeoutMs = 20_000, intervalMs = 250, stillWanted = () => true, now = Date.now } = opts
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>))
  const started = now()
  let handle: unknown = null
  let done = false
  const tick = () => {
    handle = null
    if (done || !stillWanted()) return
    if (present()) {
      done = true
      act()
      opts.onFound?.()
      return
    }
    if (now() - started < timeoutMs) handle = setTimer(tick, intervalMs)
    else opts.onGiveUp?.()
  }
  tick()
  return () => {
    done = true
    if (handle !== null) clearTimer(handle)
  }
}

/** Start looking for `id`; zooms to it once found. Answers a cancel. */
export function focusWhenPresent(page: FocusPage, id: string, opts: FocusOptions = {}): () => void {
  return whenPresent(
    () => boardHas(page, id),
    () => page.zoomTo([id], { fit: true }),
    opts
  )
}

/** Wait for the board to hold something; then fit all of it, once (never past 100%). Answers a cancel. */
export function fitAllWhenPresent(page: FocusPage, opts: FocusOptions = {}): () => void {
  return whenPresent(
    () => boardHasContent(page),
    () => page.zoomTo([], FIT_ALL),
    opts
  )
}

/** What on the board counts as the person moving about it themselves: a pan, zoom, click or key. */
export const TOUCH_EVENTS = ['pointerdown', 'wheel', 'keydown'] as const

/** Call `touched` on the first pan, zoom, click or key inside `board` (the canvas page's root). Answers a stop. */
export function watchTouch(board: EventTarget | null | undefined, touched: () => void): () => void {
  if (!board) return () => {}
  const on = () => touched()
  for (const type of TOUCH_EVENTS) board.addEventListener(type, on, { capture: true, passive: true })
  return () => {
    for (const type of TOUCH_EVENTS) board.removeEventListener(type, on, { capture: true })
  }
}

/** A slow room: look at what the board has by then anyway. */
export const FOCUS_FALLBACK_MS = 8_000

export interface OpenFocusOptions {
  /** A deep link's shape, or null: the whole board. */
  shape: string | null
  /** Online with a room: what to bring into view may come with its first sync, so wait for it. */
  waitForSync: boolean
  /** False once the person has left this open (another canvas, home). */
  stillOpen: () => boolean
  /** Listen for the person moving the board themselves (a whole-board fit only); answers a stop. */
  watchTouch?: (touched: () => void) => () => void
  fallbackMs?: number
  /** Polling and clocks (tests run them by hand). */
  look?: Pick<FocusOptions, 'timeoutMs' | 'intervalMs' | 'now' | 'setTimer' | 'clearTimer'>
}

/**
 * One canvas open's first view: the linked shape, else the whole board, brought into view once.
 * Online it waits for the room's sync (a cached copy may hold the shape somewhere it no longer
 * is), or the fallback; a cached board with something on it is fitted whole at once. A sync that
 * comes later looks again, until it has been done. The whole-board fit leaves the view alone
 * once the person has moved about the board themselves, and gives up on a board that stays empty.
 */
export class OpenFocus {
  private pending = true
  private stopLook: (() => void) | null = null
  private fallback: unknown = null
  private stopTouch: (() => void) | null = null
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(
    private readonly page: FocusPage,
    private readonly o: OpenFocusOptions
  ) {
    this.setTimer = o.look?.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = o.look?.clearTimer ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>))
    if (o.shape === null && o.watchTouch) this.stopTouch = o.watchTouch(() => this.cancel())
    if (!o.waitForSync || (o.shape === null && boardHasContent(page))) this.look()
    else this.fallback = this.setTimer(() => this.look(), o.fallbackMs ?? FOCUS_FALLBACK_MS)
  }

  /** Still to be brought into view. */
  get waiting() {
    return this.pending
  }

  /** The room's sync for this connection: look (again), unless it has been done. */
  synced() {
    if (this.pending) this.look()
  }

  /** Done with, quietly: the person moved on or moved the board. */
  cancel() {
    this.pending = false
    this.stopLook?.()
    this.stopLook = null
    this.release()
  }

  private look() {
    if (!this.pending) return
    this.dropFallback()
    this.stopLook?.()
    const finish = () => {
      this.pending = false
      this.release()
    }
    const opts: FocusOptions = { ...this.o.look, stillWanted: () => this.pending && this.o.stillOpen(), onFound: finish }
    // An empty board stays as it is, and one filled much later is not flown to.
    this.stopLook = this.o.shape === null ? fitAllWhenPresent(this.page, { ...opts, onGiveUp: finish }) : focusWhenPresent(this.page, this.o.shape, opts)
  }

  private dropFallback() {
    if (this.fallback !== null) this.clearTimer(this.fallback)
    this.fallback = null
  }

  private release() {
    this.dropFallback()
    this.stopTouch?.()
    this.stopTouch = null
  }
}
