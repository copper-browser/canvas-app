/**
 * Whose deployment this is. Canvas App is one build for any server; a deployment may carry its
 * owner's mark on the host's own screens (sign-in, landing cards, the list) — never on the
 * board. Exowatt's servers (`*.exowatt.com`) get Exowatt's; everyone else gets none.
 * `localStorage['canvas-app:brand'] = 'exowatt' | 'none'` overrides it (local testing).
 */
import iconColor from './brand/exowatt-icon-color.png'
import lockupColor from './brand/exowatt-lockup-color.png'
import lockupWhite from './brand/exowatt-lockup-white.png'

export interface Brand {
  id: 'exowatt'
  name: string
  /** The email domain its accounts use (sign-in hints, error messages). */
  domain: string
  /** Wordmark lockups for light and dark surfaces, and the mark alone. */
  lockupLight: string
  lockupDark: string
  icon: string
}

export const EXOWATT: Brand = {
  id: 'exowatt',
  name: 'Exowatt',
  domain: 'exowatt.com',
  lockupLight: lockupColor,
  lockupDark: lockupWhite,
  icon: iconColor,
}

const OVERRIDE_KEY = 'canvas-app:brand'

export function brandFor(hostname: string, override: string | null): Brand | null {
  if (override === 'exowatt') return EXOWATT
  if (override === 'none') return null
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host === 'exowatt.com' || host.endsWith('.exowatt.com') ? EXOWATT : null
}

export function deploymentBrand(): Brand | null {
  let override: string | null = null
  try {
    override = localStorage.getItem(OVERRIDE_KEY)
  } catch {
    // No storage: the hostname decides.
  }
  return brandFor(typeof location === 'undefined' ? '' : location.hostname, override)
}
