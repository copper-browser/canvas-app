import { describe, expect, it, vi } from 'vitest'
import { FIT_ALL, OpenFocus, TOUCH_EVENTS, boardHas, boardHasContent, fitAllWhenPresent, focusWhenPresent, watchTouch, type FocusPage } from '../focus'

/** A page whose board gains shapes over time; timers run by hand. */
function setup(shapes: string[] = []) {
  const zooms: unknown[] = []
  const page: FocusPage = {
    read: (opts?: unknown) => {
      const o = JSON.parse(String(opts)) as { ids?: string[]; overview?: boolean }
      if (o.overview) {
        // An arrow is an id that starts with "arrow"; anything else a sticky.
        const counts: Record<string, number> = {}
        for (const s of shapes) counts[s.startsWith('arrow') ? 'arrow' : 'sticky'] = (counts[s.startsWith('arrow') ? 'arrow' : 'sticky'] ?? 0) + 1
        return JSON.stringify({ overview: true, total: shapes.length, counts })
      }
      const ids = o.ids ?? []
      return JSON.stringify({ shapes: shapes.filter(s => ids.includes(s)).map(id => ({ id })) })
    },
    zoomTo: (ids, opts) => void zooms.push([ids, opts]),
  }
  let clock = 0
  const timers: { fn: () => void; at: number }[] = []
  const opts = {
    now: () => clock,
    setTimer: (fn: () => void, ms: number) => {
      const t = { fn, at: clock + ms }
      timers.push(t)
      return t
    },
    clearTimer: (h: unknown) => void timers.splice(timers.indexOf(h as (typeof timers)[number]), 1),
  }
  const advance = (ms: number) => {
    const until = clock + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const next = timers[0]
      if (!next || next.at > until) break
      timers.shift()
      clock = next.at
      next.fn()
    }
    clock = until
  }
  return { page, zooms, shapes, opts, advance, timers }
}

describe('focusWhenPresent', () => {
  it('fits a shape that is already there at once', () => {
    const t = setup(['f1'])
    focusWhenPresent(t.page, 'f1', t.opts)
    expect(t.zooms).toEqual([[['f1'], { fit: true }]])
    expect(t.timers).toHaveLength(0)
  })

  it('waits for the shape to arrive with the sync, then fits it once', () => {
    const t = setup()
    focusWhenPresent(t.page, 'f1', { ...t.opts, intervalMs: 250 })
    t.advance(1000)
    expect(t.zooms).toEqual([])
    t.shapes.push('f1')
    t.advance(250)
    t.advance(5000)
    expect(t.zooms).toEqual([[['f1'], { fit: true }]])
  })

  it('gives up quietly on a shape that never comes', () => {
    const t = setup()
    focusWhenPresent(t.page, 'gone', { ...t.opts, timeoutMs: 2000, intervalMs: 250 })
    t.advance(10_000)
    expect(t.zooms).toEqual([])
    expect(t.timers).toHaveLength(0)
  })

  it('stops when the person has moved on, or is cancelled', () => {
    const moved = setup()
    let here = true
    focusWhenPresent(moved.page, 'f1', { ...moved.opts, stillWanted: () => here })
    here = false
    moved.shapes.push('f1')
    moved.advance(5000)
    expect(moved.zooms).toEqual([])
    const cancelled = setup()
    const cancel = focusWhenPresent(cancelled.page, 'f1', cancelled.opts)
    cancel()
    cancelled.shapes.push('f1')
    cancelled.advance(5000)
    expect(cancelled.zooms).toEqual([])
    expect(cancelled.timers).toHaveLength(0)
  })

  it('survives a board that fails to read', () => {
    const page = { read: () => 'not json', zoomTo: vi.fn() }
    expect(boardHas(page, 'f1')).toBe(false)
    const throwing = {
      read: () => {
        throw new Error('not ready')
      },
      zoomTo: vi.fn(),
    }
    expect(boardHas(throwing, 'f1')).toBe(false)
  })

  it('says once that it found and fitted the shape', () => {
    const t = setup()
    const found = vi.fn()
    focusWhenPresent(t.page, 'f1', { ...t.opts, intervalMs: 250, onFound: found })
    t.advance(1000)
    expect(found).not.toHaveBeenCalled()
    t.shapes.push('f1')
    t.advance(5000)
    expect(found).toHaveBeenCalledTimes(1)
    const gone = setup()
    const never = vi.fn()
    focusWhenPresent(gone.page, 'gone', { ...gone.opts, timeoutMs: 2000, onFound: never })
    gone.advance(10_000)
    expect(never).not.toHaveBeenCalled()
  })

  it('finds frames listed apart from shapes', () => {
    expect(boardHas({ read: () => JSON.stringify({ shapes: [], frames: [{ id: 'f1' }] }) }, 'f1')).toBe(true)
  })
})

describe('fitAllWhenPresent', () => {
  it('fits the whole board at once when it already holds something, never past 100%', () => {
    const t = setup(['s1', 's2'])
    fitAllWhenPresent(t.page, t.opts)
    expect(t.zooms).toEqual([[[], { fit: true, all: true, maxZoom: 1 }]])
    expect(FIT_ALL.maxZoom).toBe(1)
    expect(t.timers).toHaveLength(0)
  })

  it('waits for something to arrive, then fits once', () => {
    const t = setup()
    const found = vi.fn()
    fitAllWhenPresent(t.page, { ...t.opts, intervalMs: 250, onFound: found })
    t.advance(1000)
    expect(t.zooms).toEqual([])
    t.shapes.push('s1')
    t.advance(5000)
    expect(t.zooms).toEqual([[[], FIT_ALL]])
    expect(found).toHaveBeenCalledTimes(1)
  })

  it('leaves an empty board alone, and says when it gave up', () => {
    const t = setup(['arrow1'])
    const gaveUp = vi.fn()
    fitAllWhenPresent(t.page, { ...t.opts, timeoutMs: 2000, onGiveUp: gaveUp })
    t.advance(10_000)
    expect(t.zooms).toEqual([])
    expect(gaveUp).toHaveBeenCalledTimes(1)
    expect(t.timers).toHaveLength(0)
  })

  it('reads content from an overview, arrows aside', () => {
    expect(boardHasContent({ read: () => JSON.stringify({ overview: true, total: 1, counts: { frame: 1 } }) })).toBe(true)
    expect(boardHasContent({ read: () => JSON.stringify({ overview: true, total: 2, counts: { arrow: 2 } }) })).toBe(false)
    expect(boardHasContent({ read: () => JSON.stringify({ overview: true, total: 0, counts: {} }) })).toBe(false)
    expect(boardHasContent({ read: () => 'nope' })).toBe(false)
  })
})

describe('watchTouch', () => {
  it('hears a pan, zoom, click or key on the board, until stopped', () => {
    const board = new EventTarget()
    const touched = vi.fn()
    const stop = watchTouch(board, touched)
    for (const type of TOUCH_EVENTS) board.dispatchEvent(new Event(type))
    expect(touched).toHaveBeenCalledTimes(TOUCH_EVENTS.length)
    board.dispatchEvent(new Event('pointermove'))
    stop()
    board.dispatchEvent(new Event('wheel'))
    expect(touched).toHaveBeenCalledTimes(TOUCH_EVENTS.length)
    expect(() => watchTouch(null, touched)()).not.toThrow()
  })
})

describe('OpenFocus', () => {
  /** An open of a canvas: the page, its timers, a board the person may touch. */
  function open(shapes: string[], o: { shape?: string | null; waitForSync: boolean }) {
    const t = setup(shapes)
    let isOpen = true
    const board = new EventTarget()
    const focus = new OpenFocus(t.page, {
      shape: o.shape ?? null,
      waitForSync: o.waitForSync,
      stillOpen: () => isOpen,
      watchTouch: touched => watchTouch(board, touched),
      look: { ...t.opts, intervalMs: 250, timeoutMs: 20_000 },
    })
    return { ...t, focus, board, leave: () => void (isOpen = false) }
  }

  it('fits a cached board with something on it at once, and only once', () => {
    const t = open(['s1'], { waitForSync: true })
    expect(t.zooms).toEqual([[[], FIT_ALL]])
    expect(t.focus.waiting).toBe(false)
    // The room's sync (and a later reconnect's) does not fit it again.
    t.shapes.push('s2')
    t.focus.synced()
    t.focus.synced()
    t.advance(30_000)
    expect(t.zooms).toHaveLength(1)
    expect(t.timers).toHaveLength(0)
  })

  it('fits a board that is only on the server once the room has synced', () => {
    const t = open([], { waitForSync: true })
    t.advance(2000)
    expect(t.zooms).toEqual([])
    t.shapes.push('page')
    t.advance(1000)
    // Not before the sync: a half-arrived board is not fitted.
    expect(t.zooms).toEqual([])
    t.focus.synced()
    expect(t.zooms).toEqual([[[], FIT_ALL]])
    t.focus.synced()
    t.advance(30_000)
    expect(t.zooms).toHaveLength(1)
  })

  it('looks anyway after 8 s when the room stays quiet', () => {
    const t = open([], { waitForSync: true })
    t.shapes.push('s1')
    t.advance(7999)
    expect(t.zooms).toEqual([])
    t.advance(1)
    expect(t.zooms).toEqual([[[], FIT_ALL]])
  })

  it('fits a local board at once, without a room to wait for', () => {
    const t = open(['s1'], { waitForSync: false })
    expect(t.zooms).toEqual([[[], FIT_ALL]])
  })

  it('leaves the view to someone who moved the board before the content came', () => {
    for (const type of TOUCH_EVENTS) {
      const t = open([], { waitForSync: true })
      t.advance(1000)
      t.board.dispatchEvent(new Event(type))
      expect(t.focus.waiting).toBe(false)
      t.shapes.push('s1')
      t.focus.synced()
      t.advance(30_000)
      expect(t.zooms).toEqual([])
      expect(t.timers).toHaveLength(0)
    }
  })

  it('stops listening for touches once it has fitted, or given up', () => {
    for (const shapes of [['s1'], []]) {
      const t = setup(shapes)
      const stop = vi.fn()
      new OpenFocus(t.page, { shape: null, waitForSync: false, stillOpen: () => true, watchTouch: () => stop, look: { ...t.opts, timeoutMs: 1000 } })
      t.advance(2000)
      expect(stop).toHaveBeenCalledTimes(1)
    }
    // A deep link does not listen at all.
    const t = setup(['f1'])
    const watch = vi.fn(() => () => {})
    new OpenFocus(t.page, { shape: 'f1', waitForSync: false, stillOpen: () => true, watchTouch: watch, look: t.opts })
    expect(watch).not.toHaveBeenCalled()
  })

  it('a deep link fits its shape, never the whole board, and a touch does not cancel it', () => {
    const t = open(['s1', 'f1'], { shape: 'f1', waitForSync: true })
    // A cached copy may hold the shape somewhere else: wait for the sync.
    expect(t.zooms).toEqual([])
    t.board.dispatchEvent(new Event('pointerdown'))
    t.focus.synced()
    expect(t.zooms).toEqual([[['f1'], { fit: true }]])
    t.focus.synced()
    expect(t.zooms).toHaveLength(1)
  })

  it('a deep link to a shape not there yet looks again at the next sync', () => {
    const t = open([], { shape: 'f1', waitForSync: true })
    t.focus.synced()
    t.advance(30_000)
    expect(t.focus.waiting).toBe(true)
    t.shapes.push('f1')
    t.focus.synced()
    expect(t.zooms).toEqual([[['f1'], { fit: true }]])
  })

  it('keeps the default view of an empty canvas, and does not fly to it once filled much later', () => {
    const t = open([], { waitForSync: true })
    t.focus.synced()
    t.advance(20_000)
    expect(t.zooms).toEqual([])
    expect(t.focus.waiting).toBe(false)
    t.shapes.push('s1')
    t.focus.synced()
    t.advance(30_000)
    expect(t.zooms).toEqual([])
  })

  it('stops quietly when the person leaves the canvas, or the open is cancelled', () => {
    const left = open([], { waitForSync: true })
    left.leave()
    left.shapes.push('s1')
    left.focus.synced()
    left.advance(30_000)
    expect(left.zooms).toEqual([])
    const cancelled = open([], { waitForSync: true })
    cancelled.focus.cancel()
    cancelled.shapes.push('s1')
    cancelled.focus.synced()
    cancelled.advance(30_000)
    expect(cancelled.zooms).toEqual([])
    expect(cancelled.timers).toHaveLength(0)
  })
})
