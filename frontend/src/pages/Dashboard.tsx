import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useCollection } from '../data'
import { QuickInbox } from '../components/QuickInbox'
import { Badge, Progress, Stat } from '../components/ui'
import { useReminderItems } from '../reminders'
import { useAuth } from '../auth'
import { diffDays, fmtDate, money, relDay, today } from '../util'

const greeting = () => {
  const h = new Date().getHours()
  return h < 11 ? 'Good morning' : h < 15 ? 'Good afternoon' : h < 19 ? 'Good evening' : 'Good night'
}

export default function Dashboard() {
  const { email } = useAuth()
  const month = today().slice(0, 7)
  const tasks = useCollection('tasks', { filter: 'status != "done"', sort: 'due' })
  const habits = useCollection('habits', { filter: 'kind = "habit" && archived = false', sort: 'created' })
  const logs = useCollection('habit_logs', { filter: `date = "${today()}"` })
  const expenses = useCollection('expenses', { filter: `date >= "${month}-01" && date <= "${month}-31"` })
  const budgets = useCollection('budgets')
  const inbox = useCollection('inbox', { sort: '-created' })
  const goals = useCollection('goals', { filter: 'status = "active"' })
  const rem = useReminderItems()

  const t = today()
  const focus = tasks.items.filter((x) => (x.due && x.due <= t) || x.status === 'in_progress')
  const spent = expenses.items.filter((e) => e.type !== 'income').reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const budget = budgets.items.reduce((s, b) => s + (Number(b.amount) || 0), 0)
  const doneHabits = habits.items.filter((h) => logs.items.some((l) => l.habit === h.id)).length
  const overdue = tasks.items.filter((x) => x.due && x.due < t).length
  const name = email.split('@')[0]

  const toggleHabit = async (id: string) => {
    const l = logs.items.find((x) => x.habit === id)
    if (l) await logs.remove(l.id)
    else await logs.create({ habit: id, date: t })
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{greeting()}, {name}</h1>
          <div className="sub">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · <em>Hugin thinks, Muninn remembers.</em></div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Quick Inbox</div>
        <QuickInbox onAdded={() => void inbox.reload()} />
        {inbox.items.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {inbox.items.slice(0, 4).map((i) => (
              <div key={i.id} className="row small" style={{ padding: '4px 0', borderTop: '1px solid var(--border)' }}>
                <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.text}</span>
                <Badge value={i.kind} tone="violet" />
              </div>
            ))}
            <Link to="/inbox" className="small">{inbox.items.length} in inbox · sort them</Link>
          </div>
        )}
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Open tasks" value={tasks.items.length} sub={overdue ? `${overdue} overdue` : 'None overdue'} tone={overdue ? 'bad' : undefined} />
        <Stat label="Habits today" value={`${doneHabits}/${habits.items.length}`} sub={habits.items.length ? `${Math.round((doneHabits / habits.items.length) * 100)}% done` : 'No habits yet'} tone="good" />
        <Stat label="Spent this month" value={money(spent)} sub={budget ? `${Math.round((spent / budget) * 100)}% of ${money(budget)}` : 'No budget set'} tone="gold" />
        <Stat label="Active goals" value={goals.items.length} sub={goals.items.length ? `${Math.round(goals.items.reduce((s, g) => s + (Number(g.progress) || 0), 0) / goals.items.length)}% avg progress` : 'Set a direction'} />
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-title">Today's focus <span className="sp" /><Link to="/tasks" className="small">All tasks</Link></div>
          {focus.length === 0 ? <div className="muted">Nothing due or in progress.</div> : focus.slice(0, 8).map((x) => (
            <div key={x.id} className="row" style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <button className="dot" aria-label={`Complete ${x.title}`} style={{ margin: 0, width: 22, height: 22 }}
                onClick={() => void tasks.update(x.id, { status: 'done', done_at: t })} />
              <span className="grow">{x.title}</span>
              {x.due && <span className={`small ${diffDays(x.due, t) < 0 ? 'due-over' : 'muted'}`}>{relDay(x.due)}</span>}
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-title">Coming up <span className="sp" /><Link to="/reminders" className="small">All reminders</Link></div>
          {rem.items.length === 0 ? <div className="muted">All clear.</div> : rem.items.slice(0, 7).map((i) => (
            <div key={i.key} className="row" style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <span className="grow">{i.title}</span>
              <span className={`small ${diffDays(i.due, t) < 0 ? 'due-over' : 'muted'}`} title={fmtDate(i.due)}>{relDay(i.due)}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-title">Habits <span className="sp" /><Link to="/habits" className="small">Open</Link></div>
          {habits.items.length === 0 ? <div className="muted">No habits yet.</div> : (
            <>
              <Progress value={habits.items.length ? (doneHabits / habits.items.length) * 100 : 0} />
              <div style={{ marginTop: 10 }}>
                {habits.items.map((h) => {
                  const on = logs.items.some((l) => l.habit === h.id)
                  return (
                    <div key={h.id} className="row" style={{ padding: '5px 0' }}>
                      <button className={`dot${on ? ' on' : ''}`} style={{ margin: 0, width: 24, height: 24 }} aria-pressed={on} aria-label={h.name} onClick={() => void toggleHabit(h.id)}>
                        {on && <Check size={14} strokeWidth={3} />}
                      </button>
                      <span className={on ? 'muted' : ''}>{h.name}</span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <div className="card">
          <div className="card-title">Budget this month</div>
          {budget ? (
            <>
              <div className="row small"><span className="grow">{money(spent)} spent</span><span className="muted">{money(budget)}</span></div>
              <Progress value={(spent / budget) * 100} tone={spent > budget ? 'over' : spent > budget * 0.8 ? 'warn' : undefined} />
              <div className="small muted" style={{ marginTop: 6 }}>{spent > budget ? `${money(spent - budget)} over budget` : `${money(budget - spent)} left`}</div>
            </>
          ) : <div className="muted">Set category budgets in <Link to="/expenses">Expenses</Link>.</div>}
        </div>
      </div>
    </div>
  )
}
