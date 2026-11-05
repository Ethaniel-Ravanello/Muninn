import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCollection } from '../data'
import { Empty, PageHead, Progress, Stat } from '../components/ui'
import { addDays, addMonths, diffDays, errMsg, fmtDate, money, monthLabel, today, weekKey, weekStart } from '../util'

type Period = 'week' | 'month'

function rangeFor(period: Period, offset: number) {
  if (period === 'week') {
    const start = addDays(weekStart(today()), offset * 7)
    const end = addDays(start, 6)
    return { start, end, key: weekKey(start), label: `Week ${weekKey(start).split('-W')[1]} · ${fmtDate(start)} - ${fmtDate(end)}` }
  }
  const start = addMonths(`${today().slice(0, 7)}-01`, offset)
  const end = addDays(addMonths(start, 1), -1)
  return { start, end, key: start.slice(0, 7), label: monthLabel(start.slice(0, 7)) }
}

export default function ReviewPage() {
  const [period, setPeriod] = useState<Period>('week')
  const [offset, setOffset] = useState(0)
  const r = useMemo(() => rangeFor(period, offset), [period, offset])
  const inRange = (field: string) => `${field} >= "${r.start}" && ${field} <= "${r.end}"`

  const doneTasks = useCollection('tasks', { filter: inRange('done_at') })
  const expenses = useCollection('expenses', { filter: inRange('date') })
  const logs = useCollection('habit_logs', { filter: inRange('date') })
  const habits = useCollection('habits', { filter: 'kind = "habit" && archived = false' })
  const journal = useCollection('journal', { filter: inRange('date') })
  const media = useCollection('media', { filter: inRange('done_at') })
  const reviews = useCollection('reviews', { sort: '-period_key' })

  const existing = reviews.items.find((x) => x.period === period && x.period_key === r.key)
  const [form, setForm] = useState({ wins: '', lessons: '', next_focus: '' })
  const [saved, setSaved] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    setForm({ wins: existing?.wins ?? '', lessons: existing?.lessons ?? '', next_focus: existing?.next_focus ?? '' })
    setSaved('')
  }, [existing?.id, existing?.updated, r.key, period])

  const spent = expenses.items.filter((e) => e.type !== 'income').reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const income = expenses.items.filter((e) => e.type === 'income').reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const elapsedDays = Math.max(1, Math.min(diffDays(r.end, r.start), diffDays(today(), r.start)) + 1)
  const possible = habits.items.length * elapsedDays
  const habitPct = possible ? Math.min(100, Math.round((logs.items.filter((l) => habits.items.some((h) => h.id === l.habit)).length / possible) * 100)) : 0
  const moods = journal.items.filter((j) => j.mood > 0).map((j) => j.mood as number)
  const avgMood = moods.length ? (moods.reduce((a, b) => a + b, 0) / moods.length).toFixed(1) : '-'

  const save = async () => {
    try {
      if (existing) await reviews.update(existing.id, form)
      else await reviews.create({ period, period_key: r.key, ...form })
      setSaved('Saved')
      setErr('')
    } catch (e) { setErr(errMsg(e)) }
  }

  return (
    <div className="page">
      <PageHead title="Review" sub="Look back across every module, then write down what you learned.">
        <div className="tabs">
          <button className={period === 'week' ? 'on' : ''} onClick={() => { setPeriod('week'); setOffset(0) }}>Weekly</button>
          <button className={period === 'month' ? 'on' : ''} onClick={() => { setPeriod('month'); setOffset(0) }}>Monthly</button>
        </div>
      </PageHead>

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn" aria-label="Previous" onClick={() => setOffset(offset - 1)}><ChevronLeft size={16} /></button>
        <h2 style={{ minWidth: 260, textAlign: 'center' }}>{r.label}</h2>
        <button className="btn" aria-label="Next" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}><ChevronRight size={16} /></button>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Tasks completed" value={doneTasks.items.length} tone="good" />
        <Stat label="Habit completion" value={`${habitPct}%`} sub={`${logs.items.length} check-ins`} />
        <Stat label="Spent" value={money(spent)} sub={income ? `Income ${money(income)}` : undefined} tone="gold" />
        <Stat label="Journal" value={journal.items.length} sub={`Avg mood ${avgMood}`} />
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start', marginBottom: 16 }}>
        <div className="card">
          <div className="card-title">Finished</div>
          {doneTasks.items.length === 0 && media.items.length === 0 ? <div className="muted">Nothing marked done in this period.</div> : (
            <>
              {doneTasks.items.slice(0, 12).map((t) => <div key={t.id} className="small" style={{ padding: '3px 0' }}>✓ {t.title}</div>)}
              {media.items.map((m) => <div key={m.id} className="small" style={{ padding: '3px 0' }}>🎬 {m.title}{m.rating ? ` · ${m.rating}★` : ''}</div>)}
            </>
          )}
        </div>
        <div className="card">
          <div className="card-title">Habits</div>
          {habits.items.length === 0 ? <div className="muted">No habits tracked.</div> : habits.items.map((h) => {
            const n = logs.items.filter((l) => l.habit === h.id).length
            return (
              <div key={h.id} style={{ marginBottom: 8 }}>
                <div className="row small"><span className="grow">{h.name}</span><span className="muted">{n}/{elapsedDays}</span></div>
                <Progress value={(n / elapsedDays) * 100} />
              </div>
            )
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Reflection</div>
        <div className="grid" style={{ gap: 12 }}>
          <label className="f"><span className="lbl">What went well?</span><textarea value={form.wins} onChange={(e) => setForm({ ...form, wins: e.target.value })} /></label>
          <label className="f"><span className="lbl">What did I learn / what to change?</span><textarea value={form.lessons} onChange={(e) => setForm({ ...form, lessons: e.target.value })} /></label>
          <label className="f"><span className="lbl">Focus for next {period}</span><textarea value={form.next_focus} onChange={(e) => setForm({ ...form, next_focus: e.target.value })} /></label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => void save()}>Save review</button>
          {saved && <span className="small" style={{ color: 'var(--green)' }}>{saved}</span>}
          {err && <span className="err">{err}</span>}
        </div>
      </div>

      <h2 style={{ margin: '24px 0 10px' }}>Past reviews</h2>
      {reviews.items.length === 0 ? <Empty>No saved reviews yet.</Empty> : (
        <div className="grid auto">
          {reviews.items.slice(0, 12).map((x) => (
            <div key={x.id} className="card">
              <div className="card-title">{x.period_key} <span className="faint small">{x.period}</span></div>
              {x.wins && <div className="small"><span className="faint">Wins: </span>{x.wins}</div>}
              {x.lessons && <div className="small"><span className="faint">Lessons: </span>{x.lessons}</div>}
              {x.next_focus && <div className="small"><span className="faint">Next: </span>{x.next_focus}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
