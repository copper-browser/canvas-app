import { describe, expect, it, vi } from 'vitest'
import { boardHas, focusWhenPresent, type FocusPage } from '../focus'

/** A page whose board gains shapes over time; timers run by hand. */
function setup(shapes: string[] = []) {
  const zooms: unknown[] = []
  const page: FocusPage = {
    read: (opts?: unknown) => {
      const ids = (JSON.parse(String(opts)) as { ids: string[] }).ids
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

  it('finds frames listed apart from shapes', () => {
    expect(boardHas({ read: () => JSON.stringify({ shapes: [], frames: [{ id: 'f1' }] }) }, 'f1')).toBe(true)
  })
})
