/**
 * Single sign-on through the canvas server that serves this page (canvas-cloud `[[oidc]]`).
 *
 * The server lists its providers in `GET /v1/info` → `auth.oidc`. Signing in leaves the page:
 * we keep where the person was going (sessionStorage, this tab only), send the tab to
 * `{server}{start}?redirect_uri=<this page, no fragment>`, and the server comes back to that
 * address with the result in the fragment — `#token=cvs_…`, or
 * `#error=<code>&error_description=<text>` — which we read, keep like a password sign-in,
 * and wipe from the address bar before restoring the route.
 */

export interface OidcProvider {
  id: string
  name: string
  /** Path on the server, e.g. `/v1/auth/oidc/google/start`. */
  start: string
}

export type AuthResult = { kind: 'token'; token: string } | { kind: 'error'; code: string; description: string }

const RETURN_KEY = 'canvas-app:return'
/** A sign-in that takes longer than this (the server allows 10 minutes) starts over at home. */
export const RETURN_MAX_AGE_MS = 30 * 60_000

/** Providers from `/v1/info` (or `/v1/auth/oidc`'s `{providers}`); anything malformed is dropped. */
export function parseProviders(info: unknown): OidcProvider[] {
  const auth = (info as { auth?: { oidc?: unknown } } | null)?.auth
  const raw = auth?.oidc ?? (info as { providers?: unknown } | null)?.providers
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { providers?: unknown } | null)?.providers) ? (raw as { providers: unknown[] }).providers : []
  const out: OidcProvider[] = []
  for (const p of list) {
    const v = p as Partial<OidcProvider> | null
    if (!v || typeof v.id !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(v.id)) continue
    const start = typeof v.start === 'string' && v.start.startsWith('/') && !v.start.startsWith('//') ? v.start : `/v1/auth/oidc/${v.id}/start`
    out.push({ id: v.id, name: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : v.id, start })
  }
  return out
}

/** Where the server sends the result: this page's address without query or fragment. */
export const redirectTarget = (loc: Pick<Location, 'origin' | 'pathname'>) => `${loc.origin}${loc.pathname || '/'}`

export const oidcStartUrl = (server: string, provider: OidcProvider, redirectUri: string) =>
  `${server}${provider.start}?redirect_uri=${encodeURIComponent(redirectUri)}`

/** The sign-in result in a fragment, or null when the fragment is something else (a route). */
export function parseAuthFragment(hash: string): AuthResult | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  // Routes start with `/`; only the server's answer is a query string with `token` or `error`.
  if (raw.startsWith('/') || (!/^(token|error)=/.test(raw) && !/&(token|error)=/.test(raw))) return null
  const q = new URLSearchParams(raw)
  const token = q.get('token')
  if (token && /^[A-Za-z0-9_.~-]{8,512}$/.test(token)) return { kind: 'token', token }
  const code = q.get('error')
  if (code) return { kind: 'error', code: code.replace(/[^a-z0-9_]/gi, '').slice(0, 64) || 'server_error', description: (q.get('error_description') ?? '').slice(0, 300) }
  return { kind: 'error', code: 'invalid_request', description: '' }
}

/** Where a sign-in started: the route to come back to, and the provider it went to. */
export interface SignInReturn {
  hash: string
  provider?: string
}

/** Keep the route (a `#/…` hash) to come back to after the provider. */
export function stashSignIn(ret: SignInReturn, storage: Pick<Storage, 'setItem'> = sessionStorage, now = Date.now()) {
  try {
    storage.setItem(RETURN_KEY, JSON.stringify({ hash: ret.hash.startsWith('#/') ? ret.hash : '#/', provider: ret.provider, at: now }))
  } catch {
    // No storage: the person lands on the list instead.
  }
}

/** The kept route, once (it is removed); `#/` when there is none, it is stale or malformed. */
export function takeSignIn(storage: Pick<Storage, 'getItem' | 'removeItem'> = sessionStorage, now = Date.now()): SignInReturn {
  let raw: string | null
  try {
    raw = storage.getItem(RETURN_KEY)
    storage.removeItem(RETURN_KEY)
  } catch {
    return { hash: '#/' }
  }
  try {
    const v = JSON.parse(raw ?? 'null') as { hash?: unknown; at?: unknown; provider?: unknown } | null
    if (!v || typeof v.hash !== 'string' || !v.hash.startsWith('#/') || v.hash.length > 600) return { hash: '#/' }
    if (typeof v.at !== 'number' || now - v.at > RETURN_MAX_AGE_MS || v.at - now > 60_000) return { hash: '#/' }
    return typeof v.provider === 'string' && v.provider ? { hash: v.hash, provider: v.provider } : { hash: v.hash }
  } catch {
    return { hash: '#/' }
  }
}

/** What to tell a person whose sign-in came back with an error. `domain` names the accounts this server takes, when known. */
export function signInErrorMessage(code: string, description: string, opts: { provider?: string; domain?: string | null } = {}): string {
  const provider = opts.provider || 'your provider'
  switch (code) {
    case 'domain_not_allowed':
      return opts.domain ? `Use your @${opts.domain} ${provider} account. That one can’t sign in here.` : `That ${provider} account can’t sign in here. Use your work account.`
    case 'state_expired':
      return 'The sign-in took too long and expired. Try again.'
    case 'state_mismatch':
      return 'That sign-in was started in another browser or tab. Try again here.'
    case 'access_denied':
      return `${provider} didn’t sign you in. Try again, or pick another account.`
    case 'provider_unavailable':
    case 'oidc_unavailable':
    case 'token_exchange_failed':
    case 'invalid_id_token':
    case 'nonce_mismatch':
      return `Sign-in with ${provider} isn’t working right now. Try again in a minute; if it keeps failing, tell the server’s admin.`
    case 'email_missing':
    case 'email_not_verified':
      return `${provider} didn’t share a verified email address for that account.`
    case 'signup_closed':
      return 'There’s no account for that email here, and this server isn’t taking new ones. Ask its admin.'
    case 'account_disabled':
      return 'That account is turned off. Ask the server’s admin.'
    case 'session_check_failed':
      return 'Signed in, but the server didn’t confirm who you are. Try again.'
    default:
      return description ? `Couldn’t sign you in: ${description}.` : 'Couldn’t sign you in. Try again.'
  }
}
