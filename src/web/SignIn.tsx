/**
 * Signing in, and arriving by link signed out: one card, led by the server's single sign-on
 * ("Continue with Google"), with email and password as the quieter way in.
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { ArrowLeft, KeyRound, Link2Off, LoaderCircle, MousePointer2, RotateCw, TriangleAlert } from 'lucide-react'
import type { Landing, WebHost } from './host'
import type { OidcProvider } from './auth'
import type { Brand } from './brand'
import { ConnectForm } from './CloudPanel'

/** Google's four-colour "G" (its sign-in button mark). */
export function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

const isGoogle = (p: OidcProvider) => p.id === 'google' || /^google$/i.test(p.name)

function ProviderButton({ provider, onClick, busy }: { provider: OidcProvider; onClick: () => void; busy: boolean }) {
  if (isGoogle(provider)) {
    return (
      <button type="button" className="cw-gsi" onClick={onClick} disabled={busy}>
        {busy ? <LoaderCircle className="cw-spin h-[18px] w-[18px]" aria-hidden="true" /> : <GoogleMark />}
        <span>Continue with Google</span>
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex h-10 w-full items-center justify-center gap-2.5 rounded-[6px] border border-line-2 bg-surface px-3 text-[14px] font-medium text-ink outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-70"
    >
      {busy ? <LoaderCircle className="cw-spin h-4 w-4" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
      <span>Continue with {provider.name}</span>
    </button>
  )
}

/** The deployment's wordmark, in the variant for the current theme. */
export function BrandLockup({ brand, height = 18 }: { brand: Brand; height?: number }) {
  return (
    <>
      <img src={brand.lockupLight} alt={brand.name} style={{ height }} className="w-auto dark:hidden" />
      <img src={brand.lockupDark} alt={brand.name} style={{ height }} className="hidden w-auto dark:block" />
    </>
  )
}

/** Provider buttons first, email and password behind a quiet link (or alone, with no providers). */
export function SignInOptions({ host }: { host: WebHost }) {
  const { providers, authError, infoLoaded, brand } = useSyncExternalStore(host.subscribe, host.getState)
  const [email, setEmail] = useState(false)
  const [leaving, setLeaving] = useState<string | null>(null)
  if (!infoLoaded) return <div className="mt-6 h-10 animate-pulse rounded-[6px] bg-surface-2" aria-hidden="true" />
  const go = (p: OidcProvider) => {
    setLeaving(p.id)
    host.signInWith(p)
  }
  return (
    <div className="mt-6">
      {authError && (
        <p role="alert" className="cw-alert mb-4 flex gap-2 rounded-lg px-3 py-2.5 text-[13px] leading-snug">
          <TriangleAlert className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{authError}</span>
        </p>
      )}
      {providers.length > 0 && (
        <div className="grid gap-2">
          {providers.map(p => (
            <ProviderButton key={p.id} provider={p} busy={leaving === p.id} onClick={() => go(p)} />
          ))}
        </div>
      )}
      {providers.length === 0 || email ? (
        <div className={providers.length > 0 ? 'mt-5 border-t border-line pt-1' : undefined}>
          <ConnectForm host={host} onDone={providers.length > 0 ? () => setEmail(false) : undefined} />
        </div>
      ) : (
        <button type="button" onClick={() => setEmail(true)} className="mt-4 text-[13px] text-ink-3 underline-offset-2 outline-none hover:text-ink hover:underline focus-visible:underline">
          Use email and password instead
        </button>
      )}
      {brand && providers.length > 0 && (
        <p className="mt-6 border-t border-line pt-4 text-[12px] leading-relaxed text-ink-3">
          {providers.length === 1 ? `${providers[0]!.name} sign-in is for @${brand.domain} accounts.` : `Sign in with your @${brand.domain} account.`}
        </p>
      )}
    </div>
  )
}

/** A centred card over the app's paper, with the deployment's mark when it has one. */
export function Card({ brand, children, label }: { brand: Brand | null; children: ReactNode; label: string }) {
  return (
    <div role="dialog" aria-label={label} className="fixed inset-0 z-[100] overflow-y-auto bg-bg text-ink">
      <div className="flex min-h-full flex-col items-center justify-start px-4 py-10 sm:justify-center sm:py-16">
        <div className="w-full max-w-[400px] overflow-hidden rounded-[14px] border border-line bg-surface shadow-2">
          {brand && <div className="cw-brand-strip" aria-hidden="true" />}
          <div className="px-6 pb-6 pt-5 sm:px-7 sm:pb-7">{children}</div>
        </div>
      </div>
    </div>
  )
}

function CardHead({ brand }: { brand: Brand | null }) {
  return (
    <div className="mb-5 flex h-[22px] items-center">
      {brand ? <BrandLockup brand={brand} /> : <span className="text-[13px] font-semibold tracking-[-0.01em] text-ink-2">Canvas</span>}
    </div>
  )
}

/** A few notes on dot paper, a frame and a cursor: the board this link opens, in miniature. */
function BoardVignette({ who }: { who: string }) {
  return (
    <div aria-hidden="true" className="cw-dots relative mb-5 h-[104px] overflow-hidden rounded-[10px] border border-line">
      <div className="absolute left-[18px] top-[16px] h-[72px] w-[156px] rounded-[8px] border border-line-2">
        <span className="absolute -top-[9px] left-2 bg-bg px-1 text-[10px] font-medium text-ink-3">Shared canvas</span>
        <div className="absolute left-[10px] top-[14px] h-[44px] w-[62px] rounded-[3px] bg-[var(--paper-yellow)] p-1.5 shadow-[var(--shadow-note)]">
          <div className="h-[3px] w-[38px] rounded bg-[var(--ink-on-yellow)] opacity-40" />
          <div className="mt-1 h-[3px] w-[28px] rounded bg-[var(--ink-on-yellow)] opacity-25" />
        </div>
        <div className="absolute left-[80px] top-[22px] h-[40px] w-[62px] rounded-[3px] bg-[var(--paper-blue)] p-1.5 shadow-[var(--shadow-note)]">
          <div className="h-[3px] w-[34px] rounded bg-[var(--ink-on-blue)] opacity-40" />
          <div className="mt-1 h-[3px] w-[22px] rounded bg-[var(--ink-on-blue)] opacity-25" />
        </div>
      </div>
      <div className="absolute left-[196px] top-[30px] h-[50px] w-[70px] rounded-[3px] bg-[var(--paper-green)] p-1.5 shadow-[var(--shadow-note)]">
        <div className="h-[3px] w-[40px] rounded bg-[var(--ink-on-green)] opacity-40" />
        <div className="mt-1 h-[3px] w-[30px] rounded bg-[var(--ink-on-green)] opacity-25" />
        <div className="mt-1 h-[3px] w-[36px] rounded bg-[var(--ink-on-green)] opacity-25" />
      </div>
      <div className="absolute left-[244px] top-[62px] flex items-start">
        <MousePointer2 className="h-4 w-4 fill-[var(--accent)] text-[var(--accent)]" />
        <span className="mt-3 rounded-full bg-[var(--accent)] px-1.5 py-px text-[10px] font-medium text-[var(--accent-ink)]">{who}</span>
      </div>
    </div>
  )
}

const hostOf = (server: string | null) => {
  try {
    return server ? new URL(server).host : null
  } catch {
    return null
  }
}

/**
 * The account to sign in with, in words: "your Exowatt Google account". A provider
 * already named after the brand ("Exowatt SSO") is not prefixed again.
 */
export function accountPhrase(brand: Brand | null, providers: OidcProvider[]) {
  const provider = providers.length === 1 ? providers[0]!.name : null
  if (brand && provider && provider.toLowerCase().startsWith(`${brand.name.toLowerCase()} `)) {
    return `your ${provider} account`
  }
  if (brand && provider) return `your ${brand.name} ${provider} account`
  if (provider) return `your ${provider} account`
  return brand ? `your ${brand.name} account` : 'your account'
}

/** What covers the board while a linked canvas can't open yet. */
export function LandingScreen({ host, landing }: { host: WebHost; landing: Landing }) {
  const { brand, providers, homeServer, cloud } = useSyncExternalStore(host.subscribe, host.getState)
  const home = () => host.navigate({ view: 'home' })
  if (landing.kind === 'busy') {
    return (
      <Card brand={null} label={landing.text}>
        <p className="flex items-center gap-2.5 text-[14px] text-ink-2" role="status">
          <LoaderCircle className="cw-spin h-4 w-4 text-ink-3" aria-hidden="true" />
          {landing.text}
        </p>
      </Card>
    )
  }
  if (landing.kind === 'error') {
    const gone = landing.code === 'link_gone'
    const title = gone ? 'This link doesn’t work anymore' : landing.code === 'no_access' ? 'You can’t open this canvas' : 'Couldn’t open this canvas'
    const body = gone
      ? 'It was turned off, or its canvas was deleted. Ask whoever sent it for a new one.'
      : landing.code === 'no_access'
        ? `It isn’t shared with ${cloud?.user.email ?? 'this account'}, or it was deleted. Ask its owner to invite you or send you its share link.`
        : landing.message
    return (
      <Card brand={brand} label={title}>
        <CardHead brand={brand} />
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
          {gone ? <Link2Off className="h-5 w-5" aria-hidden="true" /> : <TriangleAlert className="h-5 w-5" aria-hidden="true" />}
        </div>
        <h1 className="text-[21px] font-bold leading-tight tracking-[-0.015em]">{title}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{body}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={home}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-medium text-white outline-none hover:bg-accent-strong focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Your canvases
          </button>
          {landing.code === 'failed' && (
            <button
              type="button"
              onClick={() => host.retry()}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 text-[13px] font-medium text-ink outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </button>
          )}
        </div>
      </Card>
    )
  }
  const join = landing.reason === 'join'
  const title = join ? 'You’ve been invited to a canvas' : 'Sign in to open this canvas'
  const where = hostOf(homeServer)
  const account = accountPhrase(brand, providers)
  const body = join
    ? providers.length > 0
      ? `Sign in with ${account} to open it. You can edit and comment as soon as you’re in.`
      : 'Sign in to its canvas server to open it. You can edit and comment as soon as you’re in.'
    : providers.length > 0
      ? `It lives on ${where ?? 'its canvas server'}. Sign in with ${account} to see it and work on it with others.`
      : 'It lives on a canvas server. Sign in to see it and work on it with others.'
  return (
    <Card brand={brand} label={title}>
      <CardHead brand={brand} />
      <BoardVignette who={join ? 'You' : 'Team'} />
      <h1 className="text-[22px] font-bold leading-tight tracking-[-0.015em]">{title}</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{body}</p>
      <SignInOptions host={host} />
    </Card>
  )
}
