import { useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import type { Field } from '../types'
import { errMsg } from '../util'
import { Modal } from './ui'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FormData = Record<string, any>

function Input({ f, value, onChange }: { f: Field; value: unknown; onChange: (v: unknown) => void }) {
  const id = `dl-${f.name}`
  switch (f.type) {
    case 'textarea':
      return <textarea value={String(value ?? '')} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
    case 'select':
      return (
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {!f.required && <option value="">-</option>}
          {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    case 'checkbox':
      return (
        <label className="row" style={{ paddingTop: 6 }}>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <span className="muted">{f.placeholder ?? 'Yes'}</span>
        </label>
      )
    case 'rating':
      return (
        <div className="row">
          {[1, 2, 3, 4, 5].map((i) => (
            <button type="button" key={i} className="icon-btn" aria-label={`${i} stars`}
              style={{ fontSize: 22, color: i <= Number(value || 0) ? 'var(--gold)' : 'var(--surface-3)' }}
              onClick={() => onChange(Number(value) === i ? 0 : i)}>★</button>
          ))}
        </div>
      )
    case 'progress':
      return (
        <div className="row">
          <input type="range" min={0} max={100} step={5} value={Number(value || 0)} onChange={(e) => onChange(Number(e.target.value))} />
          <span className="muted" style={{ width: 42, textAlign: 'right' }}>{Number(value || 0)}%</span>
        </div>
      )
    case 'number':
    case 'money':
      return <input type="number" inputMode="decimal" step="any" value={String(value ?? '')} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
    case 'date':
      return <input type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    case 'time':
      return <input type="time" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    case 'url':
      return <input type="url" value={String(value ?? '')} placeholder={f.placeholder ?? 'https://'} onChange={(e) => onChange(e.target.value)} />
    case 'tags':
      return <input type="text" value={String(value ?? '')} placeholder={f.placeholder ?? 'comma, separated'} onChange={(e) => onChange(e.target.value)} />
    default:
      return (
        <>
          <input type="text" list={f.suggest ? id : undefined} value={String(value ?? '')} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
          {f.suggest && <datalist id={id}>{f.suggest.map((s) => <option key={s} value={s} />)}</datalist>}
        </>
      )
  }
}

function initialValue(f: Field, initial?: FormData): unknown {
  const v = initial?.[f.name]
  if (v !== undefined && v !== null) {
    if ((f.type === 'number' || f.type === 'money') && Number(v) === 0) return ''
    return v
  }
  if (f.default !== undefined) return typeof f.default === 'function' ? (f.default as () => unknown)() : f.default
  if (f.type === 'checkbox') return false
  if (f.type === 'rating' || f.type === 'progress') return 0
  if (f.type === 'select' && f.required) return f.options?.[0]?.value ?? ''
  return ''
}

export function RecordModal(props: {
  title: string
  fields: Field[]
  initial?: FormData
  onSave: (data: FormData) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
  extra?: (data: FormData, set: (patch: FormData) => void) => ReactNode
  /** non-field keys (edited via `extra`) that should be saved too */
  extraKeys?: string[]
  wide?: boolean
}) {
  const { fields, initial, onSave, onDelete, onClose, extra } = props
  const [data, setData] = useState<FormData>(() => {
    const d: FormData = { ...(initial ?? {}) }
    fields.forEach((f) => { d[f.name] = initialValue(f, initial) })
    return d
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (patch: FormData) => setData((d) => ({ ...d, ...patch }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    // only form fields (plus declared extras) go to the server, never system fields like id/created
    const out: FormData = {}
    fields.forEach((f) => { out[f.name] = data[f.name] })
    ;(props.extraKeys ?? []).forEach((k) => { out[k] = data[k] })
    for (const f of fields) {
      const v = out[f.name]
      if (f.required && (v === '' || v === undefined || v === null)) {
        setError(`${f.label} is required`)
        return
      }
      if (f.type === 'number' || f.type === 'money') out[f.name] = v === '' || v === undefined ? 0 : Number(v)
      if (typeof v === 'string' && (f.type === 'text' || f.type === 'tags')) out[f.name] = v.trim()
    }
    setBusy(true)
    setError('')
    try {
      await onSave(out)
      onClose()
    } catch (err) {
      setError(errMsg(err))
      setBusy(false)
    }
  }

  const del = async () => {
    if (!onDelete || !confirm('Delete this item? This cannot be undone.')) return
    setBusy(true)
    try {
      await onDelete()
      onClose()
    } catch (err) {
      setError(errMsg(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={props.title} onClose={onClose} wide={props.wide}>
      <form onSubmit={submit}>
        <div className="form-grid">
          {fields.map((f) => (
            <label key={f.name} className={`f${f.full || f.type === 'textarea' ? ' full' : ''}`}>
              <span className="lbl">{f.label}{f.required ? ' *' : ''}</span>
              <Input f={f} value={data[f.name]} onChange={(v) => set({ [f.name]: v })} />
            </label>
          ))}
        </div>
        {extra ? <div style={{ marginTop: 14 }}>{extra(data, set)}</div> : null}
        {error && <div className="err" style={{ marginTop: 10 }}>{error}</div>}
        <div className="modal-foot">
          <button className="btn primary" type="submit" disabled={busy}>Save</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <span className="grow" />
          {onDelete && <button className="btn danger" type="button" onClick={del} disabled={busy}><Trash2 size={15} /> Delete</button>}
        </div>
      </form>
    </Modal>
  )
}
