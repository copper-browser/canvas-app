/** Invites to other people's canvases, waiting for you: accept (and open) or decline. */
import { useState, useSyncExternalStore } from 'react'
import { MailOpen } from 'lucide-react'
import type { WebHost } from './host'
import type { CloudInvite } from './cloud'
import { ago } from './Home'

export function InvitesSection({ host }: { host: WebHost }) {
  const { invites } = useSyncExternalStore(host.subscribe, host.getState)
  if (!invites || invites.length === 0) return null
  return (
    <section className="mt-8" aria-labelledby="invites-title">
      <h2 id="invites-title" className="flex items-center gap-2 text-[14px] font-semibold">
        <MailOpen className="h-4 w-4" aria-hidden="true" />
        Invitations
        <span className="font-normal text-ink-3">{invites.length}</span>
      </h2>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface shadow-1">
        {invites.map(i => (
          <InviteRow key={i.id} host={host} invite={i} />
        ))}
      </ul>
    </section>
  )
}

function InviteRow({ host, invite }: { host: WebHost; invite: CloudInvite }) {
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const from = invite.invited_by?.display_name || invite.invited_by?.email
  const run = async (what: 'accept' | 'decline') => {
    setBusy(what)
    try {
      if (what === 'accept') await host.acceptInvite(invite)
      else await host.declineInvite(invite)
    } catch (error) {
      host.fail(error instanceof Error ? error.message : String(error))
      void host.refreshInvites()
      setBusy(null)
    }
  }
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold">{invite.canvas_name || 'Untitled canvas'}</p>
        <p className="mt-0.5 truncate text-[12.5px] text-ink-3">
          {from ? `From ${from}` : 'Invitation'}
          {invite.created_at && !Number.isNaN(Date.parse(invite.created_at)) ? ` · ${ago(Date.parse(invite.created_at))}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run('decline')}
          className="h-8 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60"
        >
          {busy === 'decline' ? 'Declining…' : 'Decline'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run('accept')}
          className="h-8 rounded-lg bg-accent px-3 text-[13px] font-medium text-white outline-none hover:bg-accent-strong focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60"
        >
          {busy === 'accept' ? 'Opening…' : 'Accept'}
        </button>
      </div>
    </li>
  )
}
