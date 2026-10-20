import { describe, expect, it, vi } from 'vitest'
import { arriveAtCanvas, arriveAtJoin, type ArrivalDeps } from '../arrive'
import { CloudError, type CloudCanvas, type CloudSession } from '../cloud'
import type { CanvasRecord } from '../store'

const SERVER = 'https://canvas.dev.exowatt.com'
const session: CloudSession = { server: SERVER, token: 'cvs_test', user: { id: 'u1', email: 'ada@exowatt.com', display_name: 'Ada' } }
const remote: CloudCanvas = { id: 'c1', name: 'Gazette', kind: 'shared', role: 'editor', member_count: 2, updated_at: '' }
const record = (over: Partial<CanvasRecord> = {}): CanvasRecord => ({ id: 'c1', name: 'Gazette', kind: 'shared', createdAt: 1, updatedAt: 1, ...over })

function deps(over: Partial<ArrivalDeps> = {}) {
  const kept: CloudCanvas[] = []
  const d: ArrivalDeps = {
    session,
    homeServer: SERVER,
    local: vi.fn(async () => undefined),
    fetch: vi.fn(async () => remote),
    join: vi.fn(async () => remote),
    keep: vi.fn(async (c: CloudCanvas) => {
      kept.push(c)
      return record({ id: c.id, name: c.name, cloud: { server: SERVER, canvasId: c.id } })
    }),
    ...over,
  }
  return { d, kept }
}

describe('arriveAtJoin', () => {
  it('asks a signed-out person to sign in, and joins nothing yet', async () => {
    const { d } = deps({ session: null })
    expect(await arriveAtJoin('tok', d)).toEqual({ do: 'signin' })
    expect(d.join).not.toHaveBeenCalled()
  })

  it('joins and opens the canvas once signed in — again on a repeat, since joining is idempotent', async () => {
    const { d, kept } = deps()
    const first = await arriveAtJoin('tok', d)
    const again = await arriveAtJoin('tok', d)
    expect(first).toMatchObject({ do: 'open', record: { id: 'c1', cloud: { server: SERVER, canvasId: 'c1' } } })
    expect(again).toEqual(first)
    expect(d.join).toHaveBeenCalledTimes(2)
    expect(kept.map(c => c.id)).toEqual(['c1', 'c1'])
  })

  it('says a dead link is dead, and an ended session needs a sign-in', async () => {
    const gone = deps({ join: async () => Promise.reject(new CloudError(404, 'link_not_found', 'That share link no longer works.')) })
    expect(await arriveAtJoin('tok', gone.d)).toEqual({ do: 'error', code: 'link_gone', message: 'That share link no longer works.' })
    const ended = deps({ join: async () => Promise.reject(new CloudError(401, 'unauthorized', 'Sign in.')) })
    expect(await arriveAtJoin('tok', ended.d)).toEqual({ do: 'signin' })
    const down = deps({ join: async () => Promise.reject(new CloudError(0, 'network', 'Can’t reach the canvas server.')) })
    expect(await arriveAtJoin('tok', down.d)).toEqual({ do: 'error', code: 'failed', message: 'Can’t reach the canvas server.' })
  })
})

describe('arriveAtCanvas', () => {
  it('opens a canvas of this browser as before, signed in or not', async () => {
    const local = record({ cloud: undefined })
    const { d } = deps({ session: null, local: async () => local })
    expect(await arriveAtCanvas('c1', d)).toEqual({ do: 'open', record: local })
    expect(d.fetch).not.toHaveBeenCalled()
  })

  it('asks for a sign-in before opening a server canvas on that server’s own page', async () => {
    const { d } = deps({ session: null, local: async () => record({ cloud: { server: SERVER, canvasId: 'c1' } }) })
    expect(await arriveAtCanvas('c1', d)).toEqual({ do: 'signin' })
  })

  it('opens the offline copy of another server’s canvas', async () => {
    const other = record({ cloud: { server: 'https://other.example', canvasId: 'c1' } })
    const { d } = deps({ session: null, local: async () => other })
    expect(await arriveAtCanvas('c1', d)).toEqual({ do: 'open', record: other })
  })

  it('fetches a canvas this browser has never seen, once signed in', async () => {
    const { d, kept } = deps()
    expect(await arriveAtCanvas('c1', d)).toMatchObject({ do: 'open', record: { id: 'c1' } })
    expect(kept).toEqual([remote])
    const out = deps({ session: null })
    expect(await arriveAtCanvas('c1', out.d)).toEqual({ do: 'signin' })
    expect(out.d.fetch).not.toHaveBeenCalled()
  })

  it('without a server to ask, says the canvas is not here', async () => {
    const { d } = deps({ session: null, homeServer: null })
    expect(await arriveAtCanvas('c1', d)).toEqual({ do: 'missing' })
  })

  it('says when the canvas is not shared with you', async () => {
    const { d } = deps({ fetch: async () => Promise.reject(new CloudError(404, 'not_found', 'Not found.')) })
    expect(await arriveAtCanvas('c1', d)).toEqual({ do: 'error', code: 'no_access', message: 'Not found.' })
    const ended = deps({ fetch: async () => Promise.reject(new CloudError(401, 'unauthorized', 'Sign in.')) })
    expect(await arriveAtCanvas('c1', ended.d)).toEqual({ do: 'signin' })
  })
})
