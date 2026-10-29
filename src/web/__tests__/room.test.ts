import { describe, expect, it } from 'vitest'
import { RoomRelay } from '../room'

/** A socket the test drives by hand. */
function fakeSocket() {
  const sent: Uint8Array[] = []
  const socket = {
    binaryType: 'blob',
    readyState: 0,
    onopen: null as ((e: Event) => void) | null,
    onmessage: null as ((e: MessageEvent) => void) | null,
    onclose: null as ((e: CloseEvent) => void) | null,
    onerror: null as ((e: Event) => void) | null,
    send: (b: Uint8Array) => void sent.push(b),
    close: () => {},
  }
  const receive = (bytes: number[]) => socket.onmessage?.({ data: new Uint8Array(bytes).buffer } as MessageEvent)
  return { socket, sent, receive }
}

function setup() {
  const states: string[] = []
  const frames: string[] = []
  const sockets: ReturnType<typeof fakeSocket>[] = []
  const page = { wsState: (s: string) => void states.push(s), wsMessage: (b: string) => void frames.push(b) }
  const room = new RoomRelay(
    () => 'wss://example.test/v1/canvases/c1/ws',
    () => page,
    () => {},
    () => {
      const s = fakeSocket()
      sockets.push(s)
      return s.socket as never
    }
  )
  return { room, states, frames, sockets }
}

describe('RoomRelay', () => {
  it('tells whether the server has greeted this connection, and whether it has synced', () => {
    const t = setup()
    t.room.connect()
    expect(t.room.hasHeard).toBe(false)
    expect(t.room.isSynced).toBe(false)
    // The server greets with sync step 1 ([messageSync=0, step1=0, …]).
    t.sockets[0]!.receive([0, 0, 1, 0])
    expect(t.room.hasHeard).toBe(true)
    expect(t.room.isSynced).toBe(false)
    // Then answers with sync step 2: the board holds what the server has.
    let synced = 0
    t.room.onSynced = () => void synced++
    t.sockets[0]!.receive([0, 1, 1, 0])
    expect(t.room.isSynced).toBe(true)
    expect(synced).toBe(1)
  })

  it('starts each new connection unheard and unsynced, and stamps when it started', () => {
    const t = setup()
    expect(t.room.connectedAt).toBe(0)
    const before = Date.now()
    t.room.connect()
    expect(t.room.connectedAt).toBeGreaterThanOrEqual(before)
    t.sockets[0]!.receive([0, 0, 1, 0])
    t.sockets[0]!.receive([0, 1, 1, 0])
    t.room.connect()
    expect(t.sockets).toHaveLength(2)
    expect(t.room.hasHeard).toBe(false)
    expect(t.room.isSynced).toBe(false)
  })
})
