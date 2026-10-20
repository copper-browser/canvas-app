import { describe, expect, it } from 'vitest'
import { RETURN_MAX_AGE_MS, oidcStartUrl, parseAuthFragment, parseProviders, redirectTarget, signInErrorMessage, stashSignIn, takeSignIn } from '../auth'
import { brandFor } from '../brand'

/** sessionStorage, in memory. */
function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

describe('parseAuthFragment', () => {
  it('reads the session the server sends back', () => {
    expect(parseAuthFragment('#token=cvs_AbC-123_xyz.9')).toEqual({ kind: 'token', token: 'cvs_AbC-123_xyz.9' })
    expect(parseAuthFragment('token=cvs_abcdefgh')).toEqual({ kind: 'token', token: 'cvs_abcdefgh' })
  })

  it('reads an error and its description', () => {
    expect(parseAuthFragment('#error=domain_not_allowed&error_description=That%20account%27s%20domain%20cannot%20sign%20in%20here')).toEqual({
      kind: 'error',
      code: 'domain_not_allowed',
      description: "That account's domain cannot sign in here",
    })
    expect(parseAuthFragment('#error=state_expired')).toEqual({ kind: 'error', code: 'state_expired', description: '' })
    // Codes are kept to plain characters.
    expect(parseAuthFragment('#error=%3Cscript%3E')).toMatchObject({ kind: 'error', code: 'script' })
  })

  it('leaves routes and anything else alone', () => {
    expect(parseAuthFragment('')).toBeNull()
    expect(parseAuthFragment('#/')).toBeNull()
    expect(parseAuthFragment('#/c/abc?focus=x')).toBeNull()
    expect(parseAuthFragment('#/join/tok')).toBeNull()
    expect(parseAuthFragment('#/c/abc?token=nope')).toBeNull()
    expect(parseAuthFragment('#k=ck_abc')).toBeNull()
  })

  it('treats a malformed token as a failed sign-in, never as a session', () => {
    expect(parseAuthFragment('#token=')).toEqual({ kind: 'error', code: 'invalid_request', description: '' })
    expect(parseAuthFragment('#token=a%20b%20c%20d%20e')).toEqual({ kind: 'error', code: 'invalid_request', description: '' })
  })
})

describe('route stash', () => {
  it('brings back the route a sign-in started from, once', () => {
    const s = memory()
    stashSignIn({ hash: '#/c/abc?focus=f1', provider: 'Google' }, s, 1000)
    expect(takeSignIn(s, 2000)).toEqual({ hash: '#/c/abc?focus=f1', provider: 'Google' })
    expect(takeSignIn(s, 2000)).toEqual({ hash: '#/' })
  })

  it('keeps only routes', () => {
    const s = memory()
    stashSignIn({ hash: 'https://evil.example/' }, s, 0)
    expect(takeSignIn(s, 0)).toEqual({ hash: '#/' })
  })

  it('drops a stale, future or malformed stash', () => {
    const stale = memory()
    stashSignIn({ hash: '#/join/tok' }, stale, 0)
    expect(takeSignIn(stale, RETURN_MAX_AGE_MS + 1)).toEqual({ hash: '#/' })
    expect(stale.map.size).toBe(0)
    const future = memory()
    stashSignIn({ hash: '#/join/tok' }, future, 10 * 60_000)
    expect(takeSignIn(future, 0)).toEqual({ hash: '#/' })
    expect(takeSignIn(memory({ 'canvas-app:return': '{nope' }), 0)).toEqual({ hash: '#/' })
    expect(takeSignIn(memory({ 'canvas-app:return': JSON.stringify({ hash: '#/x', at: 'soon' }) }), 0)).toEqual({ hash: '#/' })
    expect(takeSignIn(memory(), 0)).toEqual({ hash: '#/' })
  })

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {},
    }
    expect(() => stashSignIn({ hash: '#/' }, broken)).not.toThrow()
    expect(takeSignIn(broken)).toEqual({ hash: '#/' })
  })
})

describe('providers and addresses', () => {
  it('reads providers from /v1/info, dropping bad ones', () => {
    const info = {
      auth: {
        oidc: [
          { id: 'google', name: 'Google', start: '/v1/auth/oidc/google/start' },
          { id: 'okta', name: '' },
          { id: 'bad id', name: 'x', start: '/x' },
          { id: 'evil', name: 'Evil', start: '//evil.example/start' },
          null,
        ],
        password: true,
      },
    }
    expect(parseProviders(info)).toEqual([
      { id: 'google', name: 'Google', start: '/v1/auth/oidc/google/start' },
      { id: 'okta', name: 'okta', start: '/v1/auth/oidc/okta/start' },
      { id: 'evil', name: 'Evil', start: '/v1/auth/oidc/evil/start' },
    ])
    expect(parseProviders({ providers: [{ id: 'google', name: 'Google' }] })).toEqual([{ id: 'google', name: 'Google', start: '/v1/auth/oidc/google/start' }])
    expect(parseProviders({ auth: { password: true } })).toEqual([])
    expect(parseProviders(null)).toEqual([])
  })

  it('sends the provider back to this page, without its fragment', () => {
    expect(redirectTarget({ origin: 'https://canvas.dev.exowatt.com', pathname: '/' })).toBe('https://canvas.dev.exowatt.com/')
    expect(redirectTarget({ origin: 'http://127.0.0.1:18470', pathname: '' })).toBe('http://127.0.0.1:18470/')
    expect(oidcStartUrl('https://canvas.dev.exowatt.com', { id: 'google', name: 'Google', start: '/v1/auth/oidc/google/start' }, 'https://canvas.dev.exowatt.com/')).toBe(
      'https://canvas.dev.exowatt.com/v1/auth/oidc/google/start?redirect_uri=https%3A%2F%2Fcanvas.dev.exowatt.com%2F'
    )
  })
})

describe('signInErrorMessage', () => {
  it('names the accounts a domain-restricted server takes', () => {
    expect(signInErrorMessage('domain_not_allowed', '', { provider: 'Google', domain: 'exowatt.com' })).toMatch(/^Use your @exowatt\.com Google account/)
    expect(signInErrorMessage('domain_not_allowed', '', { provider: 'Google' })).toMatch(/work account/)
  })

  it('says what happened for the other failures', () => {
    expect(signInErrorMessage('state_expired', '')).toMatch(/expired/)
    expect(signInErrorMessage('provider_unavailable', '', { provider: 'Google' })).toMatch(/Google isn’t working right now/)
    expect(signInErrorMessage('access_denied', '', { provider: 'Google' })).toMatch(/Google didn’t sign you in/)
    expect(signInErrorMessage('something_new', 'The server said no')).toBe('Couldn’t sign you in: The server said no.')
    expect(signInErrorMessage('something_new', '')).toBe('Couldn’t sign you in. Try again.')
  })
})

describe('brandFor', () => {
  it('marks Exowatt’s own servers only', () => {
    expect(brandFor('canvas.dev.exowatt.com', null)?.domain).toBe('exowatt.com')
    expect(brandFor('exowatt.com.', null)?.id).toBe('exowatt')
    expect(brandFor('notexowatt.com', null)).toBeNull()
    expect(brandFor('exowatt.com.evil.example', null)).toBeNull()
    expect(brandFor('127.0.0.1', null)).toBeNull()
    expect(brandFor('127.0.0.1', 'exowatt')?.id).toBe('exowatt')
    expect(brandFor('canvas.dev.exowatt.com', 'none')).toBeNull()
  })
})
