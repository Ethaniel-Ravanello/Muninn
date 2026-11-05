import { useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { pb, uidOwner } from '../pb'
import { errMsg, isUrl } from '../util'
import { notifyChanged } from '../reminders'

const KINDS = ['note', 'task', 'idea', 'link'] as const

/** Single-line capture box. Anything typed here lands in the Inbox to be sorted later. */
export function QuickInbox({ autoFocus, onAdded }: { autoFocus?: boolean; onAdded?: () => void }) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<(typeof KINDS)[number]>('note')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  const submit = async () => {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      await pb.collection('inbox').create({ user: uidOwner(), text: value, kind: isUrl(value) ? 'link' : kind })
      setText('')
      setError('')
      notifyChanged()
      onAdded?.()
      ref.current?.focus()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="row">
        <input ref={ref} type="text" value={text} autoFocus={autoFocus} placeholder="Capture anything: an idea, a task, a link..."
          aria-label="Quick inbox" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          style={{ fontSize: 15, padding: '10px 14px' }} />
        <button className="btn primary" onClick={() => void submit()} disabled={busy || !text.trim()} aria-label="Add to inbox"><Send size={16} /></button>
      </div>
      <div className="chips" style={{ marginTop: 8 }}>
        {KINDS.map((k) => <button key={k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>{k}</button>)}
      </div>
      {error && <div className="err" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  )
}
