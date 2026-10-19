/**
 * What the title pill says about where the board's changes go. Pure: the
 * host's word (`copperCanvas.setStatus`) combined with what the page itself
 * knows (init kind, the relayed socket).
 *
 * The host is believed when it says a board is disconnected (`local`,
 * `shared-offline`); when it says a board is connected (`shared-live`,
 * `personal-synced`) the page only says so once its own socket has synced,
 * so the pill never claims a live board that is not.
 */

/** What the host says, via `copperCanvas.setStatus`. */
export const HOST_MODES = ['local', 'personal-synced', 'shared-live', 'shared-offline'] as const
export type HostMode = (typeof HOST_MODES)[number]

export interface HostStatus {
  mode: HostMode
  /** Local changes the host has not handed to the cloud yet. */
  pending?: number
}

/** The page's own view of its sync socket (`Session.status`). */
export type SyncStatus = 'local' | 'connecting' | 'online' | 'offline'

export type StatusKey = 'local' | 'connecting' | 'live' | 'synced' | 'offline'

export interface StatusView {
  key: StatusKey
  /** Full text, for wide windows. */
  label: string
  /** Short text that still says what is going on, for narrow windows. */
  short: string
  /** Tooltip. */
  hint: string
  tone: 'muted' | 'success' | 'warning'
  pulse: boolean
  pending: number
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isMode = (v: unknown): v is HostMode => typeof v === 'string' && (HOST_MODES as readonly string[]).includes(v)

/**
 * `setStatus`'s argument: `{mode, pending?}`, as a value or JSON. `null` (or
 * `{mode: null}`) clears it, back to what the page derives on its own.
 */
export function parseHostStatus(raw: unknown): HostStatus | null {
  let v = raw
  if (typeof v === 'string') v = v.trim() ? JSON.parse(v) : null
  if (v === null || v === undefined) return null
  if (!isObject(v)) throw new Error(`setStatus: expected {mode: ${HOST_MODES.join(' | ')}, pending?}`)
  if (v.mode === null || v.mode === undefined) return null
  if (!isMode(v.mode)) throw new Error(`setStatus: mode must be one of ${HOST_MODES.join(', ')}`)
  const out: HostStatus = { mode: v.mode }
  if (v.pending !== undefined && v.pending !== null) {
    const n = Number(v.pending)
    if (!Number.isFinite(n) || n < 0) throw new Error('setStatus: pending must be a number ≥ 0')
    if (Math.floor(n) > 0) out.pending = Math.floor(n)
  }
  return out
}

export const sameHostStatus = (a: HostStatus | null, b: HostStatus | null) =>
  a === b || (!!a && !!b && a.mode === b.mode && (a.pending ?? 0) === (b.pending ?? 0))

const pendingText = (n: number) => (n > 0 ? ` · ${n} pending` : '')

/** Where Copper keeps a board's local copy; other hosts say their own (`init.place`, e.g. "in this browser"). */
export const DEFAULT_PLACE = 'on this Mac'

function view(key: StatusKey, pending = 0, readOnly = false, place = DEFAULT_PLACE): StatusView {
  const Place = place.charAt(0).toUpperCase() + place.slice(1)
  // Only Copper has a Settings › Cloud pane to point at.
  const settings = place === DEFAULT_PLACE ? ' (Settings › Cloud)' : ''
  switch (key) {
    case 'local':
      return { key, label: Place, short: Place, hint: `Saved ${place} only`, tone: 'muted', pulse: false, pending: 0 }
    case 'connecting':
      return { key, label: 'Connecting', short: 'Connecting', hint: 'Connecting to Copper Cloud…', tone: 'warning', pulse: true, pending: 0 }
    case 'live':
      return { key, label: 'Live', short: 'Live', hint: 'Live: changes appear for everyone', tone: 'success', pulse: false, pending: 0 }
    case 'synced':
      return { key, label: 'Synced', short: 'Synced', hint: 'Synced with Copper Cloud', tone: 'success', pulse: false, pending: 0 }
    case 'offline':
      if (readOnly)
        return {
          key,
          label: `Offline · copy ${place}`,
          short: 'Offline',
          hint: `Not connected to Copper Cloud: this is the copy saved ${place}, and it updates when it reconnects${settings}.`,
          tone: 'warning',
          pulse: false,
          pending: 0,
        }
      return {
        key,
        label: `Offline · changes saved ${place}${pendingText(pending)}`,
        short: `Offline${pendingText(pending)}`,
        hint:
          (pending > 0 ? `${pending} change${pending === 1 ? '' : 's'} waiting to sync. ` : '') +
          `Not connected to Copper Cloud: your changes are saved ${place} and sync when it reconnects${settings}.`,
        tone: 'warning',
        pulse: false,
        pending,
      }
  }
}

/**
 * The pill for a board. Without a host status this is what the page always
 * showed — local, connecting, live or offline from its socket — except that a
 * shared board opened without its socket says it is offline, not local.
 */
export function statusView({
  kind,
  online,
  sync,
  host,
  readOnly = false,
  place = DEFAULT_PLACE,
}: {
  kind: string
  online: boolean
  sync: SyncStatus
  host: HostStatus | null
  /** A view-only board has no changes of its own to keep. */
  readOnly?: boolean
  /** Where the local copy lives ("on this Mac", "in this browser"). */
  place?: string
}): StatusView {
  const offline = (pending = 0) => view('offline', pending, readOnly, place)
  const local = () => view('local', 0, false, place)
  const own = (): StatusView => {
    if (!online || sync === 'local') return kind === 'shared' ? offline() : local()
    if (sync === 'connecting') return view('connecting')
    if (sync === 'offline') return offline()
    return view('live')
  }
  if (!host) return own()
  switch (host.mode) {
    case 'local':
      return local()
    case 'shared-offline':
      return offline(host.pending ?? 0)
    case 'shared-live':
    case 'personal-synced': {
      // The host means to sync it; until the page's socket has, say how far it got.
      if (online && sync === 'online') return view(host.mode === 'shared-live' ? 'live' : 'synced')
      if (online && sync === 'connecting') return view('connecting')
      return offline(host.pending ?? 0)
    }
  }
}
