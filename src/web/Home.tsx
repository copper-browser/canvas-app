/** The browser host's own screens: the list of canvases and the share sheet. */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Code2, Download, FileUp, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { WebHost } from './host'
import type { CanvasRecord } from './store'

const REPO = 'https://github.com/copper-browser/canvas-app'

export function WebShell({ host }: { host: WebHost }) {
  const state = useSyncExternalStore(host.subscribe, host.getState)
  return (
    <>
      {state.route.view === 'home' && <Home host={host} />}
      {state.sharing && state.current && <ShareSheet host={host} canvas={state.current} />}
      {state.error && <Toast text={state.error} onClose={() => host.fail(null)} />}
    </>
  )
}

function Home({ host }: { host: WebHost }) {
  const { canvases, me } = useSyncExternalStore(host.subscribe, host.getState)
  const fileInput = useRef<HTMLInputElement>(null)
  const open = (id: string) => host.navigate({ view: 'canvas', id })
  const create = async () => open((await host.create()).id)
  const importFile = async (file: File) => {
    try {
      open((await host.importFile(await file.text())).id)
    } catch (error) {
      host.fail(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <div role="dialog" aria-label="Canvases" className="fixed inset-0 z-[100] overflow-y-auto bg-bg text-ink">
      <div className="mx-auto flex min-h-full max-w-[960px] flex-col px-6 pb-10 pt-10">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-[22px] font-semibold tracking-[-0.01em]">Canvases</h1>
          <NameField key={me.name} name={me.name} onSave={name => host.setName(name)} />
          <Button onClick={() => fileInput.current?.click()} icon={<FileUp className="h-4 w-4" />}>
            Open file
          </Button>
          <Button primary onClick={() => void create()} icon={<Plus className="h-4 w-4" />}>
            New canvas
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".canvas,application/json"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void importFile(file)
            }}
          />
        </header>
        <p className="mt-1.5 text-[13px] text-ink-3">Saved in this browser. Download one as a file to keep or send it.</p>

        {canvases.length === 0 ? (
          <div className="mt-16 flex flex-col items-center gap-3 text-center text-ink-3">
            <p className="text-[14px]">No canvases in this browser yet.</p>
            <Button primary onClick={() => void create()} icon={<Plus className="h-4 w-4" />}>
              New canvas
            </Button>
          </div>
        ) : (
          <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {canvases.map(c => (
              <CanvasCard key={c.id} canvas={c} host={host} onOpen={() => open(c.id)} />
            ))}
          </ul>
        )}

        <footer className="mt-auto pt-12 text-[12px] text-ink-4">
          Canvas is open source, from the{' '}
          <a className="underline hover:text-ink-2" href="https://github.com/copper-browser/Copper" target="_blank" rel="noreferrer">
            Copper
          </a>{' '}
          browser.{' '}
          <a className="inline-flex items-center gap-1 underline hover:text-ink-2" href={REPO} target="_blank" rel="noreferrer">
            <Code2 className="h-3 w-3" aria-hidden="true" />
            Source
          </a>
        </footer>
      </div>
    </div>
  )
}

function CanvasCard({ canvas, host, onOpen }: { canvas: CanvasRecord; host: WebHost; onOpen: () => void }) {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  return (
    <li className="group relative rounded-[14px] border border-line bg-surface shadow-2 transition-colors hover:border-line-2">
      {renaming ? (
        <form
          className="p-4"
          onSubmit={e => {
            e.preventDefault()
            const name = new FormData(e.currentTarget).get('name')
            void host.rename(canvas.id, String(name ?? ''))
            setRenaming(false)
          }}
        >
          <input
            name="name"
            autoFocus
            defaultValue={canvas.name}
            onBlur={e => {
              void host.rename(canvas.id, e.currentTarget.value)
              setRenaming(false)
            }}
            onKeyDown={e => e.key === 'Escape' && setRenaming(false)}
            className="w-full rounded-md border border-line bg-surface-2 px-2 py-1 text-[14px] font-semibold outline-none focus:border-accent"
          />
        </form>
      ) : (
        <button type="button" onClick={onOpen} className="block w-full rounded-[14px] p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
          <span className="block truncate pr-7 text-[14px] font-semibold">{canvas.name}</span>
          <span className="mt-1 block text-[12px] text-ink-3">Edited {ago(canvas.updatedAt)}</span>
        </button>
      )}
      <button
        type="button"
        aria-label={`More for ${canvas.name}`}
        onClick={() => setMenu(m => !m)}
        className="absolute right-2 top-2.5 flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 opacity-0 outline-none hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
        aria-expanded={menu}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {menu && (
        <Menu onClose={() => setMenu(false)}>
          <MenuItem icon={<Pencil className="h-4 w-4" />} onClick={() => setRenaming(true)}>
            Rename
          </MenuItem>
          <MenuItem icon={<Download className="h-4 w-4" />} onClick={() => void download(host, canvas.id)}>
            Download
          </MenuItem>
          <MenuItem
            danger
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => {
              if (confirm(`Delete “${canvas.name}” from this browser? This can't be undone.`)) void host.remove(canvas.id)
            }}
          >
            Delete
          </MenuItem>
        </Menu>
      )}
    </li>
  )
}

function ShareSheet({ host, canvas }: { host: WebHost; canvas: CanvasRecord }) {
  return (
    <Modal title="Share" onClose={() => host.closeShare()}>
      <p className="text-[13px] leading-relaxed text-ink-2">
        “{canvas.name}” lives in this browser. Download it as a file; anyone can open it here with <b>Open file</b>, or in Copper.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={() => host.closeShare()}>Done</Button>
        <Button primary icon={<Download className="h-4 w-4" />} onClick={() => void download(host, canvas.id)}>
          Download
        </Button>
      </div>
    </Modal>
  )
}

function NameField({ name, onSave }: { name: string; onSave: (name: string) => void }) {
  const [value, setValue] = useState(name)
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-ink-3">
      Your name
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={() => value.trim() !== name && onSave(value)}
        onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
        maxLength={40}
        className="w-32 rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
      />
    </label>
  )
}

async function download(host: WebHost, id: string) {
  try {
    const { name, file } = await host.exportFile(id)
    const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'canvas'}.canvas`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (error) {
    host.fail(error instanceof Error ? error.message : String(error))
  }
}

export function ago(at: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} d ago`
  return new Date(at).toLocaleDateString()
}

// ---- small pieces ---------------------------------------------------------------------

function Button({ children, onClick, icon, primary }: { children: ReactNode; onClick: () => void; icon?: ReactNode; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ' +
        (primary ? 'bg-accent text-white hover:bg-accent-strong' : 'border border-line bg-surface text-ink hover:bg-surface-2')
      }
    >
      {icon}
      {children}
    </button>
  )
}

function Menu({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])
  return (
    <div ref={ref} role="menu" className="absolute right-2 top-11 z-10 min-w-[160px] rounded-xl border border-line bg-surface p-1 shadow-2">
      {children}
    </div>
  )
}

function MenuItem({ children, onClick, icon, danger }: { children: ReactNode; onClick: () => void; icon: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2 ' + (danger ? 'text-danger' : 'text-ink')}
    >
      {icon}
      {children}
    </button>
  )
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/25 p-4" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={title} className="w-full max-w-[420px] rounded-[16px] border border-line bg-surface p-5 text-ink shadow-2">
        <div className="mb-2 flex items-center">
          <h2 className="mr-auto text-[15px] font-semibold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000)
    return () => clearTimeout(t)
  }, [text, onClose])
  return (
    <div role="alert" className="fixed bottom-5 left-1/2 z-[120] flex -translate-x-1/2 items-center gap-3 rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-[13px] text-white shadow-2 dark:bg-[#f2f2ef] dark:text-[#1d1d1f]">
      {text}
      <button type="button" aria-label="Dismiss" onClick={onClose} className="opacity-70 hover:opacity-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
