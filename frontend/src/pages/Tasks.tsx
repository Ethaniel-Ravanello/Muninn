import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Search, Trash2 } from 'lucide-react'
import { useCollection } from '../data'
import type { Rec } from '../pb'
import { RecordModal } from '../components/RecordModal'
import { Badge, DateText, PageHead, Tags } from '../components/ui'
import { opts, type Field } from '../types'
import { diffDays, errMsg, today, uid } from '../util'

interface Sub { id: string; title: string; done: boolean }
const COLUMNS = [
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
]
const PRI_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, '': 3 }

const subsOf = (t: Rec): Sub[] => (Array.isArray(t.subtasks) ? (t.subtasks as Sub[]) : [])

export default function TasksPage() {
  const { items, loading, error, create, update, remove } = useCollection('tasks', { sort: '-created' })
  const goals = useCollection('goals')
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [project, setProject] = useState('')
  const [priority, setPriority] = useState('')
  const [editing, setEditing] = useState<Rec | 'new' | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState('')
  const [quick, setQuick] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { const x = params.get('q'); if (x !== null) setQ(x) }, [params])

  const projects = useMemo(() => [...new Set(items.map((t) => String(t.project || '')).filter(Boolean))].sort(), [items])
  const goalName = (id: string) => goals.items.find((g) => g.id === id)?.title as string | undefined

  const fields: Field[] = [
    { name: 'title', label: 'Task', type: 'text', required: true, full: true },
    { name: 'status', label: 'Status', type: 'select', options: COLUMNS, default: 'todo', required: true },
    { name: 'priority', label: 'Priority', type: 'select', options: opts('low', 'medium', 'high'), default: 'medium', required: true },
    { name: 'due', label: 'Due date', type: 'date' },
    { name: 'project', label: 'Project', type: 'text', suggest: projects },
    { name: 'goal', label: 'Goal', type: 'select', options: goals.items.map((g) => ({ value: g.id, label: g.title })) },
    { name: 'tags', label: 'Tags', type: 'tags' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ]

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter((t) => {
      if (project && t.project !== project) return false
      if (priority && t.priority !== priority) return false
      if (!needle) return true
      if (needle.startsWith('#')) return String(t.tags ?? '').toLowerCase().split(',').map((s) => s.trim()).includes(needle.slice(1))
      return [t.title, t.notes, t.project, t.tags].some((f) => String(f ?? '').toLowerCase().includes(needle))
    })
  }, [items, q, project, priority])

  const inCol = (status: string) =>
    rows.filter((t) => (t.status || 'todo') === status).sort((a, b) =>
      (PRI_ORDER[a.priority || ''] - PRI_ORDER[b.priority || '']) || String(a.due || '9').localeCompare(String(b.due || '9')))

  const move = async (t: Rec, status: string) => {
    if ((t.status || 'todo') === status) return
    try {
      await update(t.id, { status, done_at: status === 'done' ? today() : '' })
    } catch (e) { setErr(errMsg(e)) }
  }

  const step = (t: Rec, dir: -1 | 1) => {
    const i = COLUMNS.findIndex((c) => c.value === (t.status || 'todo'))
    const next = COLUMNS[i + dir]
    if (next) void move(t, next.value)
  }

  const quickAdd = async () => {
    const title = quick.trim()
    if (!title) return
    setQuick('')
    try { await create({ title, status: 'todo', priority: 'medium' }) } catch (e) { setErr(errMsg(e)) }
  }

  const save = async (d: Record<string, unknown>, id?: string) => {
    const data = { ...d, done_at: d.status === 'done' ? (editing !== 'new' && editing?.done_at) || today() : '' }
    if (id) await update(id, data)
    else await create(data)
  }

  return (
    <div className="page">
      <PageHead title="Tasks" sub="Execution list. Drag cards between columns, or use the arrows on mobile.">
        <button className="btn primary" onClick={() => setEditing('new')}><Plus size={16} /> New task</button>
      </PageHead>

      <div className="row wrap" style={{ marginBottom: 14, gap: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
          <Search size={15} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--faint)' }} />
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter tasks" style={{ paddingLeft: 32 }} aria-label="Filter tasks" />
        </div>
        <select value={project} onChange={(e) => setProject(e.target.value)} style={{ width: 'auto' }} aria-label="Project">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="chips">
          {['', 'high', 'medium', 'low'].map((p) => (
            <button key={p || 'all'} className={`chip${priority === p ? ' on' : ''}`} onClick={() => setPriority(p)}>{p ? p[0].toUpperCase() + p.slice(1) : 'Any priority'}</button>
          ))}
        </div>
      </div>

      {(error || err) && <div className="err" style={{ marginBottom: 10 }}>{error || err}</div>}
      {loading ? <div className="muted">Loading...</div> : (
        <div className="kanban">
          {COLUMNS.map((c) => {
            const list = inCol(c.value)
            return (
              <div key={c.value} className={`col${overCol === c.value ? ' over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOverCol(c.value) }}
                onDragLeave={() => setOverCol('')}
                onDrop={(e) => {
                  e.preventDefault(); setOverCol('')
                  const t = items.find((x) => x.id === dragId)
                  if (t) void move(t, c.value)
                  setDragId(null)
                }}>
                <div className="col-head">{c.label}<span className="n">{list.length}</span></div>
                {c.value === 'todo' && (
                  <input type="text" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="+ Quick add, press Enter"
                    onKeyDown={(e) => { if (e.key === 'Enter') void quickAdd() }} style={{ marginBottom: 8 }} aria-label="Quick add task" />
                )}
                {list.map((t) => {
                  const subs = subsOf(t)
                  const sdone = subs.filter((s) => s.done).length
                  const overdue = t.due && t.status !== 'done' && diffDays(t.due, today()) < 0
                  return (
                    <div key={t.id} draggable className={`tcard${t.status === 'done' ? ' done' : ''}${dragId === t.id ? ' dragging' : ''}`}
                      onDragStart={() => setDragId(t.id)} onDragEnd={() => { setDragId(null); setOverCol('') }}
                      onClick={() => setEditing(t)}>
                      <div className="row" style={{ alignItems: 'flex-start' }}>
                        <span className={`pri ${t.priority || 'low'}`} style={{ marginTop: 7 }} title={`Priority: ${t.priority || 'none'}`} />
                        <div className="t grow">{t.title}</div>
                      </div>
                      <div className="row wrap" style={{ gap: 6 }}>
                        {t.due && <span className={`small ${overdue ? 'due-over' : ''}`}>Due <DateText value={t.due} /></span>}
                        {t.project && <Badge value="" label={t.project} tone="blue" />}
                        {t.goal && goalName(t.goal) && <Badge value="" label={`🎯 ${goalName(t.goal)}`} tone="gold" />}
                        {subs.length > 0 && <span className="small muted">☑ {sdone}/{subs.length}</span>}
                        <Tags value={t.tags} />
                      </div>
                      <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                        <button className="icon-btn" aria-label="Move left" disabled={c.value === 'todo'} onClick={() => step(t, -1)}><ChevronLeft size={16} /></button>
                        <button className="icon-btn" aria-label="Move right" disabled={c.value === 'done'} onClick={() => step(t, 1)}><ChevronRight size={16} /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <RecordModal
          wide
          title={editing === 'new' ? 'New task' : 'Edit task'}
          fields={fields}
          initial={editing === 'new' ? { subtasks: [] } : { ...editing, subtasks: subsOf(editing) }}
          extraKeys={['subtasks']}
          onSave={(d) => save(d, editing === 'new' ? undefined : editing.id)}
          onDelete={editing === 'new' ? undefined : () => remove(editing.id)}
          onClose={() => setEditing(null)}
          extra={(data, set) => <SubtaskEditor value={(data.subtasks as Sub[]) ?? []} onChange={(subtasks) => set({ subtasks })} />}
        />
      )}
    </div>
  )
}

function SubtaskEditor({ value, onChange }: { value: Sub[]; onChange: (v: Sub[]) => void }) {
  const [text, setText] = useState('')
  const add = () => {
    const title = text.trim()
    if (!title) return
    onChange([...value, { id: uid(), title, done: false }])
    setText('')
  }
  return (
    <div>
      <div className="lbl" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 550, marginBottom: 6 }}>
        Sub-tasks {value.length > 0 && `(${value.filter((s) => s.done).length}/${value.length})`}
      </div>
      {value.map((s) => (
        <div key={s.id} className={`sub-item${s.done ? ' done' : ''}`}>
          <input type="checkbox" checked={s.done} aria-label={s.title} onChange={() => onChange(value.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))} />
          <span className="grow">{s.title}</span>
          <button type="button" className="icon-btn" aria-label="Remove sub-task" onClick={() => onChange(value.filter((x) => x.id !== s.id))}><Trash2 size={14} /></button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 6 }}>
        <input type="text" value={text} placeholder="Add a sub-task" aria-label="New sub-task" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <button type="button" className="btn" onClick={add}>Add</button>
      </div>
    </div>
  )
}
