import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, Plus } from 'lucide-react'
import { useCollection } from '../data'
import { notifyChanged, useReminderItems, type RItem, type Source } from '../reminders'
import { RecordModal } from '../components/RecordModal'
import { Badge, Empty, PageHead } from '../components/ui'
import { opts, type Field } from '../types'
import { addDays, diffDays, errMsg, fmtDate, relDay, today } from '../util'

const FIELDS: Field[] = [
  { name: 'title', label: 'Reminder', type: 'text', required: true, full: true },
  { name: 'due', label: 'Due', type: 'date', required: true, default: today },
  { name: 'repeat', label: 'Repeat', type: 'select', options: opts('none', 'daily', 'weekly', 'monthly', 'yearly'), default: 'none', required: true },
  { name: 'notes', label: 'Notes', type: 'textarea' },
]

const SOURCE_TONE: Record<Source, string> = {
  reminder: 'green', task: 'violet', bill: 'gold', maintenance: 'blue', document: 'red', contact: 'amber',
}
const SOURCE_LABEL: Record<Source, string> = {
  reminder: 'Reminder', task: 'Task', bill: 'Bill', maintenance: 'Routine', document: 'Document', contact: 'People',
}

export default function RemindersPage() {
  const { items, loading, reload } = useReminderItems()
  const reminders = useCollection('reminders')
  const [editing, setEditing] = useState<'new' | string | null>(null)
  const [error, setError] = useState('')
  const nav = useNavigate()

  const refresh = async () => { await reload(); await reminders.reload(); notifyChanged() }

  const act = async (i: RItem) => {
    try { await i.action?.run(); await refresh() } catch (e) { setError(errMsg(e)) }
  }

  const t = today()
  const groups: { title: string; list: RItem[] }[] = [
    { title: 'Overdue', list: items.filter((i) => i.due < t) },
    { title: 'Today', list: items.filter((i) => i.due === t) },
    { title: 'Next 7 days', list: items.filter((i) => i.due > t && i.due <= addDays(t, 7)) },
    { title: 'Later', list: items.filter((i) => i.due > addDays(t, 7)) },
  ]

  const enableNotifications = async () => {
    if (!('Notification' in window)) { setError('This browser does not support notifications.'); return }
    const p = await Notification.requestPermission()
    if (p === 'granted') new Notification('Muninn', { body: 'Notifications are on. I will nudge you about what is due.' })
  }

  const editRec = editing && editing !== 'new' ? reminders.items.find((r) => r.id === editing) : undefined

  return (
    <div className="page">
      <PageHead title="Reminders" sub="One engine for everything due: reminders, tasks, bills, routines, documents and people.">
        <button className="btn" onClick={() => void enableNotifications()}><BellRing size={16} /> Notifications</button>
        <button className="btn primary" onClick={() => setEditing('new')}><Plus size={16} /> New reminder</button>
      </PageHead>
      {error && <div className="err" style={{ marginBottom: 10 }}>{error}</div>}
      {loading ? <div className="muted">Loading...</div> : items.length === 0 ? (
        <Empty>All clear. Nothing due in the next 60 days.</Empty>
      ) : (
        groups.filter((g) => g.list.length).map((g) => (
          <section key={g.title} style={{ marginBottom: 22 }}>
            <h2 style={{ marginBottom: 10 }} className={g.title === 'Overdue' ? 'due-over' : ''}>{g.title} <span className="faint small">({g.list.length})</span></h2>
            <div className="grid" style={{ gap: 8 }}>
              {g.list.map((i) => (
                <div key={i.key} className="card row" style={{ padding: '10px 14px', cursor: 'pointer' }}
                  onClick={() => (i.source === 'reminder' ? setEditing(i.rec.id) : nav(i.route))}>
                  <Badge label={SOURCE_LABEL[i.source]} tone={SOURCE_TONE[i.source]} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 550 }}>{i.title}</div>
                    {i.sub && <div className="small muted">{i.sub}</div>}
                  </div>
                  <div className={`small ${diffDays(i.due, t) < 0 ? 'due-over' : ''}`} style={{ textAlign: 'right' }}>
                    <div>{relDay(i.due)}</div>
                    <div className="faint">{fmtDate(i.due)}</div>
                  </div>
                  {i.action && (
                    <button className="btn sm" onClick={(e) => { e.stopPropagation(); void act(i) }}>{i.action.label}</button>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {editing && (
        <RecordModal
          title={editing === 'new' ? 'New reminder' : 'Edit reminder'}
          fields={FIELDS}
          initial={editRec}
          onSave={async (d) => {
            if (editRec) await reminders.update(editRec.id, d)
            else await reminders.create({ ...d, done: false })
            await refresh()
          }}
          onDelete={editRec ? async () => { await reminders.remove(editRec.id); await refresh() } : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
