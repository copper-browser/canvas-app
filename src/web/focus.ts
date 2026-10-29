/**
 * A deep link's focus (`#/c/<canvas>?focus=<shape>`): once the board holds that shape, fit
 * and centre it. The shape may arrive with the room's first sync, or never (deleted since the
 * link was made) — then nothing happens.
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

/** Start looking for `id`; zooms to it once found. Answers a cancel. */
export function focusWhenPresent(page: FocusPage, id: string, opts: FocusOptions = {}): () => void {
  const { timeoutMs = 20_000, intervalMs = 250, stillWanted = () => true, now = Date.now } = opts
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>))
  const started = now()
  let handle: unknown = null
  let done = false
  const tick = () => {
    handle = null
    if (done || !stillWanted()) return
    if (boardHas(page, id)) {
      done = true
      page.zoomTo([id], { fit: true })
      opts.onFound?.()
      return
    }
    if (now() - started < timeoutMs) handle = setTimer(tick, intervalMs)
  }
  tick()
  return () => {
    done = true
    if (handle !== null) clearTimer(handle)
  }
}
