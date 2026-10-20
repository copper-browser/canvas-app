/** Who this browser is signed in as, and the way out: the avatar menu in the list's header. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronDown, LogOut } from 'lucide-react'
import type { WebHost } from './host'

export function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length >= 2 ? `${words[0]![0]}${words[words.length - 1]![0]}` : (words[0] ?? email).slice(0, 2)
  return letters.toUpperCase()
}

export function AccountMenu({ host }: { host: WebHost }) {
  const { cloud, brand } = useSyncExternalStore(host.subscribe, host.getState)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [open])
  if (!cloud) return null
  const name = cloud.user.display_name || cloud.user.email
  let server = cloud.server
  try {
    server = new URL(cloud.server).host
  } catch {
    // Shown as stored.
  }
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${name}`}
        onClick={() => setOpen(o => !o)}
        className="flex h-8 items-center gap-2 rounded-full border border-line bg-surface py-0.5 pl-0.5 pr-2.5 text-[13px] text-ink outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span
          aria-hidden="true"
          className={'flex h-[26px] w-[26px] items-center justify-center rounded-full text-[11px] font-bold ' + (brand ? 'cw-brand-avatar' : 'bg-accent text-white')}
        >
          {initials(cloud.user.display_name, cloud.user.email)}
        </span>
        <span className="hidden max-w-[160px] truncate sm:inline">{name}</span>
        <ChevronDown className="h-3.5 w-3.5 text-ink-3" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-10 w-[260px] rounded-xl border border-line bg-surface p-1 shadow-2">
          <div className="px-3 pb-2.5 pt-2">
            <p className="truncate text-[13.5px] font-semibold text-ink">{cloud.user.display_name || cloud.user.email}</p>
            {cloud.user.display_name && <p className="truncate text-[12.5px] text-ink-3">{cloud.user.email}</p>}
            <p className="mt-1 truncate text-[12px] text-ink-4">Signed in to {server}</p>
          </div>
          <div className="mx-1 border-t border-line" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void host.disconnect()
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink outline-none hover:bg-surface-2 focus-visible:bg-surface-2"
          >
            <LogOut className="h-4 w-4 text-ink-3" aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
