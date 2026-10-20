/**
 * The page's sync socket, opened for real. In Copper the host opens it (pinned,
 * authenticated) and relays frames over the bridge; here the host is the tab,
 * so it opens a WebSocket to the Copper Cloud room and relays the same way:
 * `{type:'wsOpen'}` → connect, server frames → `copperCanvas.wsMessage`,
 * `{type:'ws'}` → send, a drop → `copperCanvas.wsState('closed')` (the page's
 * provider reconnects with backoff by asking again).
 */
import { fromBase64, toBase64 } from '../canvas/base64'

/** Close codes after which reconnecting is pointless (`canvas/src/ws.rs`). */
export const CLOSE_REVOKED = 4403
export const CLOSE_DELETED = 4404

export interface RoomPage {
  wsState(state: 'open' | 'closed'): void
  wsMessage(b64: string): void
}

type SocketLike = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  binaryType: string
  onopen: ((e: Event) => void) | null
  onmessage: ((e: MessageEvent) => void) | null
  onclose: ((e: CloseEvent) => void) | null
  onerror: ((e: Event) => void) | null
}

export class RoomRelay {
  private socket: SocketLike | null = null
  /** Set by a 4403/4404 close: the room is gone for us, so later asks fail at once. */
  ended: number | null = null
  /**
   * Called once per connection, right after the page got the server's sync step 2 (y-protocols
   * `[messageSync=0, syncStep2=1, …]`): from then on the board holds what the server has.
   */
  onSynced: (() => void) | null = null
  private synced = false

  constructor(
    private readonly url: () => string,
    private readonly page: () => RoomPage,
    private readonly onEnded: (code: number) => void = () => {},
    private readonly open: (url: string) => SocketLike = url => new WebSocket(url) as unknown as SocketLike
  ) {}

  /** `{type:'wsOpen'}`: drop any socket we hold and connect a new one. */
  connect() {
    this.drop()
    if (this.ended !== null) {
      this.page().wsState('closed')
      return
    }
    let socket: SocketLike
    try {
      socket = this.open(this.url())
    } catch {
      this.page().wsState('closed')
      return
    }
    this.synced = false
    socket.binaryType = 'arraybuffer'
    socket.onopen = () => this.socket === socket && this.page().wsState('open')
    socket.onmessage = e => {
      if (this.socket !== socket || !(e.data instanceof ArrayBuffer)) return
      const bytes = new Uint8Array(e.data)
      this.page().wsMessage(toBase64(bytes))
      if (!this.synced && bytes[0] === 0 && bytes[1] === 1) {
        this.synced = true
        this.onSynced?.()
      }
    }
    socket.onclose = e => {
      if (this.socket !== socket) return
      this.socket = null
      if (e.code === CLOSE_REVOKED || e.code === CLOSE_DELETED) {
        this.ended = e.code
        this.onEnded(e.code)
      }
      this.page().wsState('closed')
    }
    socket.onerror = () => {}
    this.socket = socket
  }

  /** `{type:'ws', b64}`: one frame for the server; dropped unless the socket is open. */
  send(b64: string) {
    if (this.socket?.readyState === 1) this.socket.send(fromBase64(b64))
  }

  /** `{type:'wsClose'}`, or the canvas closing. */
  close() {
    this.drop()
  }

  private drop() {
    const socket = this.socket
    this.socket = null
    if (!socket) return
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
    try {
      socket.close()
    } catch {
      // already closed
    }
  }
}
