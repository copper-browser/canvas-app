/**
 * A canvas server from a browser: the REST calls Canvas App needs and the room's socket URL.
 *
 * The server is a canvas-cloud (copper-browser/canvas-cloud), or anything that speaks its
 * `/v1/canvases…` API: sign in with `POST /v1/auth/login|signup`, then send the token as
 * `Authorization: Bearer` (REST) and `?token=` (the room socket, since a browser cannot set
 * headers on a WebSocket). A Copper Cloud link code (`copper-cloud://HOST:PORT/#k=<key>…`)
 * works too: its key goes as `x-copper-instance`, and as `?instance=` on the socket.
 */
import { parseProviders, type OidcProvider } from './auth'

export interface CloudUser {
  id: string
  email: string
  display_name: string
}

/** A signed-in browser: where, as whom (and a Copper Cloud's gate key, when it has one). */
export interface CloudSession {
  server: string
  key?: string
  token: string
  user: CloudUser
}

export interface CloudCanvas {
  id: string
  name: string
  kind: 'personal' | 'shared'
  role: 'owner' | 'editor'
  member_count: number
  updated_at: string
}

export interface LinkPreview {
  canvas_id: string
  name: string
  owner: { id: string; display_name: string }
  role: string
  member: boolean
}

/** A pending invite to someone else's canvas, addressed to your email (`GET /v1/invites`). */
export interface CloudInvite {
  id: string
  canvas_id: string
  canvas_name: string
  email: string
  status: string
  invited_by: { id: string; email: string; display_name: string } | null
  created_at: string
}

export class CloudError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

/**
 * What someone types as the server: `cloud.example.com`, `https://cloud.example.com:8443/`,
 * or a Copper Cloud link code `copper-cloud://HOST:PORT/#k=KEY&fp=…` → the origin, and the key
 * when there is one. (A link code's fingerprint is for clients that pin; a browser trusts the
 * certificate itself.)
 */
export function parseServer(input: string): { server: string; key?: string } {
  const text = input.trim()
  if (!text) throw new Error('Type the server’s address.')
  const code = /^copper-cloud:\/\/([^/#?\s]+)[^#]*#(.*)$/i.exec(text)
  if (code) {
    const key = new URLSearchParams(code[2]).get('k')
    if (!key) throw new Error('The link code has no key (#k=…).')
    return { server: `https://${code[1]}`, key }
  }
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    throw new Error('That is not a server address.')
  }
  const key = new URLSearchParams(url.hash.slice(1)).get('k') ?? undefined
  return key ? { server: url.origin, key } : { server: url.origin }
}

/** The server that serves this page, and the sign-in providers it offers. */
export interface HomeServer {
  server: string
  providers: OidcProvider[]
}

/**
 * The canvas server that serves this page (canvas-cloud's `web_root`): it answers
 * `GET /v1/info` with JSON, listing its sign-in providers. Null on a plain static server, or
 * offline (given up after `timeoutMs`).
 */
export async function homeServerInfo(origin: string = location.origin, fetcher: typeof fetch = (...a) => fetch(...a), timeoutMs = 5000): Promise<HomeServer | null> {
  if (!/^https?:/.test(origin)) return null
  const abort = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = abort ? setTimeout(() => abort.abort(), timeoutMs) : undefined
  try {
    const res = await fetcher(`${origin}/v1/info`, { headers: { accept: 'application/json' }, signal: abort?.signal })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
    const info = (await res.json()) as { name?: unknown }
    return typeof info?.name === 'string' ? { server: origin, providers: parseProviders(info) } : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** The page's own origin when a canvas server serves it; null on a plain static server, or offline. */
export async function servedByServer(origin: string = location.origin, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<string | null> {
  return (await homeServerInfo(origin, fetcher))?.server ?? null
}

export const roomUrl = (s: Pick<CloudSession, 'server' | 'key' | 'token'>, canvasId: string) =>
  `${s.server.replace(/^http/, 'ws')}/v1/canvases/${encodeURIComponent(canvasId)}/ws?token=${encodeURIComponent(s.token)}` +
  (s.key ? `&instance=${encodeURIComponent(s.key)}` : '')

/** The link Copper Cloud shares: its landing page opens Copper, or Canvas App in a browser. */
export const shareUrl = (server: string, token: string) => `${server}/join/${encodeURIComponent(token)}`

type Fetch = typeof fetch

export class CloudClient {
  constructor(
    readonly server: string,
    readonly key: string | undefined,
    private token: string | null = null,
    private readonly fetcher: Fetch = (...args) => fetch(...args)
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (this.key) headers['x-copper-instance'] = this.key
    if (this.token) headers.authorization = `Bearer ${this.token}`
    if (body !== undefined) headers['content-type'] = 'application/json'
    let res: Response
    try {
      res = await this.fetcher(`${this.server}/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    } catch {
      throw new CloudError(
        0,
        'network',
        `Can't reach ${this.server}. Check the address; a server on another site must allow this page's origin (CORS), and one with its own certificate must be opened once in this browser and accepted.`
      )
    }
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      // Not JSON: reported below by status.
    }
    if (!res.ok) {
      const err = (data ?? {}) as { error?: string; message?: string }
      throw new CloudError(res.status, err.error ?? `http_${res.status}`, explain(res.status, err.error, err.message))
    }
    return data as T
  }

  /** Sign in (or create the account); answers the session to keep. */
  async signIn(email: string, password: string, opts: { signup?: boolean; device: { id: string; name: string }; displayName?: string }): Promise<CloudSession> {
    const body: Record<string, unknown> = { email: email.trim(), password, device: opts.device }
    if (opts.signup && opts.displayName?.trim()) body.display_name = opts.displayName.trim()
    const out = await this.request<{ token: string; user: CloudUser }>('POST', opts.signup ? '/auth/signup' : '/auth/login', body)
    this.token = out.token
    return this.key ? { server: this.server, key: this.key, token: out.token, user: out.user } : { server: this.server, token: out.token, user: out.user }
  }

  signOut() {
    return this.request<{ ok: boolean }>('POST', '/auth/logout', {})
  }

  /** Who the session is (`GET /v1/auth/me`). */
  async me(): Promise<CloudUser> {
    const out = await this.request<{ user: CloudUser }>('GET', '/auth/me')
    if (!out?.user || typeof out.user.id !== 'string') throw new CloudError(500, 'bad_response', 'The server did not say who you are.')
    return out.user
  }

  /** One canvas you are a member of; a `404` when you are not (or it is gone). */
  canvas(id: string) {
    return this.request<CloudCanvas>('GET', `/canvases/${encodeURIComponent(id)}`)
  }

  /** Pending invites addressed to you. */
  async invites(): Promise<CloudInvite[]> {
    const out = await this.request<CloudInvite[] | { invites?: CloudInvite[] }>('GET', '/invites')
    const list = Array.isArray(out) ? out : Array.isArray(out?.invites) ? out.invites : []
    return list.filter(i => i && typeof i.id === 'string' && (i.status ?? 'pending') === 'pending')
  }

  acceptInvite(id: string) {
    return this.request<CloudCanvas>('POST', `/invites/${encodeURIComponent(id)}/accept`, {})
  }

  declineInvite(id: string) {
    return this.request<{ ok: boolean }>('POST', `/invites/${encodeURIComponent(id)}/decline`, {})
  }

  canvases() {
    return this.request<CloudCanvas[]>('GET', '/canvases')
  }

  create(name: string) {
    return this.request<CloudCanvas>('POST', '/canvases', { name })
  }

  createLink(canvasId: string) {
    return this.request<{ token: string; canvas_id: string }>('POST', `/canvases/${encodeURIComponent(canvasId)}/links`, {})
  }

  previewLink(token: string) {
    return this.request<LinkPreview>('GET', `/canvas-links/${encodeURIComponent(token)}`)
  }

  join(token: string) {
    return this.request<CloudCanvas>('POST', `/canvas-links/${encodeURIComponent(token)}/join`, {})
  }
}

function explain(status: number, code: string | undefined, message: string | undefined): string {
  switch (code) {
    case 'instance_key':
      return 'This server wants a link code (Copper Cloud): paste it as the server.'
    // Copper Cloud says `credentials`; canvas-cloud says `invalid_credentials`.
    case 'credentials':
    case 'invalid_credentials':
      return 'Wrong email or password.'
    case 'account_disabled':
      return 'This account is turned off; ask the server’s admin.'
    case 'password_not_set':
      return 'This account signs in another way (not with a password); ask the server’s admin to set one.'
    case 'signup_closed':
      return 'This server is not taking new accounts; ask its admin for one.'
    case 'signup_domain_not_allowed':
      return 'This server only takes new accounts from certain email domains.'
    case 'email_taken':
      return 'That email already has an account; sign in instead.'
    case 'rate_limited':
      return 'Too many tries; wait a minute and try again.'
    case 'access_key_required':
      return 'This server needs a personal link code to create an account; ask its admin for one.'
    case 'forbidden':
      return status === 403 ? 'This server is not taking new accounts.' : message || 'Not allowed.'
    case 'link_not_found':
      return 'That share link no longer works. Ask whoever sent it for a new one.'
    default:
      return message || (status === 409 ? 'That email already has an account; sign in instead.' : `The server answered ${status}.`)
  }
}
