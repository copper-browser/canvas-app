import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { fromBase64, toBase64 } from '../../canvas/base64'
import { EXPORT_FORMAT, mergeLog, parseCanvasFile, parseRoute, routeHash } from '../host'
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
