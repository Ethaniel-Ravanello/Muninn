import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useCollection } from '../data'
import type { Rec } from '../pb'
import { RecordModal } from '../components/RecordModal'
import { Badge, PageHead } from '../components/ui'
import type { Field } from '../types'
import { addDays, addMonths, fmtDate, monthLabel, parseYmd, today, weekStart } from '../util'

type Kind = 'event' | 'task' | 'bill' | 'reminder' | 'doc'
interface Entry { kind: Kind; label: string; time?: string; rec: Rec; route: string }

const EVENT_FIELDS: Field[] = [
  { name: 'title', label: 'Event', type: 'text', required: true, full: true },
  { name: 'date', label: 'Date', type: 'date', required: true },
  { name: 'end_date', label: 'End date (optional)', type: 'date' },
  { name: 'time', label: 'Time', type: 'time' },
  { name: 'location', label: 'Location', type: 'text' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
]

const KIND_LABEL: Record<Kind, string> = { event: 'Event', task: 'Task due', bill: 'Bill', reminder: 'Reminder', doc: 'Expires' }
const KIND_TONE: Record<Kind, string> = { event: 'blue', task: 'violet', bill: 'gold', reminder: 'green', doc: 'red' }

export default function CalendarPage() {
  const events = useCollection('events')
  const tasks = useCollection('tasks', { filter: 'due != "" && status != "done"' })
  const subs = useCollection('subscriptions', { filter: 'active = true && next_due != ""' })
  const reminders = useCollection('reminders', { filter: 'done = false' })
  const docs = useCollection('documents', { filter: 'expires != ""' })
  const [month, setMonth] = useState(today().slice(0, 7) + '-01')
  const [selected, setSelected] = useState(today())
  const [editing, setEditing] = useState<Rec | { date: string } | null>(null)
  const nav = useNavigate()

  const byDay = useMemo(() => {
    const map: Record<string, Entry[]> = {}
    const add = (d: string, e: Entry) => { (map[d] ??= []).push(e) }
    events.items.forEach((e) => {
      const start = String(e.date)
      const end = e.end_date && e.end_date >= start ? String(e.end_date) : start
      let d = start
      for (let i = 0; i < 60 && d <= end; i++) {
        add(d, { kind: 'event', label: e.title, time: d === start ? e.time : undefined, rec: e, route: '/calendar' })
        d = addDays(d, 1)
      }
    })
    tasks.items.forEach((t) => add(t.due, { kind: 'task', label: t.title, rec: t, route: '/tasks' }))
    subs.items.forEach((s) => add(s.next_due, { kind: 'bill', label: s.name, rec: s, route: '/subscriptions' }))
    reminders.items.forEach((r) => add(r.due, { kind: 'reminder', label: r.title, rec: r, route: '/reminders' }))
    docs.items.forEach((d) => add(d.expires, { kind: 'doc', label: `${d.title} expires`, rec: d, route: '/vault' }))
    Object.values(map).forEach((l) => l.sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99'))))
    return map
  }, [events.items, tasks.items, subs.items, reminders.items, docs.items])

  const cells = useMemo(() => {
    const start = weekStart(month)
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [month])

  const monthNum = parseYmd(month).getMonth()
  const agenda = byDay[selected] ?? []
  const editingRec = editing && 'id' in editing ? (editing as Rec) : undefined

  return (
    <div className="page">
      <PageHead title="Calendar" sub="Schedule only. Task execution lives in Tasks, but due dates show up here.">
        <button className="btn primary" onClick={() => setEditing({ date: selected })}><Plus size={16} /> New event</button>
      </PageHead>

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft size={16} /></button>
        <h2 style={{ minWidth: 170, textAlign: 'center' }}>{monthLabel(month.slice(0, 7))}</h2>
        <button className="btn" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={16} /></button>
        <button className="btn ghost" onClick={() => { setMonth(today().slice(0, 7) + '-01'); setSelected(today()) }}>Today</button>
      </div>

      <div className="cal">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="dow">{d}</div>)}
        {cells.map((d) => {
          const list = byDay[d] ?? []
          const out = parseYmd(d).getMonth() !== monthNum
          return (
            <div key={d} className={`day${out ? ' out' : ''}${d === today() ? ' today' : ''}${d === selected ? ' sel' : ''}`}
              onClick={() => setSelected(d)} onDoubleClick={() => setEditing({ date: d })}>
              <span className="num">{parseYmd(d).getDate()}</span>
              {list.slice(0, 3).map((e, i) => <span key={i} className={`ev ${e.kind}`}>{e.time ? `${e.time} ` : ''}{e.label}</span>)}
              {list.length > 3 && <span className="more">+{list.length - 3} more</span>}
            </div>
          )
        })}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">
          {fmtDate(selected)}
          <span className="sp" />
          <button className="btn sm" onClick={() => setEditing({ date: selected })}><Plus size={14} /> Event</button>
        </div>
        {agenda.length === 0 ? <div className="muted">Nothing scheduled.</div> : agenda.map((e, i) => (
          <div key={i} className="row" style={{ padding: '7px 0', borderTop: i ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}
            onClick={() => (e.kind === 'event' ? setEditing(e.rec) : nav(e.route))}>
            <Badge label={KIND_LABEL[e.kind]} tone={KIND_TONE[e.kind]} />
            <span className="grow">{e.label}</span>
            {e.time && <span className="muted small">{e.time}</span>}
            {e.kind === 'event' && e.rec.location ? <span className="faint small">{e.rec.location}</span> : null}
          </div>
        ))}
        <div className="small faint" style={{ marginTop: 8 }}>Tip: double-click a day to add an event.</div>
      </div>

      {editing && (
        <RecordModal
          title={editingRec ? 'Edit event' : 'New event'}
          fields={EVENT_FIELDS}
          initial={editingRec ?? editing}
          onSave={async (d) => {
            if (editingRec) await events.update(editingRec.id, d)
            else await events.create(d)
          }}
          onDelete={editingRec ? () => events.remove(editingRec.id) : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
