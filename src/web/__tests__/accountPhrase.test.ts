import { describe, expect, it } from 'vitest'
import { accountPhrase } from '../SignIn'
import { EXOWATT } from '../brand'
import type { OidcProvider } from '../auth'

const p = (name: string) => ({ id: name.toLowerCase(), name }) as OidcProvider

describe('accountPhrase', () => {
  it('prefixes the brand to a generic provider', () => {
    expect(accountPhrase(EXOWATT, [p('Google')])).toBe('your Exowatt Google account')
  })
  it('does not repeat a brand the provider is already named after', () => {
    expect(accountPhrase(EXOWATT, [p('Exowatt SSO')])).toBe('your Exowatt SSO account')
    expect(accountPhrase(EXOWATT, [p('exowatt sso')])).toBe('your exowatt sso account')
  })
  it('keeps a provider whose name merely starts with the brand letters', () => {
    expect(accountPhrase(EXOWATT, [p('Exowattless')])).toBe('your Exowatt Exowattless account')
  })
  it('falls back without a single provider or a brand', () => {
    expect(accountPhrase(EXOWATT, [])).toBe('your Exowatt account')
    expect(accountPhrase(null, [p('Google')])).toBe('your Google account')
    expect(accountPhrase(null, [])).toBe('your account')
  })
})
