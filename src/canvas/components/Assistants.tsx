/**
 * The assistants a canvas features (`../assistants.ts`), beside the title pill:
 * a chip each — its picture, its name and a Chat button — that opens a chat
 * with it in a small window of its own. Not the canvas's chat (`../chat/`),
 * which is people talking to each other.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { MessageCircle } from 'lucide-react'
import type * as Y from 'yjs'
import { hasNativeHost } from '../../host-bridge'
import { chatWindowName, httpUrl, readAssistants, type CanvasAssistant } from '../assistants'
import { colorFor, initials } from '../colors'
import { Panel, cn } from './ui'

/** Chips shown before the rest fold into "+N". */
const SHOWN = 2
const CHAT_W = 420
const CHAT_H = 720

/** External store over the `assistants` map, for useSyncExternalStore (as `use-presence.ts` does for `agents`). */
class AssistantsStore {
  private snapshot: CanvasAssistant[]
  private readonly map: Y.Map<unknown>
  constructor(map: Y.Map<unknown>) {
    this.map = map
    this.snapshot = readAssistants(map)
  }
  subscribe = (fn: () => void) => {
    const onChange = () => {
      this.snapshot = readAssistants(this.map)
      fn()
    }
    this.map.observeDeep(onChange)
    return () => this.map.unobserveDeep(onChange)
  }
  get = () => this.snapshot
}

export function useAssistants(map: Y.Map<unknown>): CanvasAssistant[] {
  const store = useMemo(() => new AssistantsStore(map), [map])
  return useSyncExternalStore(store.subscribe, store.get)
}

/** The chat windows this page opened, by assistant: a second click brings one back instead of loading it again. */
const chats = new Map<string, { win: Window; url: string }>()

/**
 * Open a chat with an assistant: a small window at the right edge of the
 * screen, so the canvas stays in view. `openUrl` is how the board opens any
 * link (a host's tab, or a new tab): used when a host owns opening URLs, and
 * when the browser blocks the window.
 */
export function openAssistantChat(assistant: Pick<CanvasAssistant, 'id' | 'chat'>, openUrl: (url: string) => void) {
  // Checked again at the click: nothing but http(s) ever opens.
  const url = httpUrl(assistant.chat)
  if (!url) return
  if (hasNativeHost()) return openUrl(url)
  const had = chats.get(assistant.id)
  if (had && had.url === url && !had.win.closed) return had.win.focus()
  const s = window.screen as Screen & { availLeft?: number; availTop?: number }
  const h = Math.min(CHAT_H, s.availHeight)
  const left = Math.max(0, (s.availLeft ?? 0) + s.availWidth - CHAT_W)
  const top = Math.max(0, (s.availTop ?? 0) + Math.round((s.availHeight - h) / 2))
  // `noopener=no`: the handle is how a blocked window is noticed and an open one focused.
  const win = window.open(url, chatWindowName(assistant.id), `popup=yes,width=${CHAT_W},height=${h},left=${left},top=${top},noopener=no`)
  if (!win) return openUrl(url)
  chats.set(assistant.id, { win, url })
  win.focus()
}

const TIP = 'tip tip-wrap rounded-lg bg-[#1d1d1f] px-2 py-1 text-left text-[11.5px] font-medium leading-snug text-white shadow-2 dark:bg-[#f2f2ef] dark:text-[#1d1d1f]'

/** Its picture, or its initials on its own colour when there is none (or it fails to load). */
function AssistantAvatar({ assistant }: { assistant: CanvasAssistant }) {
  const [failed, setFailed] = useState<string | null>(null)
  const src = assistant.avatar && assistant.avatar !== failed ? assistant.avatar : null
  return src ? (
    <img
      src={src}
      alt=""
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className="h-6 w-6 shrink-0 rounded-full bg-surface-2 object-cover ring-1 ring-line"
    />
  ) : (
    <span
      aria-hidden="true"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold text-white"
      style={{ background: colorFor(assistant.id) }}
    >
      {initials(assistant.name)}
    </span>
  )
}

function Chip({ assistant, onChat, row }: { assistant: CanvasAssistant; onChat: (a: CanvasAssistant) => void; row?: boolean }) {
  return (
    <button
      type="button"
      role={row ? 'menuitem' : undefined}
      data-testid="assistant-chip"
      aria-label={`Chat with ${assistant.name}${assistant.about ? `: ${assistant.about}` : ''}`}
      onClick={() => onChat(assistant)}
      className={cn(
        'group flex h-7 min-w-0 items-center gap-1.5 rounded-lg py-0.5 pl-0.5 pr-0.5 text-left outline-none transition-colors duration-100 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/60',
        row ? 'w-full gap-2' : 'tip-host tip-below tip-start shrink-0'
      )}
    >
      <AssistantAvatar assistant={assistant} />
      <span className={cn('min-w-0 truncate text-[12.5px] font-medium text-ink', row ? 'flex-1' : 'max-w-[120px] max-[641px]:hidden')}>{assistant.name}</span>
      <span
        data-testid="assistant-chat"
        className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-accent-soft px-1.5 text-[12px] font-semibold text-accent-strong transition-colors duration-100 group-hover:bg-accent group-hover:text-accent-ink"
      >
        <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
        <span className={cn(!row && 'max-[641px]:hidden')}>Chat</span>
      </span>
      {!row && (
        <span className={TIP}>
          Chat with {assistant.name}
          {assistant.about && <span className="block font-normal opacity-75">{assistant.about}</span>}
        </span>
      )}
    </button>
  )
}

export function AssistantChips({ assistants, onOpenUrl }: { assistants: readonly CanvasAssistant[]; onOpenUrl: (url: string) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const rest = assistants.slice(SHOWN)
  const more = open && rest.length > 0

  useEffect(() => {
    if (!more) return
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      if (root.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true })
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [more])

  if (assistants.length === 0) return null
  const chat = (a: CanvasAssistant) => {
    setOpen(false)
    openAssistantChat(a, onOpenUrl)
  }
  return (
    <div
      ref={root}
      // Beside the title pill from 1152 px, where the fullest top bar has room for both (`TitleBar`); narrower, on a row of its own under it.
      className="pointer-events-auto relative shrink-0 max-[1152px]:absolute max-[1152px]:left-0 max-[1152px]:top-[calc(100%+8px)]"
      data-testid="canvas-assistants"
      onKeyDown={e => {
        // Enter and Space on these buttons press them; they are not the board's shortcuts.
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
      }}
    >
      <Panel role="group" aria-label="Assistants" className="flex items-center gap-1 p-1">
        {assistants.slice(0, SHOWN).map(a => (
          <Chip key={a.id} assistant={a} onChat={chat} />
        ))}
        {rest.length > 0 && (
          <button
            ref={trigger}
            type="button"
            data-testid="assistant-more"
            aria-label={`${rest.length} more ${rest.length === 1 ? 'assistant' : 'assistants'}: ${rest.map(a => a.name).join(', ')}`}
            aria-haspopup="menu"
            aria-expanded={more}
            onClick={() => setOpen(o => !o)}
            className={cn(
              'tip-host tip-below flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg px-1.5 text-[12px] font-semibold tabular-nums text-ink-2 outline-none transition-colors duration-100 hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60',
              more && 'bg-surface-2 text-ink'
            )}
          >
            +{rest.length}
            {!more && <span className={TIP}>{rest.map(a => a.name).join(', ')}</span>}
          </button>
        )}
      </Panel>
      {more && (
        <Panel role="menu" aria-label="More assistants" className="pop-in absolute left-0 top-[calc(100%+8px)] z-40 flex w-max min-w-[200px] max-w-[min(280px,calc(100vw-24px))] flex-col gap-0.5 p-1">
          {rest.map(a => (
            <Chip key={a.id} assistant={a} onChat={chat} row />
          ))}
        </Panel>
      )}
    </div>
  )
}
