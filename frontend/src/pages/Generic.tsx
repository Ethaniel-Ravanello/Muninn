import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Pin, Plus, Search } from 'lucide-react'
import { useCollection } from '../data'
import { pb, type Rec } from '../pb'
import type { Module } from '../modules'
import { RecordModal } from '../components/RecordModal'
import { Badge, Empty, PageHead, Progress, Stat, renderValue, Stars } from '../components/ui'
import type { Field } from '../types'
import { errMsg, fmtDate, isUrl } from '../util'

const PLAIN_LABEL: Field['type'][] = ['text', 'date', 'number', 'money']

export default function GenericPage({ m }: { m: Module }) {
  const { items, loading, error, create, update, remove, reload } = useCollection(m.collection, { sort: m.sort })
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Rec | 'new' | null>(null)
  const [related, setRelated] = useState<Rec[]>([])
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    const incoming = params.get('q')
    if (incoming !== null) setQ(incoming)
  }, [params])

  useEffect(() => {
    if (!m.related) return
    pb.collection(m.related.collection).getFullList<Rec>().then(setRelated).catch(() => setRelated([]))
  }, [m.related])

  const fieldByName = useMemo(() => Object.fromEntries(m.fields.map((f) => [f.name, f])), [m.fields])

  const chipValues = (name: string): { value: string; label: string }[] => {
    const f = fieldByName[name]
    if (f?.options) return f.options
    const set = new Set(items.map((r) => String(r[name] ?? '')).filter(Boolean))
    return [...set].sort().map((v) => ({ value: v, label: v }))
  }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let r = items.filter((x) => {
      for (const [k, v] of Object.entries(filters)) if (v && String(x[k] ?? '') !== v) return false
      if (!needle) return true
      if (needle.startsWith('#')) return String(x.tags ?? '').toLowerCase().split(',').map((s) => s.trim()).includes(needle.slice(1))
      return m.searchFields.some((f) => String(x[f] ?? '').toLowerCase().includes(needle))
    })
    if (fieldByName.pinned) r = [...r].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
    return r
  }, [items, q, filters, m.searchFields, fieldByName])

  const titleOf = (r: Rec) => (m.titleOf ? m.titleOf(r) : String(r[m.titleField] ?? ''))

  // modules with a detail page (Notes) open it instead of the popup form
  const open = (r: Rec) => (m.detailRoute ? nav(`/${m.route}/${r.id}`) : setEditing(r))
  const startNew = async () => {
    if (!m.detailRoute) { setEditing('new'); return }
    try {
      const rec = await create({ title: 'Untitled', content: '' })
      nav(`/${m.route}/${rec.id}`)
    } catch (e) { setActionError(errMsg(e)) }
  }

  const save = async (data: Record<string, unknown>, id?: string) => {
    const out = m.beforeSave ? m.beforeSave(data) : data
    if (id) await update(id, out)
    else await create(out)
  }

  const cycle = async (r: Rec) => {
    const f = fieldByName[m.cycleField ?? '']
    if (!f?.options) return
    const i = f.options.findIndex((o) => o.value === r[f.name])
    const next = f.options[(i + 1) % f.options.length].value
    const patch = m.beforeSave ? m.beforeSave({ ...r, [f.name]: next }) : { [f.name]: next }
    try { await update(r.id, { [f.name]: next, ...(patch.done_at ? { done_at: patch.done_at } : {}) }) } catch (e) { setActionError(errMsg(e)) }
  }

  const runAction = async (r: Rec, a: NonNullable<Module['actions']>[number]) => {
    try {
      const patch = await a.run(r)
      if (patch) await update(r.id, patch)
      else await reload()
      setActionError('')
      await reload()
    } catch (e) {
      setActionError(errMsg(e))
    }
  }

  const relatedInfo = (r: Rec) => {
    if (!m.related) return null
    const list = related.filter((x) => x[m.related!.field] === r.id)
    if (!list.length) return null
    const done = list.filter(m.related.doneWhen).length
    return (
      <div style={{ marginTop: 8 }}>
        <div className="small muted">{done}/{list.length} {m.related.label}</div>
        <Progress value={(done / list.length) * 100} />
      </div>
    )
  }

  const listFields = m.fields.filter((f) => !f.hideInList && f.name !== m.titleField)
  const clearQ = () => { setQ(''); if (params.has('q')) setParams({}, { replace: true }) }

  return (
    <div className="page">
      <PageHead title={m.title} sub={m.sub}>
        <button className="btn primary" onClick={() => void startNew()}><Plus size={16} /> {m.newLabel}</button>
      </PageHead>

      {m.summary && items.length > 0 && (
        <div className="grid cols-4" style={{ marginBottom: 16 }}>
          {m.summary(items).map((s) => <Stat key={s.label} label={s.label} value={s.value} tone={s.tone} sub={s.sub} />)}
        </div>
      )}

      <div className="row wrap" style={{ marginBottom: 14, gap: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 360 }}>
          <Search size={15} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--faint)' }} />
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${m.title.toLowerCase()}`} style={{ paddingLeft: 32 }} aria-label="Filter" />
        </div>
        {q && <button className="btn ghost sm" onClick={clearQ}>Clear</button>}
        {(m.filterFields ?? []).map((name) => {
          const vals = chipValues(name)
          if (vals.length < 1) return null
          return (
            <div className="chips" key={name}>
              <button className={`chip${!filters[name] ? ' on' : ''}`} onClick={() => setFilters((f) => ({ ...f, [name]: '' }))}>All</button>
              {vals.map((o) => (
                <button key={o.value} className={`chip${filters[name] === o.value ? ' on' : ''}`}
                  onClick={() => setFilters((f) => ({ ...f, [name]: f[name] === o.value ? '' : o.value }))}>{o.label}</button>
              ))}
            </div>
          )
        })}
      </div>

      {(error || actionError) && <div className="err" style={{ marginBottom: 10 }}>{error || actionError}</div>}
      {loading ? <div className="muted">Loading...</div> : rows.length === 0 ? (
        <Empty>{items.length ? 'Nothing matches your filter.' : `Nothing here yet. Use "${m.newLabel}" to add the first one.`}</Empty>
      ) : m.view === 'table' ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[m.fields.find((f) => f.name === m.titleField), ...listFields].filter((f): f is Field => !!f && f.type !== 'textarea').map((f) => <th key={f.name}>{f.label}</th>)}
                {m.actions && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => open(r)}>
                  {[m.fields.find((f) => f.name === m.titleField), ...listFields].filter((f): f is Field => !!f && f.type !== 'textarea').map((f) => (
                    <td key={f.name} style={f.name === m.titleField ? { fontWeight: 600 } : undefined}>
                      {f.name === m.titleField && f.type === 'select' ? renderValue(f, r[f.name])
                        : f.name === m.titleField ? titleOf(r)
                        : f.name === m.cycleField ? <Badge value={r[f.name]} onClick={() => void cycle(r)} />
                        : renderValue(f, r[f.name])}
                    </td>
                  ))}
                  {m.actions && (
                    <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                      {m.actions.filter((a) => !a.show || a.show(r)).map((a) => (
                        <button key={a.label} className="btn sm" onClick={() => void runAction(r, a)}>{a.label}</button>
                      ))}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid auto">
          {rows.map((r) => {
            const link = m.linkField && isUrl(String(r[m.linkField] ?? '')) ? String(r[m.linkField]) : ''
            const body = listFields.filter((f) => f.type === 'textarea' && r[f.name])
            const meta = listFields.filter((f) => f.type !== 'textarea')
            return (
              <div key={r.id} className="card hover" onClick={() => open(r)}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  {r.pinned ? <Pin size={14} className="pin" style={{ marginTop: 4 }} /> : null}
                  <h3 className="grow" style={{ wordBreak: 'break-word' }}>
                    {link ? <a href={link} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>{titleOf(r)}</a> : titleOf(r)}
                  </h3>
                  {m.route === 'journal' && r.mood > 0 ? <Stars value={r.mood} /> : null}
                </div>
                <div className="row wrap" style={{ margin: '8px 0 0', gap: 6 }}>
                  {meta.filter((f) => !(m.route === 'journal' && f.name === 'mood')).map((f) => {
                    const v = f.name === m.cycleField
                      ? <Badge value={r[f.name]} label={f.options?.find((o) => o.value === r[f.name])?.label} onClick={() => void cycle(r)} title="Click to change status" />
                      : renderValue(f, r[f.name])
                    if (!v) return null
                    return (
                      <span key={f.name} className="small" onClick={f.name === m.cycleField ? (e) => e.stopPropagation() : undefined}>
                        {PLAIN_LABEL.includes(f.type) ? <span className="faint">{f.label}: </span> : null}{v}
                      </span>
                    )
                  })}
                </div>
                {body.map((f) => <div key={f.name} style={{ marginTop: 8 }}>{renderValue(f, r[f.name])}</div>)}
                {relatedInfo(r)}
                {m.actions && (
                  <div className="row" style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                    {m.actions.filter((a) => !a.show || a.show(r)).map((a) => (
                      <button key={a.label} className="btn sm" onClick={() => void runAction(r, a)}>{a.label}</button>
                    ))}
                    {m.route === 'contacts' && r.last_contact ? <span className="small faint">Last: {fmtDate(r.last_contact)}</span> : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <RecordModal
          title={editing === 'new' ? m.newLabel : `Edit: ${titleOf(editing).slice(0, 40)}`}
          fields={m.fields}
          initial={editing === 'new' ? undefined : editing}
          onSave={(d) => save(d, editing === 'new' ? undefined : editing.id)}
          onDelete={editing === 'new' ? undefined : () => remove(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
