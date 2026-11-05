import { useMemo, useState } from 'react'
import { Check, Flame, Plus } from 'lucide-react'
import { useCollection } from '../data'
import { pb, uidOwner, type Rec } from '../pb'
import { RecordModal } from '../components/RecordModal'
import { Badge, Empty, PageHead, Progress } from '../components/ui'
import { opts, type Field } from '../types'
import { addDays, diffDays, errMsg, fmtDate, parseYmd, relDay, today, weekStart } from '../util'

type Tab = 'habit' | 'maintenance'

function fieldsFor(kind: Tab): Field[] {
  const base: Field[] = [{ name: 'name', label: kind === 'habit' ? 'Habit' : 'Routine / maintenance', type: 'text', required: true, full: true,
    placeholder: kind === 'habit' ? 'Workout, read 20 pages' : 'Motorbike service, laundry, change filter' }]
  if (kind === 'habit') {
    base.push(
      { name: 'frequency', label: 'Frequency', type: 'select', options: opts('daily', 'weekly'), default: 'daily', required: true },
      { name: 'target_per_week', label: 'Target days per week', type: 'number', placeholder: '7 for every day' },
    )
  } else {
    base.push(
      { name: 'interval_days', label: 'Repeat every (days)', type: 'number', required: true, placeholder: 'e.g. 90' },
      { name: 'last_done', label: 'Last done', type: 'date' },
    )
  }
  base.push(
    { name: 'archived', label: 'Archived', type: 'checkbox', placeholder: 'Archive (hide from the list)' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  )
  return base
}

export default function HabitsPage() {
  const habits = useCollection('habits', { sort: 'created' })
  const since = addDays(today(), -120)
  const logs = useCollection('habit_logs', { filter: `date >= "${since}"` })
  const [tab, setTab] = useState<Tab>('habit')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Rec | 'new' | null>(null)
  const [err, setErr] = useState('')

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today(), i - 6)), [])
  const logSet = useMemo(() => {
    const m = new Map<string, Rec>()
    logs.items.forEach((l) => m.set(`${l.habit}|${l.date}`, l))
    return m
  }, [logs.items])

  const list = habits.items.filter((h) => (h.kind || 'habit') === tab && (showArchived || !h.archived))
  const archivedCount = habits.items.filter((h) => (h.kind || 'habit') === tab && h.archived).length

  const toggle = async (h: Rec, date: string) => {
    const key = `${h.id}|${date}`
    const existing = logSet.get(key)
    try {
      if (existing) await logs.remove(existing.id)
      else await logs.create({ habit: h.id, date })
      setErr('')
    } catch (e) { setErr(errMsg(e)) }
  }

  const streak = (h: Rec) => {
    let d = today()
    if (!logSet.has(`${h.id}|${d}`)) d = addDays(d, -1)
    let n = 0
    while (logSet.has(`${h.id}|${d}`) && n < 400) { n++; d = addDays(d, -1) }
    return n
  }

  const weekCount = (h: Rec) => {
    const start = weekStart(today())
    let n = 0
    for (let i = 0; i < 7; i++) if (logSet.has(`${h.id}|${addDays(start, i)}`)) n++
    return n
  }

  const markDone = async (h: Rec) => {
    try {
      await habits.update(h.id, { last_done: today() })
      await pb.collection('habit_logs').create({ user: uidOwner(), habit: h.id, date: today() })
      await logs.reload()
    } catch (e) { setErr(errMsg(e)) }
  }

  const todayDone = habits.items.filter((h) => (h.kind || 'habit') === 'habit' && !h.archived && logSet.has(`${h.id}|${today()}`)).length
  const todayTotal = habits.items.filter((h) => (h.kind || 'habit') === 'habit' && !h.archived).length

  return (
    <div className="page">
      <PageHead title="Habits & Routines" sub={tab === 'habit' ? `Today: ${todayDone}/${todayTotal} done` : 'Periodic upkeep with a next-due date.'}>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'habit'} className={tab === 'habit' ? 'on' : ''} onClick={() => setTab('habit')}>Habits</button>
          <button role="tab" aria-selected={tab === 'maintenance'} className={tab === 'maintenance' ? 'on' : ''} onClick={() => setTab('maintenance')}>Maintenance</button>
        </div>
        <button className="btn primary" onClick={() => setEditing('new')}><Plus size={16} /> {tab === 'habit' ? 'New habit' : 'New routine'}</button>
      </PageHead>

      {err && <div className="err" style={{ marginBottom: 10 }}>{err}</div>}
      {habits.loading ? <div className="muted">Loading...</div> : list.length === 0 ? (
        <Empty>{tab === 'habit' ? 'No habits yet. Start with one small daily thing.' : 'No routines yet. Add things like motorbike service or laundry.'}</Empty>
      ) : tab === 'habit' ? (
        <div className="card">
          <div className="habit-row" style={{ borderBottom: '1px solid var(--border-2)' }}>
            <span />
            {days.map((d) => (
              <div key={d} className="dh">{parseYmd(d).toLocaleDateString('en-GB', { weekday: 'narrow' })}<br />{parseYmd(d).getDate()}</div>
            ))}
            <span className="hr-extra" />
          </div>
          {list.map((h) => {
            const s = streak(h)
            const wc = weekCount(h)
            const target = h.frequency === 'daily' ? 7 : Number(h.target_per_week) || 3
            return (
              <div key={h.id} className="habit-row" style={h.archived ? { opacity: 0.5 } : undefined}>
                <button className="btn ghost" style={{ justifyContent: 'flex-start', padding: '4px 6px', textAlign: 'left' }} onClick={() => setEditing(h)}>{h.name}</button>
                {days.map((d) => {
                  const on = logSet.has(`${h.id}|${d}`)
                  return (
                    <button key={d} className={`dot${on ? ' on' : ''}${d === today() ? ' today' : ''}`} aria-pressed={on}
                      aria-label={`${h.name} on ${fmtDate(d)}`} onClick={() => void toggle(h, d)}>
                      {on && <Check size={15} strokeWidth={3} />}
                    </button>
                  )
                })}
                <div className="hr-extra">
                  <div className="row small" style={{ justifyContent: 'space-between' }}>
                    <span className="muted">{wc}/{target} wk</span>
                    {s > 0 && <span className="pin row" style={{ gap: 2 }}><Flame size={13} />{s}</span>}
                  </div>
                  <Progress value={(wc / target) * 100} />
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="grid auto">
          {list.map((h) => {
            const interval = Number(h.interval_days) || 0
            const due = interval ? (h.last_done ? addDays(h.last_done, interval) : today()) : ''
            const left = due ? diffDays(due, today()) : 0
            return (
              <div key={h.id} className="card hover" onClick={() => setEditing(h)} style={h.archived ? { opacity: 0.5 } : undefined}>
                <div className="row"><h3 className="grow">{h.name}</h3>
                  {due && <Badge label={left < 0 ? 'Overdue' : left <= 7 ? 'Due soon' : 'OK'} tone={left < 0 ? 'red' : left <= 7 ? 'amber' : 'green'} />}
                </div>
                <div className="small muted" style={{ marginTop: 6 }}>Every {interval} days</div>
                <div className="small" style={{ marginTop: 2 }}>
                  Last: {h.last_done ? fmtDate(h.last_done) : 'never'}{due ? ` · Next: ${fmtDate(due)} (${relDay(due)})` : ''}
                </div>
                <div className="row" style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn sm" onClick={() => void markDone(h)}><Check size={14} /> Done today</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {archivedCount > 0 && (
        <div style={{ marginTop: 14 }}>
          <button className="btn ghost sm" onClick={() => setShowArchived((v) => !v)}>{showArchived ? 'Hide' : 'Show'} archived ({archivedCount})</button>
        </div>
      )}

      {editing && (
        <RecordModal
          title={editing === 'new' ? (tab === 'habit' ? 'New habit' : 'New routine') : 'Edit'}
          fields={fieldsFor(editing === 'new' ? tab : ((editing.kind || 'habit') as Tab))}
          initial={editing === 'new' ? { kind: tab } : editing}
          onSave={async (d) => {
            const data = { ...d, kind: editing === 'new' ? tab : editing.kind || 'habit' }
            if (editing === 'new') await habits.create(data)
            else await habits.update(editing.id, data)
          }}
          onDelete={editing === 'new' ? undefined : () => habits.remove(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
