import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pin, Trash2 } from 'lucide-react'
import { pb, uidOwner, type Rec } from '../pb'
import { MarkdownView, resolveNote, toggleTask, wikilinkTargets } from '../components/MarkdownView'
import { Badge } from '../components/ui'
import { errMsg, splitTags } from '../util'

// CodeMirror is the heavy part, so it only loads when you actually edit
const NoteEditor = lazy(() => import('../components/NoteEditor'))

type Mode = 'view' | 'edit'
type Status = 'saved' | 'dirty' | 'saving' | 'error'
interface Draft { title: string; category: string; tags: string; content: string; pinned: boolean }

const toDraft = (n: Rec): Draft => ({
  title: n.title ?? '', category: n.category ?? '', tags: n.tags ?? '', content: n.content ?? '', pinned: !!n.pinned,
})

export default function NoteDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [notes, setNotes] = useState<Rec[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [missing, setMissing] = useState(false)
  const [status, setStatus] = useState<Status>('saved')
  const [error, setError] = useState('')
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('muninn:noteMode') === 'edit' ? 'edit' : 'view'))

  const draftRef = useRef<Draft | null>(null)
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)

  /* ---- saving ---- */
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    const d = draftRef.current
    if (!dirty.current || !d) return
    dirty.current = false
    setStatus('saving')
    try {
      const rec = await pb.collection('notes').update<Rec>(id, {
        title: d.title.trim() || 'Untitled', category: d.category.trim(), tags: d.tags.trim(), content: d.content, pinned: d.pinned,
      })
      setNotes((prev) => prev.map((n) => (n.id === id ? rec : n)))
      setStatus(dirty.current ? 'dirty' : 'saved')
      setError('')
    } catch (e) {
      dirty.current = true
      setStatus('error')
      setError(errMsg(e))
    }
  }, [id])

  const change = (patch: Partial<Draft>) => {
    if (!draftRef.current) return
    const next = { ...draftRef.current, ...patch }
    draftRef.current = next
    setDraft(next)
    dirty.current = true
    setStatus('dirty')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), 800)
  }

  /* ---- loading ---- */
  useEffect(() => {
    let cancelled = false
    draftRef.current = null
    setDraft(null)
    setMissing(false)
    setStatus('saved')
    pb.collection('notes').getFullList<Rec>({ sort: 'title' }).then((list) => {
      if (cancelled) return
      setNotes(list)
      const n = list.find((x) => x.id === id)
      if (!n) { setMissing(true); return }
      const d = toDraft(n)
      draftRef.current = d
      setDraft(d)
      if (!d.content.trim()) setMode('edit') // a fresh note opens ready to type
    }).catch((e) => { if (!cancelled) { setMissing(true); setError(errMsg(e)) } })
    return () => { cancelled = true }
  }, [id])

  // save whatever is pending when leaving the note or hiding the tab
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flush() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      void flush()
    }
  }, [flush])

  /* ---- mode ---- */
  const switchMode = useCallback((m: Mode) => {
    setMode(m)
    localStorage.setItem('muninn:noteMode', m)
    if (m === 'view') void flush()
  }, [flush])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        switchMode(mode === 'edit' ? 'view' : 'edit')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, switchMode])

  /* ---- navigation helpers ---- */
  const open = async (noteId: string) => { await flush(); nav(`/notes/${noteId}`) }
  const createLinked = async (title: string) => {
    await flush()
    try {
      const rec = await pb.collection('notes').create<Rec>({ user: uidOwner(), title: title || 'Untitled', content: '' })
      nav(`/notes/${rec.id}`)
    } catch (e) { setError(errMsg(e)) }
  }
  const openByTarget = (target: string) => {
    const hit = resolveNote(notes, target)
    if (hit) void open(hit.id)
    else void createLinked(target.split('#')[0].trim())
  }
  const back = async () => { await flush(); nav('/notes') }
  const remove = async () => {
    if (!confirm('Delete this note? This cannot be undone.')) return
    window.clearTimeout(timer.current)
    dirty.current = false
    try { await pb.collection('notes').delete(id); nav('/notes') } catch (e) { setError(errMsg(e)) }
  }

  /* ---- derived ---- */
  const note = notes.find((n) => n.id === id)
  const categories = useMemo(() => [...new Set(notes.map((n) => String(n.category ?? '')).filter(Boolean))].sort(), [notes])
  const titles = useMemo(() => notes.filter((n) => n.id !== id).map((n) => String(n.title)), [notes, id])
  const backlinks = useMemo(() => {
    if (!note) return []
    return notes.filter((n) => n.id !== id && wikilinkTargets(String(n.content ?? '')).some((t) => resolveNote(notes, t)?.id === id))
  }, [notes, note, id])

  if (missing) {
    return (
      <div className="page">
        <p className="muted">{error || 'This note does not exist (anymore).'}</p>
        <p><Link to="/notes">Back to notes</Link></p>
      </div>
    )
  }
  if (!draft) return <div className="page muted">Loading...</div>

  const statusText = { saved: 'Saved', dirty: 'Unsaved changes...', saving: 'Saving...', error: 'Not saved' }[status]

  return (
    <div className="page note-page">
      <div className="note-top">
        <button className="btn ghost" onClick={() => void back()}><ArrowLeft size={16} /> Notes</button>
        <span className="grow" />
        <span className={`small ${status === 'error' ? 'err' : 'muted'}`} role="status" title={error}>{statusText}</span>
        <button className={`icon-btn${draft.pinned ? ' pin' : ''}`} aria-pressed={draft.pinned} aria-label={draft.pinned ? 'Unpin' : 'Pin'} title="Pin" onClick={() => change({ pinned: !draft.pinned })}>
          <Pin size={17} />
        </button>
        <div className="tabs" role="tablist" title="Toggle with Ctrl+E">
          <button role="tab" aria-selected={mode === 'view'} className={mode === 'view' ? 'on' : ''} onClick={() => switchMode('view')}>View</button>
          <button role="tab" aria-selected={mode === 'edit'} className={mode === 'edit' ? 'on' : ''} onClick={() => switchMode('edit')}>Edit</button>
        </div>
        <button className="icon-btn" aria-label="Delete note" title="Delete" onClick={() => void remove()}><Trash2 size={17} /></button>
      </div>

      <input className="note-title" type="text" value={draft.title} placeholder="Untitled" aria-label="Title"
        onChange={(e) => change({ title: e.target.value })} />

      {mode === 'edit' ? (
        <div className="note-meta">
          <label className="f"><span className="lbl">Category (folder)</span>
            <input type="text" list="note-categories" value={draft.category} placeholder="e.g. Work/Projects" onChange={(e) => change({ category: e.target.value })} />
            <datalist id="note-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="f"><span className="lbl">Tags</span>
            <input type="text" value={draft.tags} placeholder="comma, separated" onChange={(e) => change({ tags: e.target.value })} />
          </label>
        </div>
      ) : (
        <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
          {draft.category && <Badge value="" label={draft.category} tone="blue" />}
          {splitTags(draft.tags).map((t) => <Link key={t} className="md-tag" to={`/notes?q=${encodeURIComponent('#' + t)}`}>#{t}</Link>)}
        </div>
      )}

      {mode === 'edit' ? (
        <Suspense fallback={<div className="muted">Loading editor...</div>}>
          <NoteEditor key={id} value={draft.content} titles={titles} autoFocus
            onChange={(content) => change({ content })} onOpenLink={openByTarget} />
        </Suspense>
      ) : draft.content.trim() ? (
        <MarkdownView content={draft.content} notes={notes}
          onToggleTask={(i) => change({ content: toggleTask(draft.content, i) })}
          onOpenNote={(nid) => void open(nid)} onCreateNote={(t) => void createLinked(t)} />
      ) : (
        <p className="muted">This note is empty. Press <span className="kbd">Ctrl E</span> or click Edit to start writing.</p>
      )}

      {mode === 'view' && note?.fm ? (
        <details className="note-props">
          <summary>Properties</summary>
          <pre>{note.fm}</pre>
        </details>
      ) : null}

      {backlinks.length > 0 && (
        <section className="note-backlinks">
          <h3>Linked mentions <span className="faint small">({backlinks.length})</span></h3>
          {backlinks.map((b) => <div key={b.id}><Link to={`/notes/${b.id}`} onClick={() => void flush()}>{b.title}</Link></div>)}
        </section>
      )}
    </div>
  )
}
