/**
 * The browser host's storage: what Copper keeps on disk, kept in IndexedDB.
 *
 * - `canvases`: one record per canvas (name, kind, cloud link, timestamps).
 * - `updates`: each canvas's append-only Yjs log, keyed `[canvasId, seq]`.
 *   Replaying a canvas's rows in order rebuilds it; `compact` swaps the log
 *   for one snapshot (`copperCanvas.exportState()`).
 *
 * Every write is its own transaction, so a tab that closes mid-edit loses at
 * most the update it was writing.
 */

export interface CloudLink {
  /** Copper Cloud origin, e.g. `https://cloud.example.com`. */
  server: string
  /** The canvas id on that server. */
  canvasId: string
}

export interface CanvasRecord {
  id: string
  name: string
  kind: 'personal' | 'shared'
  createdAt: number
  updatedAt: number
  /** Set once the canvas syncs with a Copper Cloud server. */
  cloud?: CloudLink
  /** Characters of base64 appended since the last snapshot (decides compaction). */
  logChars?: number
}

export interface AppendResult {
  /** Rows in the canvas's log, the new one included. */
  count: number
  /** Characters of base64 in the log past its snapshot. */
  chars: number
}

const DB_NAME = 'canvas-app'
const DB_VERSION = 1

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('transaction aborted'))
  })

export class CanvasDb {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<CanvasDb> {
    const req = factory.open(name, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('canvases')) db.createObjectStore('canvases', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('updates')) db.createObjectStore('updates', { keyPath: ['canvasId', 'seq'] })
    }
    return new CanvasDb(await request(req))
  }

  close() {
    this.db.close()
  }

  async list(): Promise<CanvasRecord[]> {
    const tx = this.db.transaction('canvases', 'readonly')
    const all = await request(tx.objectStore('canvases').getAll() as IDBRequest<CanvasRecord[]>)
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(id: string): Promise<CanvasRecord | undefined> {
    const tx = this.db.transaction('canvases', 'readonly')
    return (await request(tx.objectStore('canvases').get(id))) as CanvasRecord | undefined
  }

  async put(record: CanvasRecord): Promise<void> {
    const tx = this.db.transaction('canvases', 'readwrite')
    tx.objectStore('canvases').put(record)
    await done(tx)
  }

  /** Patch a record's fields; a missing record is left missing. */
  async patch(id: string, patch: Partial<Omit<CanvasRecord, 'id'>>): Promise<CanvasRecord | undefined> {
    const tx = this.db.transaction('canvases', 'readwrite')
    const store = tx.objectStore('canvases')
    const current = (await request(store.get(id))) as CanvasRecord | undefined
    if (!current) return undefined
    const next = { ...current, ...patch, id }
    store.put(next)
    await done(tx)
    return next
  }

  /** The canvas's log, oldest first. */
  async updates(canvasId: string): Promise<string[]> {
    const tx = this.db.transaction('updates', 'readonly')
    const rows = (await request(tx.objectStore('updates').getAll(range(canvasId)))) as { b64: string }[]
    return rows.map(r => r.b64)
  }

  /** Append one update; touches the record's `updatedAt`. Answers how long the log has grown. */
  async append(canvasId: string, b64: string, now = Date.now()): Promise<AppendResult> {
    const tx = this.db.transaction(['updates', 'canvases'], 'readwrite')
    const updates = tx.objectStore('updates')
    const last = await request(updates.openKeyCursor(range(canvasId), 'prev'))
    const seq = last ? ((last.primaryKey as [string, number])[1] ?? 0) + 1 : 0
    updates.add({ canvasId, seq, b64 })
    // Requests in one transaction run in order, so this count includes the row just added.
    const count = await request(updates.count(range(canvasId)))
    const canvases = tx.objectStore('canvases')
    const record = (await request(canvases.get(canvasId))) as CanvasRecord | undefined
    const chars = (record?.logChars ?? 0) + b64.length
    if (record) canvases.put({ ...record, updatedAt: now, logChars: chars })
    await done(tx)
    return { count, chars }
  }

  /** Replace the log with one snapshot. */
  async compact(canvasId: string, snapshot: string): Promise<void> {
    const tx = this.db.transaction(['updates', 'canvases'], 'readwrite')
    const updates = tx.objectStore('updates')
    updates.delete(range(canvasId))
    updates.add({ canvasId, seq: 0, b64: snapshot })
    const canvases = tx.objectStore('canvases')
    const record = (await request(canvases.get(canvasId))) as CanvasRecord | undefined
    if (record) canvases.put({ ...record, logChars: 0 })
    await done(tx)
  }

  async remove(canvasId: string): Promise<void> {
    const tx = this.db.transaction(['updates', 'canvases'], 'readwrite')
    tx.objectStore('updates').delete(range(canvasId))
    tx.objectStore('canvases').delete(canvasId)
    await done(tx)
  }
}

const range = (canvasId: string) => IDBKeyRange.bound([canvasId, 0], [canvasId, Number.MAX_SAFE_INTEGER])
