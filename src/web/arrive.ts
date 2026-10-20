/**
 * Arriving at a canvas by link — `#/c/<id>` or a share link `#/join/<token>` — signed in or
 * not. Each decides what the host does next: open a canvas (its local copy, made on the spot
 * for one that so far lives only on the server), ask the person to sign in first, or say why
 * it can't open. Joining is idempotent on the server, so it is safe to repeat after a sign-in.
 */
import type { CloudCanvas, CloudSession } from './cloud'
import type { CanvasRecord } from './store'

export type ArrivalError = 'no_access' | 'link_gone' | 'failed'

export type Arrival =
  | { do: 'open'; record: CanvasRecord }
  /** Sign in first (then come back to the same route). */
  | { do: 'signin' }
  /** Not in this browser, and no server to ask: the old "not in this browser". */
  | { do: 'missing' }
  | { do: 'error'; code: ArrivalError; message: string }

export interface ArrivalDeps {
  session: CloudSession | null
  /** The server that serves this page (where a sign-in would go), if any. */
  homeServer: string | null
  local(id: string): Promise<CanvasRecord | undefined>
  /** `GET /canvases/{id}` as the session; throws `CloudError` (404 when not a member). */
  fetch(id: string): Promise<CloudCanvas>
  /** `POST /canvas-links/{token}/join`; throws `CloudError` (404 `link_not_found`). */
  join(token: string): Promise<CloudCanvas>
  /** Keep a server canvas's local record (created on first open). */
  keep(c: CloudCanvas): Promise<CanvasRecord>
}

const status = (error: unknown) => (error as { status?: number } | null)?.status ?? 0
const text = (error: unknown) => (error instanceof Error ? error.message : String(error))

export async function arriveAtCanvas(id: string, deps: ArrivalDeps): Promise<Arrival> {
  const record = await deps.local(id)
  if (record) {
    // A server canvas followed signed out, on that server's own page: sign in to open it live.
    if (record.cloud && !deps.session && deps.homeServer && record.cloud.server === deps.homeServer) return { do: 'signin' }
    return { do: 'open', record }
  }
  if (!deps.session) return deps.homeServer ? { do: 'signin' } : { do: 'missing' }
  try {
    return { do: 'open', record: await deps.keep(await deps.fetch(id)) }
  } catch (error) {
    if (status(error) === 401) return { do: 'signin' }
    if (status(error) === 404) return { do: 'error', code: 'no_access', message: text(error) }
    return { do: 'error', code: 'failed', message: text(error) }
  }
}

export async function arriveAtJoin(token: string, deps: Pick<ArrivalDeps, 'session' | 'join' | 'keep'>): Promise<Arrival> {
  if (!deps.session) return { do: 'signin' }
  try {
    return { do: 'open', record: await deps.keep(await deps.join(token)) }
  } catch (error) {
    if (status(error) === 401) return { do: 'signin' }
    if (status(error) === 404) return { do: 'error', code: 'link_gone', message: text(error) }
    return { do: 'error', code: 'failed', message: text(error) }
  }
}
