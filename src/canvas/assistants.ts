/**
 * Assistants on the board: agents people can chat with. An entry of the root
 * `assistants` map (plain objects, replaced whole) stays until someone removes
 * it — unlike `agents` (`agents.ts`), which is live presence on a two-second
 * lease. The chrome shows each one as a chip that opens its `chat` URL.
 */
import * as Y from 'yjs'
import { clipText } from './text-diff'

export interface CanvasAssistant {
  id: string
  name: string
  /** Where a chat with it opens: an http(s) URL. */
  chat: string
  /** A square picture of it: an http(s) URL. */
  avatar?: string
  /** One line on what to ask it. */
  about?: string
  /** Epoch ms, set by the writer. */
  addedAt: number
}

export const MAX_ASSISTANTS = 8
export const ASSISTANT_ID = /^[A-Za-z0-9_:.-]{1,64}$/
const MAX_NAME = 60
const MAX_URL = 2048
const MAX_ABOUT = 140

const plain = (v: unknown): Record<string, unknown> | null => {
  if (v instanceof Y.Map) return v.toJSON() as Record<string, unknown>
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

const oneLine = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/** An http(s) URL of at most 2048 characters, normalised; null for anything else (`javascript:`, `data:`, …). */
export function httpUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > MAX_URL) return null
  try {
    const u = new URL(v.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/** Tolerant read of one entry; null without a name or an http(s) `chat`. */
export function readAssistant(id: string, value: unknown): CanvasAssistant | null {
  const v = plain(value)
  if (!v) return null
  const name = clipText(oneLine(v.name), MAX_NAME)
  const chat = httpUrl(v.chat)
  if (!name || !chat) return null
  const out: CanvasAssistant = { id, name, chat, addedAt: typeof v.addedAt === 'number' && Number.isFinite(v.addedAt) ? v.addedAt : 0 }
  const avatar = httpUrl(v.avatar)
  if (avatar) out.avatar = avatar
  const about = clipText(oneLine(v.about), MAX_ABOUT)
  if (about) out.about = about
  return out
}

/** Every readable entry, oldest first (then by id). */
export function readAssistants(map: Y.Map<unknown>): CanvasAssistant[] {
  const out: CanvasAssistant[] = []
  map.forEach((value, id) => {
    const assistant = readAssistant(id, value)
    if (assistant) out.push(assistant)
  })
  return out.sort((a, b) => a.addedAt - b.addedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * Add or replace an assistant (the value is written whole; a replaced entry
 * keeps its `addedAt`). Throws, naming the field, when the input is not valid.
 */
export function writeAssistant(map: Y.Map<unknown>, id: string, input: Record<string, unknown>, now = Date.now()): CanvasAssistant {
  if (!ASSISTANT_ID.test(id)) throw new Error('`id` must be 1–64 of A–Z a–z 0–9 _ - : .')
  const name = oneLine(input.name)
  if (!name || name.length > MAX_NAME) throw new Error(`\`name\` must be 1–${MAX_NAME} characters`)
  const chat = httpUrl(input.chat)
  if (!chat) throw new Error(`\`chat\` must be an http(s) URL of at most ${MAX_URL} characters`)
  const next: Omit<CanvasAssistant, 'id'> = { name, chat, addedAt: now }
  if (input.avatar != null && input.avatar !== '') {
    const avatar = httpUrl(input.avatar)
    if (!avatar) throw new Error(`\`avatar\` must be an http(s) URL of at most ${MAX_URL} characters`)
    next.avatar = avatar
  }
  if (input.about != null && typeof input.about !== 'string') throw new Error('`about` must be a string')
  const about = oneLine(input.about)
  if (about.length > MAX_ABOUT) throw new Error(`\`about\` must be at most ${MAX_ABOUT} characters`)
  if (about) next.about = about
  if (!map.has(id) && map.size >= MAX_ASSISTANTS) throw new Error(`at most ${MAX_ASSISTANTS} assistants per canvas`)
  const prev = plain(map.get(id))
  if (prev && typeof prev.addedAt === 'number' && Number.isFinite(prev.addedAt)) next.addedAt = prev.addedAt
  map.set(id, next)
  return { id, ...next }
}

/** Remove an assistant; true if it was there. */
export function removeAssistant(map: Y.Map<unknown>, id: string): boolean {
  const had = map.has(id)
  map.delete(id)
  return had
}

/** The name of an assistant's chat window: one window per assistant, so opening it again focuses it. */
export const chatWindowName = (id: string) => `canvas-assistant-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`
