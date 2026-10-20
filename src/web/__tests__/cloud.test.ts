import { describe, expect, it } from 'vitest'
import { fromBase64, toBase64 } from '../../canvas/base64'
import { CloudClient, CloudError, homeServerInfo, parseServer, roomUrl, servedByServer, shareUrl } from '../cloud'
import { CLOSE_REVOKED, RoomRelay } from '../room'

describe('parseServer', () => {
  it('takes an address, with or without a scheme', () => {
    expect(parseServer(' canvas.example.com ')).toEqual({ server: 'https://canvas.example.com' })
    expect(parseServer('https://canvas.example.com:8443/some/path')).toEqual({ server: 'https://canvas.example.com:8443' })
    expect(parseServer('http://localhost:8787')).toEqual({ server: 'http://localhost:8787' })
  })

  it('takes a Copper Cloud link code, key and all', () => {
    expect(parseServer('copper-cloud://cloud.example.com:8443/#k=ck_abc&fp=AA:BB')).toEqual({ server: 'https://cloud.example.com:8443', key: 'ck_abc' })
    expect(parseServer('http://localhost:8443/#k=dev')).toEqual({ server: 'http://localhost:8443', key: 'dev' })
    expect(() => parseServer('copper-cloud://h/#fp=AA')).toThrow(/no key/)
    expect(() => parseServer('')).toThrow()
  })
})

describe('urls', () => {
  it('puts the session (and a gate key) on the room socket, since a browser cannot send headers there', () => {
    expect(roomUrl({ server: 'https://c.example', token: 't+2' }, 'abc')).toBe('wss://c.example/v1/canvases/abc/ws?token=t%2B2')
    expect(roomUrl({ server: 'http://localhost:8443', key: 'k/1', token: 't' }, 'x')).toBe('ws://localhost:8443/v1/canvases/x/ws?token=t&instance=k%2F1')
    expect(shareUrl('https://c.example', 'tok')).toBe('https://c.example/join/tok')
  })

  it('knows when a canvas server serves the app', async () => {
    const json = (async () => new Response('{"name":"canvas-cloud"}', { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    const html = (async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch
    expect(await servedByServer('https://c.example', json)).toBe('https://c.example')
    expect(await servedByServer('http://localhost:8080', html)).toBeNull()
    expect(await servedByServer('file://', json)).toBeNull()
  })

  it('lists the sign-in providers of the server that serves the app', async () => {
    const info = { name: 'canvas-cloud', auth: { oidc: [{ id: 'google', name: 'Google', start: '/v1/auth/oidc/google/start' }], password: true } }
    const json = (async () => new Response(JSON.stringify(info), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    expect(await homeServerInfo('https://canvas.dev.exowatt.com', json)).toEqual({
      server: 'https://canvas.dev.exowatt.com',
      providers: [{ id: 'google', name: 'Google', start: '/v1/auth/oidc/google/start' }],
    })
    const hangs = ((_url: string, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch
    expect(await homeServerInfo('https://slow.example', hangs, 10)).toBeNull()
  })
})

describe('CloudClient', () => {
  const fake = (status: number, body: unknown, seen: { url?: string; init?: RequestInit }[] = []) =>
    (async (url: string, init?: RequestInit) => {
      seen.push({ url, init })
      return new Response(JSON.stringify(body), { status })
    }) as unknown as typeof fetch

  it('sends the gate credential, then the session, on every call', async () => {
    const seen: { url?: string; init?: RequestInit }[] = []
    const c = new CloudClient('https://c.example', undefined, null, fake(200, { token: 'T', user: { id: 'u', email: 'a@b.c', display_name: 'A' } }, seen))
    const s = await c.signIn('a@b.c', 'pw', { device: { id: 'd', name: 'Canvas App' } })
    expect(s).toEqual({ server: 'https://c.example', token: 'T', user: { id: 'u', email: 'a@b.c', display_name: 'A' } })
    await c.canvases()
    expect(seen[0]!.url).toBe('https://c.example/v1/auth/login')
    expect(seen[0]!.init!.headers).not.toHaveProperty('x-copper-instance')
    expect((seen[1]!.init!.headers as Record<string, string>).authorization).toBe('Bearer T')
  })

  it('sends a Copper Cloud link code’s key as the gate header', async () => {
    const seen: { url?: string; init?: RequestInit }[] = []
    const c = new CloudClient('https://c.example', 'ck_1', 'T', fake(200, [], seen))
    await c.canvases()
    expect((seen[0]!.init!.headers as Record<string, string>)['x-copper-instance']).toBe('ck_1')
  })

  it('says canvas-cloud’s sign-in and sign-up refusals in words', async () => {
    const cases: [number, string, RegExp][] = [
      [401, 'invalid_credentials', /Wrong email or password/],
      [401, 'account_disabled', /turned off/],
      [403, 'signup_closed', /not taking new accounts/],
      [403, 'signup_domain_not_allowed', /email domains/],
      [409, 'email_taken', /already has an account/],
      [403, 'password_not_set', /another way/],
    ]
    for (const [status, error, text] of cases) {
      const c = new CloudClient('https://c.example', undefined, null, fake(status, { error, message: 'raw' }))
      await expect(c.signIn('a@b.c', 'pw', { signup: true, device: { id: 'd', name: 'n' } })).rejects.toMatchObject({ status, code: error, message: expect.stringMatching(text) })
    }
  })

  it('asks who a single sign-on token is, and handles invites', async () => {
    const seen: { url?: string; init?: RequestInit }[] = []
    const user = { id: 'u', email: 'ada@exowatt.com', display_name: 'Ada' }
    const me = new CloudClient('https://c.example', undefined, 'cvs_T', fake(200, { user, via: 'session' }, seen))
    expect(await me.me()).toEqual(user)
    expect(seen[0]!.url).toBe('https://c.example/v1/auth/me')
    expect((seen[0]!.init!.headers as Record<string, string>).authorization).toBe('Bearer cvs_T')
    await expect(new CloudClient('https://c.example', undefined, 'T', fake(200, {})).me()).rejects.toBeInstanceOf(CloudError)

    const invite = { id: 'i1', canvas_id: 'c1', canvas_name: 'Roadmap', email: 'ada@exowatt.com', status: 'pending', invited_by: null, created_at: '' }
    expect(await new CloudClient('https://c.example', undefined, 'T', fake(200, [invite, { ...invite, id: 'i2', status: 'revoked' }])).invites()).toEqual([invite])
    expect(await new CloudClient('https://c.example', undefined, 'T', fake(200, { invites: [invite] })).invites()).toEqual([invite])
    const calls: { url?: string; init?: RequestInit }[] = []
    const c = new CloudClient('https://c.example', undefined, 'T', fake(200, { ok: true }, calls))
    await c.acceptInvite('i/1')
    await c.declineInvite('i1')
    await c.canvas('c1')
    expect(calls.map(x => `${x.init!.method} ${x.url}`)).toEqual([
      'POST https://c.example/v1/invites/i%2F1/accept',
      'POST https://c.example/v1/invites/i1/decline',
      'GET https://c.example/v1/canvases/c1',
    ])
  })

  it('turns server errors into sentences', async () => {
    const c = new CloudClient('https://c.example', 'k', null, fake(401, { error: 'credentials' }))
    await expect(c.signIn('a', 'b', { device: { id: 'd', name: 'n' } })).rejects.toMatchObject({ status: 401, code: 'credentials', message: 'Wrong email or password.' })
    const down = new CloudClient('https://c.example', 'k', null, (async () => {
      throw new TypeError('failed')
    }) as unknown as typeof fetch)
    await expect(down.canvases()).rejects.toBeInstanceOf(CloudError)
  })
})

class FakeSocket {
  static last: FakeSocket
  binaryType = ''
  readyState = 0
  sent: Uint8Array[] = []
  closed = false
  onopen: ((e: Event) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  constructor(readonly url: string) {
    FakeSocket.last = this
  }
  send(data: Uint8Array) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
  }
}

describe('RoomRelay', () => {
  const setup = () => {
    const states: string[] = []
    const frames: string[] = []
    const ended: number[] = []
    const relay = new RoomRelay(
      () => 'wss://c/room',
      () => ({ wsState: s => states.push(s), wsMessage: b => frames.push(b) }),
      code => ended.push(code),
      url => new FakeSocket(url) as never
    )
    return { relay, states, frames, ended }
  }

  it('relays frames both ways once open', () => {
    const { relay, states, frames } = setup()
    relay.connect()
    const s = FakeSocket.last
    expect(s.binaryType).toBe('arraybuffer')
    relay.send(toBase64(new Uint8Array([1])))
    expect(s.sent).toHaveLength(0)
    s.readyState = 1
    s.onopen!(new Event('open'))
    relay.send(toBase64(new Uint8Array([1, 2])))
    expect([...s.sent[0]!]).toEqual([1, 2])
    s.onmessage!({ data: new Uint8Array([7, 8]).buffer } as MessageEvent)
    expect([...fromBase64(frames[0]!)]).toEqual([7, 8])
    expect(states).toEqual(['open'])
  })

  it('says once per connection when the server’s sync step 2 arrives', () => {
    const { relay } = setup()
    let synced = 0
    relay.onSynced = () => synced++
    relay.connect()
    const s = FakeSocket.last
    s.onmessage!({ data: new Uint8Array([0, 0, 5]).buffer } as MessageEvent)
    expect(synced).toBe(0)
    s.onmessage!({ data: new Uint8Array([0, 1, 5]).buffer } as MessageEvent)
    s.onmessage!({ data: new Uint8Array([0, 1, 6]).buffer } as MessageEvent)
    expect(synced).toBe(1)
  })

  it('a new ask drops the old socket silently', () => {
    const { relay, states } = setup()
    relay.connect()
    const first = FakeSocket.last
    relay.connect()
    expect(first.closed).toBe(true)
    expect(first.onclose).toBeNull()
    expect(states).toEqual([])
  })

  it('stops asking after the room revokes us', () => {
    const { relay, states, ended } = setup()
    relay.connect()
    FakeSocket.last.onclose!({ code: CLOSE_REVOKED } as CloseEvent)
    expect(ended).toEqual([CLOSE_REVOKED])
    const before = FakeSocket.last
    relay.connect()
    expect(FakeSocket.last).toBe(before)
    expect(states).toEqual(['closed', 'closed'])
  })
})
