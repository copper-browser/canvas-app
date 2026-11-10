import { beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MAX_ASSISTANTS, chatWindowName, httpUrl, readAssistants, removeAssistant, writeAssistant } from '../assistants'

let map: Y.Map<unknown>
beforeEach(() => {
  map = new Y.Doc().getMap<unknown>('assistants')
})

describe('readAssistants', () => {
  it('reads a well-formed entry', () => {
    map.set('bot:1', { name: ' Helper ', chat: 'https://example.com/chat/1', avatar: 'https://example.com/a.png', about: 'Ask me\nanything', addedAt: 5 })
    expect(readAssistants(map)).toEqual([
      { id: 'bot:1', name: 'Helper', chat: 'https://example.com/chat/1', avatar: 'https://example.com/a.png', about: 'Ask me anything', addedAt: 5 },
    ])
  })

  it('skips an entry without a name or without an http(s) chat URL', () => {
    map.set('no-name', { name: '  ', chat: 'https://example.com/' })
    map.set('no-chat', { name: 'Helper' })
    map.set('script', { name: 'Helper', chat: 'javascript:alert(1)' })
    map.set('data', { name: 'Helper', chat: 'data:text/html,hi' })
    map.set('relative', { name: 'Helper', chat: '/chat' })
    map.set('long', { name: 'Helper', chat: `https://example.com/${'a'.repeat(2048)}` })
    map.set('number', 42)
    expect(readAssistants(map)).toEqual([])
  })

  it('drops a non-http(s) avatar and caps the name and about', () => {
    map.set('a', { name: 'N'.repeat(80), chat: 'http://example.com/c', avatar: 'javascript:alert(1)', about: 'x'.repeat(200) })
    const [a] = readAssistants(map)
    expect(a).toEqual({ id: 'a', name: 'N'.repeat(60), chat: 'http://example.com/c', about: 'x'.repeat(140), addedAt: 0 })
  })

  it('orders by addedAt, then id', () => {
    map.set('c', { name: 'C', chat: 'https://example.com/c', addedAt: 1 })
    map.set('b', { name: 'B', chat: 'https://example.com/b', addedAt: 2 })
    map.set('a', { name: 'A', chat: 'https://example.com/a', addedAt: 2 })
    expect(readAssistants(map).map(a => a.id)).toEqual(['c', 'a', 'b'])
  })

  it('reads a nested Y.Map too', () => {
    const m = new Y.Map<unknown>()
    map.set('x', m)
    m.set('name', 'Nested')
    m.set('chat', 'https://example.com/n')
    expect(readAssistants(map)[0]?.name).toBe('Nested')
  })
})

describe('writeAssistant', () => {
  it('writes the whole value and a replacement keeps addedAt', () => {
    writeAssistant(map, 'bot:1', { name: 'Helper', chat: 'https://example.com/1', about: 'First' }, 100)
    expect(map.get('bot:1')).toEqual({ name: 'Helper', chat: 'https://example.com/1', about: 'First', addedAt: 100 })
    const next = writeAssistant(map, 'bot:1', { name: 'Helper 2', chat: 'https://example.com/2', avatar: 'https://example.com/a.png' }, 900)
    expect(next).toEqual({ id: 'bot:1', name: 'Helper 2', chat: 'https://example.com/2', avatar: 'https://example.com/a.png', addedAt: 100 })
    expect(map.get('bot:1')).toEqual({ name: 'Helper 2', chat: 'https://example.com/2', avatar: 'https://example.com/a.png', addedAt: 100 })
  })

  it('refuses a ninth assistant but still replaces one of the eight', () => {
    for (let i = 0; i < MAX_ASSISTANTS; i++) writeAssistant(map, `bot:${i}`, { name: `Helper ${i}`, chat: 'https://example.com/' }, i)
    expect(() => writeAssistant(map, 'bot:9', { name: 'Helper 9', chat: 'https://example.com/' })).toThrow(/at most 8/)
    expect(map.size).toBe(8)
    expect(writeAssistant(map, 'bot:3', { name: 'Renamed', chat: 'https://example.com/' }, 99)).toMatchObject({ name: 'Renamed', addedAt: 3 })
  })

  it('names the bad field', () => {
    const ok = { name: 'Helper', chat: 'https://example.com/' }
    expect(() => writeAssistant(map, 'has space', ok)).toThrow(/`id`/)
    expect(() => writeAssistant(map, 'a', { ...ok, name: ' ' })).toThrow(/`name`/)
    expect(() => writeAssistant(map, 'a', { ...ok, name: 'N'.repeat(61) })).toThrow(/`name`/)
    expect(() => writeAssistant(map, 'a', { ...ok, chat: 'javascript:alert(1)' })).toThrow(/`chat`/)
    expect(() => writeAssistant(map, 'a', { ...ok, chat: undefined })).toThrow(/`chat`/)
    expect(() => writeAssistant(map, 'a', { ...ok, avatar: 'data:image/png;base64,AAAA' })).toThrow(/`avatar`/)
    expect(() => writeAssistant(map, 'a', { ...ok, about: 'x'.repeat(141) })).toThrow(/`about`/)
    expect(map.size).toBe(0)
  })
})

describe('removeAssistant', () => {
  it('removes an entry and says whether it was there', () => {
    writeAssistant(map, 'a', { name: 'Helper', chat: 'https://example.com/' })
    expect(removeAssistant(map, 'a')).toBe(true)
    expect(removeAssistant(map, 'a')).toBe(false)
    expect(map.size).toBe(0)
  })
})

describe('helpers', () => {
  it('httpUrl takes only http(s)', () => {
    expect(httpUrl(' https://example.com/a b ')).toBe('https://example.com/a%20b')
    expect(httpUrl('JavaScript:alert(1)')).toBeNull()
    expect(httpUrl('mailto:a@example.com')).toBeNull()
    expect(httpUrl(7)).toBeNull()
  })

  it('names one chat window per assistant, safely', () => {
    expect(chatWindowName('bot:abc.1')).toBe('canvas-assistant-bot_abc_1')
  })
})
