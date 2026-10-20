import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { fromBase64, toBase64 } from '../../canvas/base64'
import { COMPACT_AFTER, COMPACT_AFTER_CHARS, EXPORT_FORMAT, mergeLog, parseCanvasFile, parseRoute, routeHash, sameRoute, shouldCompact } from '../host'
import { ago } from '../Home'

describe('routes', () => {
  it('reads #/c/<id> as a canvas and anything else as home', () => {
    expect(parseRoute('#/c/1cec42c1-ca2f-4ccc-b5ee-4588e47337be')).toEqual({ view: 'canvas', id: '1cec42c1-ca2f-4ccc-b5ee-4588e47337be' })
    expect(parseRoute('')).toEqual({ view: 'home' })
    expect(parseRoute('#/')).toEqual({ view: 'home' })
    expect(parseRoute('#/c/../x')).toEqual({ view: 'home' })
    expect(routeHash({ view: 'canvas', id: 'abc' })).toBe('#/c/abc')
    expect(routeHash({ view: 'home' })).toBe('#/')
  })

  it('reads a deep link’s focus, and writes it back', () => {
    expect(parseRoute('#/c/abc?focus=e1-frame')).toEqual({ view: 'canvas', id: 'abc', focus: 'e1-frame' })
    expect(parseRoute('#/c/abc?focus=a%20b&x=1')).toEqual({ view: 'canvas', id: 'abc', focus: 'a b' })
    expect(parseRoute('#/c/abc?other=1')).toEqual({ view: 'canvas', id: 'abc' })
    expect(parseRoute('#/c/abc?focus=')).toEqual({ view: 'canvas', id: 'abc' })
    expect(parseRoute(`#/c/abc?focus=${'x'.repeat(201)}`)).toEqual({ view: 'canvas', id: 'abc' })
    expect(routeHash({ view: 'canvas', id: 'abc', focus: 'a b' })).toBe('#/c/abc?focus=a%20b')
    expect(parseRoute(routeHash({ view: 'canvas', id: 'abc', focus: 'x/y?z' }))).toEqual({ view: 'canvas', id: 'abc', focus: 'x/y?z' })
    expect(sameRoute({ view: 'canvas', id: 'abc', focus: 'f' }, parseRoute('#/c/abc?focus=f'))).toBe(true)
    expect(sameRoute({ view: 'canvas', id: 'abc', focus: 'f' }, { view: 'canvas', id: 'abc' })).toBe(false)
  })

  it('reads a share link', () => {
    const token = 'AbC_123-x'.repeat(4)
    expect(parseRoute(`#/join/${token}`)).toEqual({ view: 'join', token })
    expect(parseRoute('#/join/short')).toEqual({ view: 'home' })
    expect(routeHash({ view: 'join', token })).toBe(`#/join/${token}`)
  })
})

describe('mergeLog', () => {
  it('rebuilds a doc from its log as one update', () => {
    const doc = new Y.Doc()
    const log: string[] = []
    doc.on('update', (u: Uint8Array) => log.push(toBase64(u)))
    doc.getMap('shapes').set('a', 1)
    doc.getMap('shapes').set('b', 2)
    const copy = new Y.Doc()
    Y.applyUpdate(copy, fromBase64(mergeLog(log)!))
    expect(copy.getMap('shapes').toJSON()).toEqual({ a: 1, b: 2 })
    expect(mergeLog([])).toBeNull()
    expect(mergeLog(['x'])).toBe('x')
  })
})

describe('canvas files', () => {
  const state = () => {
    const doc = new Y.Doc()
    doc.getMap('shapes').set('a', 1)
    return toBase64(Y.encodeStateAsUpdate(doc))
  }

  it('reads what export writes', () => {
    const f = parseCanvasFile(JSON.stringify({ format: EXPORT_FORMAT, version: 1, name: ' Plan ', exportedAt: 'x', state: state() }))
    expect(f.name).toBe('Plan')
  })

  it('refuses what is not a canvas file', () => {
    expect(() => parseCanvasFile('nope')).toThrow(/not JSON/)
    expect(() => parseCanvasFile('{"format":"other","state":""}')).toThrow(/Not a canvas file/)
    expect(() => parseCanvasFile(JSON.stringify({ format: EXPORT_FORMAT, state: toBase64(new Uint8Array([255, 255, 255, 255, 1])) }))).toThrow()
  })
})

describe('ago', () => {
  it('says how long ago, coarsely', () => {
    const now = 10_000_000_000
    expect(ago(now - 5_000, now)).toBe('just now')
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 h ago')
    expect(ago(now - 2 * 86_400_000, now)).toBe('2 d ago')
  })
})

describe('shouldCompact', () => {
  it('compacts past 500 entries or 2 MB of updates, as Copper does, never a lone snapshot', () => {
    expect(shouldCompact({ count: COMPACT_AFTER, chars: 10 })).toBe(false)
    expect(shouldCompact({ count: COMPACT_AFTER + 1, chars: 10 })).toBe(true)
    expect(shouldCompact({ count: 2, chars: COMPACT_AFTER_CHARS + 1 })).toBe(true)
    expect(shouldCompact({ count: 1, chars: COMPACT_AFTER_CHARS * 4 })).toBe(false)
  })
})
