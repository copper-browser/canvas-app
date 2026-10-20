/** The canvas server in the list screen: connect, the canvases on it, sign out. */
import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { Cloud, Users } from 'lucide-react'
import type { WebHost } from './host'
import { ago } from './Home'
import { SignInOptions } from './SignIn'

export function CloudSection({ host }: { host: WebHost }) {
  const { cloud, cloudCanvases, cloudBusy, providers } = useSyncExternalStore(host.subscribe, host.getState)
  const [connecting, setConnecting] = useState(false)
  if (!cloud && providers.length > 0) {
    return (
      <section className="mt-10 rounded-[14px] border border-dashed border-line p-5">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold">
          <Cloud className="h-4 w-4" aria-hidden="true" />
          Shared canvases
        </h2>
        <p className="mt-1 text-[13px] text-ink-3">Sign in to open the canvases shared with you and work on them together, live.</p>
        <div className="max-w-[360px]">
          <SignInOptions host={host} />
        </div>
      </section>
    )
  }
  if (!cloud) {
    return (
      <section className="mt-10 rounded-[14px] border border-dashed border-line p-5">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold">
          <Cloud className="h-4 w-4" aria-hidden="true" />
          Shared canvases
        </h2>
        <p className="mt-1 text-[13px] text-ink-3">Sign in to a canvas server to work on canvases together, live, with people in Copper or in any browser.</p>
        {connecting ? (
          <ConnectForm host={host} onDone={() => setConnecting(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setConnecting(true)}
            className="mt-3 h-8 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2"
          >
            Connect…
          </button>
        )}
      </section>
    )
  }
  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-2 text-[14px] font-semibold">
        <Cloud className="h-4 w-4" aria-hidden="true" />
        Shared canvases
        <span className="truncate font-normal text-ink-3">on {new URL(cloud.server).host}</span>
      </h2>
      {cloudCanvases === null ? (
        <p className="mt-4 text-[13px] text-ink-3">{cloudBusy ? 'Loading…' : 'Could not load the canvases.'}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {cloudCanvases.map(c => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void host.openCloud(c)}
                className="block w-full rounded-[14px] border border-line bg-surface p-4 text-left shadow-2 outline-none hover:border-line-2 focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <span className="block truncate text-[14px] font-semibold">{c.name}</span>
                <span className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-3">
                  {c.kind === 'shared' && <Users className="h-3 w-3" aria-hidden="true" />}
                  {c.kind === 'personal' ? 'Private' : `${c.member_count} ${c.member_count === 1 ? 'person' : 'people'}`} · {ago(Date.parse(c.updated_at))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Server + email + password; the server defaults to the one serving this page. */
export function ConnectForm({ host, onDone, note }: { host: WebHost; onDone?: () => void; note?: string }) {
  const { homeServer } = useSyncExternalStore(host.subscribe, host.getState)
  const [signup, setSignup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    try {
      await host.connect({
        server: String(f.get('server') ?? homeServer ?? ''),
        email: String(f.get('email') ?? ''),
        password: String(f.get('password') ?? ''),
        signup,
        displayName: String(f.get('name') ?? ''),
      })
      onDone?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const field = 'mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent'
  return (
    <form onSubmit={e => void submit(e)} className="mt-4 grid max-w-[420px] gap-3 text-[12.5px] text-ink-2">
      {note && <p className="text-[13px] text-ink-2">{note}</p>}
      {homeServer ? (
        <p className="text-[12.5px] text-ink-3">Server: {new URL(homeServer).host}</p>
      ) : (
        <label>
          Server
          <input name="server" required autoComplete="url" spellCheck={false} placeholder="canvas.example.com" className={field} />
          <span className="mt-1 block text-ink-4">Your canvas server's address, or a Copper Cloud link code (copper-cloud://…).</span>
        </label>
      )}
      {signup && (
        <label>
          Your name
          <input name="name" autoComplete="name" className={field} />
        </label>
      )}
      <label>
        Email
        <input name="email" type="email" required autoComplete="email" className={field} />
      </label>
      <label>
        Password
        <input name="password" type="password" required minLength={signup ? 10 : 1} autoComplete={signup ? 'new-password' : 'current-password'} className={field} />
      </label>
      {error && (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="h-8 rounded-lg bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-strong disabled:opacity-60">
          {busy ? 'Connecting…' : signup ? 'Create account' : 'Sign in'}
        </button>
        <button type="button" onClick={() => setSignup(s => !s)} className="text-[12.5px] text-ink-3 underline hover:text-ink">
          {signup ? 'I have an account' : 'Create an account instead'}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="ml-auto text-[12.5px] text-ink-3 hover:text-ink">
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
