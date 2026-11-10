import { beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { CanvasStore } from '../canvas/doc'
import { applyOps, readBoard, readCanvas, type OpsContext, type ReadContext } from '../ops'

let store: CanvasStore
let ctx: OpsContext
const run = (ops: unknown) => applyOps(ctx, { ops })
const reading = (): ReadContext => ({ store, canvas: { id: 'c1', name: 'Board', kind: 'shared' }, selection: [], viewport: null })

beforeEach(() => {
  store = new CanvasStore(new Y.Doc())
  ctx = { store, viewportCenter: () => ({ x: 0, y: 0 }) }
})

describe('assistant', () => {
  it('adds, replaces (keeping addedAt) and removes; ids[i] is the assistant id', () => {
    const r = run([{ op: 'assistant', id: 'bot:1', name: 'Helper', chat: 'https://example.com/chat/1', avatar: 'https://example.com/a.png', about: 'Ask me about this board' }])
    expect(r).toMatchObject({ applied: 1, ids: ['bot:1'], errors: [], anchor: null })
    const first = store.assistants.get('bot:1') as { addedAt: number }
    expect(first).toMatchObject({ name: 'Helper', chat: 'https://example.com/chat/1', avatar: 'https://example.com/a.png', about: 'Ask me about this board' })
    expect(first.addedAt).toBeGreaterThan(0)

    expect(run([{ op: 'assistant', id: 'bot:1', name: 'Helper 2', chat: 'https://example.com/chat/2' }]).applied).toBe(1)
    expect(store.assistants.get('bot:1')).toEqual({ name: 'Helper 2', chat: 'https://example.com/chat/2', addedAt: first.addedAt })

    // Removing is idempotent.
    expect(run([{ op: 'assistant', id: 'bot:1', remove: true }, { op: 'assistant', id: 'bot:1', remove: true }])).toMatchObject({ applied: 2, ids: ['bot:1', 'bot:1'], errors: [] })
    expect(store.assistants.size).toBe(0)
  })

  it('reports a bad op and applies the rest', () => {
    const ok = { op: 'assistant', id: 'a', name: 'Helper', chat: 'https://example.com/' }
    const r = run([
      { ...ok, id: 'has space' },
      { ...ok, id: undefined },
      { ...ok, name: '' },
      { ...ok, chat: 'javascript:alert(1)' },
      { ...ok, chat: `https://example.com/${'a'.repeat(2048)}` },
      { ...ok, avatar: 'ftp://example.com/a.png' },
      { ...ok, about: 'x'.repeat(141) },
      { op: 'assistant', remove: true },
      { ...ok, remove: 'yes' },
      { ...ok, chat: 'example.com/chat' },
      ok,
    ])
    expect(r.applied).toBe(1)
    expect(r.ids).toEqual([null, null, null, null, null, null, null, null, null, null, 'a'])
    expect(r.errors.map(e => [e.index, e.op])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => [i, 'assistant']))
    expect(r.errors.map(e => e.error.match(/`(\w+)`/)?.[1])).toEqual(['id', 'id', 'name', 'chat', 'chat', 'avatar', 'about', 'id', 'remove', 'chat'])
    expect(store.assistants.size).toBe(1)
  })

  it('refuses a ninth assistant', () => {
    const ops = Array.from({ length: 9 }, (_, i) => ({ op: 'assistant', id: `bot:${i}`, name: `Helper ${i}`, chat: 'https://example.com/' }))
    const r = run(ops)
    expect(r.applied).toBe(8)
    expect(r.errors).toEqual([{ index: 8, op: 'assistant', error: 'at most 8 assistants per canvas' }])
    expect(run([{ ...ops[2], name: 'Renamed' }]).errors).toEqual([])
  })

  it('is refused on a read-only canvas, kept by clear and never undone', () => {
    run([{ op: 'assistant', id: 'a', name: 'Helper', chat: 'https://example.com/' }, { op: 'add', shape: { type: 'sticky' } }])
    run([{ op: 'clear' }])
    store.undo.undo()
    store.undo.undo()
    expect(store.assistants.size).toBe(1)
    ctx.readOnly = true
    expect(run([{ op: 'assistant', id: 'a', remove: true }]).errors[0]!.error).toMatch(/read-only/)
    expect(store.assistants.size).toBe(1)
  })
})

describe('read', () => {
  it('lists assistants in reader order without addedAt; [] when none', () => {
    expect(readCanvas(reading()).assistants).toEqual([])
    store.assistants.set('b', { name: 'Second', chat: 'https://example.com/b', addedAt: 2 })
    store.assistants.set('a', { name: 'First', chat: 'https://example.com/a', avatar: 'https://example.com/a.png', about: 'Ask away', addedAt: 1 })
    store.assistants.set('bad', { name: 'Bad', chat: 'javascript:alert(1)', addedAt: 0 })
    const expected = [
      { id: 'a', name: 'First', chat: 'https://example.com/a', avatar: 'https://example.com/a.png', about: 'Ask away' },
      { id: 'b', name: 'Second', chat: 'https://example.com/b' },
    ]
    expect(readCanvas(reading()).assistants).toEqual(expected)
    expect(readBoard(reading(), { overview: true }).assistants).toEqual(expected)
  })
})
