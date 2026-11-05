import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useCollection } from '../data'
import { pb, uidOwner, type Rec } from '../pb'
import { QuickInbox } from '../components/QuickInbox'
import { Badge, Empty, PageHead } from '../components/ui'
import { notifyChanged } from '../reminders'
import { errMsg, isUrl, today } from '../util'

type Target = 'task' | 'note' | 'bookmark' | 'wishlist' | 'journal' | 'reminder'

/** How an inbox line becomes a proper record in its destination module. */
async function convert(item: Rec, to: Target) {
  const text = String(item.text)
  const user = uidOwner()
  const short = text.length > 80 ? `${text.slice(0, 77)}...` : text
  switch (to) {
    case 'task': return pb.collection('tasks').create({ user, title: short, notes: text.length > 80 ? text : '', status: 'todo', priority: 'medium' })
    case 'note': return pb.collection('notes').create({ user, title: short, content: text })
    case 'bookmark': return pb.collection('bookmarks').create({ user, title: short, url: isUrl(text) ? text : '', kind: 'link', content: isUrl(text) ? '' : text })
    case 'wishlist': return pb.collection('wishlist').create({ user, name: short, status: 'wanted', urgency: 'medium' })
    case 'journal': return pb.collection('journal').create({ user, date: today(), content: text })
    case 'reminder': return pb.collection('reminders').create({ user, title: short, due: today(), repeat: 'none', done: false })
  }
}

const TARGETS: { to: Target; label: string }[] = [
  { to: 'task', label: 'Task' }, { to: 'note', label: 'Note' }, { to: 'bookmark', label: 'Bookmark' },
  { to: 'wishlist', label: 'Wish' }, { to: 'journal', label: 'Journal' }, { to: 'reminder', label: 'Remind me' },
]

export default function InboxPage() {
  const inbox = useCollection('inbox', { sort: '-created' })
  const [err, setErr] = useState('')

  const sort = async (item: Rec, to: Target) => {
    try {
      await convert(item, to)
      await inbox.remove(item.id)
      notifyChanged()
      setErr('')
    } catch (e) { setErr(errMsg(e)) }
  }

  return (
    <div className="page">
      <PageHead title="Inbox" sub="Capture first, sort later. Each item can become a task, note, bookmark, wish, journal entry or reminder." />
      <div className="card" style={{ marginBottom: 18 }}><QuickInbox onAdded={() => void inbox.reload()} /></div>
      {(err || inbox.error) && <div className="err" style={{ marginBottom: 10 }}>{err || inbox.error}</div>}
      {inbox.loading ? <div className="muted">Loading...</div> : inbox.items.length === 0 ? (
        <Empty>Inbox zero. Nice.</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {inbox.items.map((i) => (
            <div key={i.id} className="card">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="grow" style={{ wordBreak: 'break-word' }}>
                  {isUrl(String(i.text)) ? <a href={i.text} target="_blank" rel="noreferrer noopener">{i.text}</a> : i.text}
                </div>
                {i.kind && <Badge value={i.kind} tone="violet" />}
                <button className="icon-btn" aria-label="Discard" onClick={() => void inbox.remove(i.id)}><Trash2 size={16} /></button>
              </div>
              <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
                <span className="small faint">Move to:</span>
                {TARGETS.map((t) => <button key={t.to} className="btn sm" onClick={() => void sort(i, t.to)}>{t.label}</button>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
