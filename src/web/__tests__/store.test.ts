import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { CanvasDb, type CanvasRecord } from '../store'

let n = 0
const dbs: CanvasDb[] = []
const open = async () => {
  const db = await CanvasDb.open(indexedDB, `test-${++n}`)
  dbs.push(db)
  return db
}
afterEach(() => dbs.splice(0).forEach(db => db.close()))

const record = (id: string, updatedAt = 1): CanvasRecord => ({ id, name: id, kind: 'personal', createdAt: 1, updatedAt })

describe('CanvasDb', () => {
  it('lists canvases newest first', async () => {
    const db = await open()
    await db.put(record('a', 1))
    await db.put(record('b', 3))
    await db.put(record('c', 2))
    expect((await db.list()).map(r => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('keeps each canvas’s log in order and apart from the others', async () => {
    const db = await open()
    await db.put(record('a'))
    await db.put(record('b'))
    expect(await db.append('a', 'u1', 10)).toEqual({ count: 1, chars: 2 })
    await db.append('b', 'x1', 11)
    expect(await db.append('a', 'u2', 12)).toEqual({ count: 2, chars: 4 })
    expect(await db.updates('a')).toEqual(['u1', 'u2'])
    expect(await db.updates('b')).toEqual(['x1'])
    expect((await db.get('a'))?.updatedAt).toBe(12)
  })

  it('compacts a log into one snapshot that later updates follow', async () => {
    const db = await open()
    await db.put(record('a'))
    for (const u of ['u1', 'u2', 'u3']) await db.append('a', u)
    await db.compact('a', 'snap')
    expect((await db.get('a'))?.logChars).toBe(0)
    expect(await db.append('a', 'u4')).toEqual({ count: 2, chars: 2 })
    expect(await db.updates('a')).toEqual(['snap', 'u4'])
  })

  it('patches and removes, log and all', async () => {
    const db = await open()
    await db.put(record('a'))
    await db.append('a', 'u1')
    expect((await db.patch('a', { name: 'Plan' }))?.name).toBe('Plan')
    expect(await db.patch('missing', { name: 'x' })).toBeUndefined()
    await db.remove('a')
    expect(await db.get('a')).toBeUndefined()
    expect(await db.updates('a')).toEqual([])
  })
})
