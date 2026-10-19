/** Who this browser is on a board: a stable id, a name the user picks, a colour from the id. */
import { colorFor } from '../canvas/colors'

export interface Me {
  id: string
  name: string
  color: string
}

const KEY = 'canvas-app:me'

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export function loadMe(storage: Storage = localStorage): Me {
  try {
    const raw = storage.getItem(KEY)
    const v = raw ? (JSON.parse(raw) as Partial<Me>) : null
    if (v && typeof v.id === 'string' && v.id) {
      return { id: v.id, name: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : 'You', color: colorFor(v.id) }
    }
  } catch {
    // A broken entry is replaced below.
  }
  const me = { id: `web-${newId()}`, name: 'You', color: '' }
  me.color = colorFor(me.id)
  saveMe(me, storage)
  return me
}

export function saveMe(me: Me, storage: Storage = localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify({ id: me.id, name: me.name }))
  } catch {
    // Private windows may refuse storage; the name then lasts for this tab.
  }
}
