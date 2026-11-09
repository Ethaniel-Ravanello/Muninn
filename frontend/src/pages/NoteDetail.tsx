import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pin, Trash2 } from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import { pb, uidOwner, type Rec } from '../pb'
import { MarkdownView, resolveNote, toggleTask, wikilinkTargets } from '../components/MarkdownView'
import EditorToolbar from '../components/EditorToolbar'
import { Badge } from '../components/ui'
import { loadImageIndex, uploadImage } from '../attachments'
import { insertAtCursor } from '../editor/commands'
import { errMsg, splitTags } from '../util'

// CodeMirror is the heavy part, so it only loads when you actually edit
const NoteEditor = lazy(() => import('../components/NoteEditor'))

type Mode = 'view' | 'edit'
type Status = 'saved' | 'dirty' | 'saving' | 'error'
interface Draft { title: string; category: string; tags: string; content: string; pinned: boolean }

const toDraft = (n: Rec): Draft => ({
  title: n.title ?? '', category: n.category ?? '', tags: n.tags ?? '', content: n.content ?? '', pinned: !!n.pinned,
})

/** What actually gets stored: same trimming the server copy gets. */
const normalize = (d: Draft): Draft => ({
  title: d.title.trim() || 'Untitled', category: d.category.trim(), tags: d.tags.trim(), content: d.content, pinned: d.pinned,
})

export default function NoteDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  // light list: id, title, path, category only. Full texts are never downloaded just to open one note.
  const [notes, setNotes] = useState<Rec[]>([])
  const [backlinks, setBacklinks] = useState<{ id: string; title: string }[]>([])
  const [props, setProps] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [missing, setMissing] = useState(false)
  const [status, setStatus] = useState<Status>('saved')
  const [error, setError] = useState('')
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('muninn:noteMode') === 'edit' ? 'edit' : 'view'))
  const [uploading, setUploading] = useState(false)
  // text found on the server when it differs from what this editor started from (changed by Obsidian sync)
  const [conflict, setConflict] = useState<string | null>(null)
  // bumped to remount the editor after its text was replaced from outside
  const [rev, setRev] = useState(0)

  const draftRef = useRef<Draft | null>(null)
  /** the last version known to be on the server; autosave only sends what differs from it */
  const baseRef = useRef<Draft | null>(null)
  const conflictRef = useRef<string | null>(null)
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const viewRef = useRef<EditorView | null>(null)
  const idRef = useRef(id)
  idRef.current = id
  const notesRef = useRef<Rec[]>([])
  notesRef.current = notes

  /* ---- saving ---- */
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    const d = draftRef.current
    const base = baseRef.current
    if (!dirty.current || !d || !base || conflictRef.current !== null) return

    const next = normalize(d)
    const patch: Partial<Draft> = {}
    ;(Object.keys(next) as (keyof Draft)[]).forEach((k) => { if (next[k] !== base[k]) Object.assign(patch, { [k]: next[k] }) })
    if (Object.keys(patch).length === 0) { dirty.current = false; setStatus('saved'); return }

    dirty.current = false
    setStatus('saving')
    try {
      if ('content' in patch) {
        // Obsidian sync can change this note while it is open here. Never overwrite text we have not seen.
        const remote = await pb.collection('notes').getOne<Rec>(id, { fields: 'content' })
        const rc = String(remote.content ?? '')
        if (rc !== base.content && rc !== next.content) {
          conflictRef.current = rc
          setConflict(rc)
          dirty.current = true
          setStatus('error')
          return
        }
      }
      await pb.collection('notes').update(id, patch, { fields: 'id' })
      baseRef.current = { ...base, ...patch }
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, title: next.title, category: next.category } : n)))
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
  const changeRef = useRef(change)
  changeRef.current = change

  const keepMine = () => {
    const base = baseRef.current
    if (base && conflictRef.current !== null) baseRef.current = { ...base, content: conflictRef.current }
    conflictRef.current = null
    setConflict(null)
    dirty.current = true
    void flush()
  }
  const takeTheirs = () => {
    const remote = conflictRef.current
    const d = draftRef.current
    if (remote === null || !d) return
    const next = { ...d, content: remote }
    draftRef.current = next
    baseRef.current = baseRef.current ? { ...baseRef.current, content: remote } : next
    conflictRef.current = null
    setConflict(null)
    setDraft(next)
    dirty.current = false
    setStatus('saved')
    setRev((r) => r + 1) // the editor owns its text, so it has to be rebuilt to show the other version
  }

  /* ---- loading: this note in full, everyone else as a light list ---- */
  useEffect(() => {
    let cancelled = false
    draftRef.current = null
    baseRef.current = null
    conflictRef.current = null
    dirty.current = false
    setDraft(null)
    setMissing(false)
    setStatus('saved')
    setConflict(null)
    setBacklinks([])
    setProps('')
    Promise.all([
      pb.collection('notes').getOne<Rec>(id),
      pb.collection('notes').getFullList<Rec>({ sort: 'title', fields: 'id,title,path,category' }),
      loadImageIndex(), // must be ready before the note is drawn, so ![[image.png]] can find its picture
    ]).then(([n, list]) => {
      if (cancelled) return
      setNotes(list)
      const d = toDraft(n)
      draftRef.current = d
      baseRef.current = d
      setProps(String(n.fm ?? ''))
      setDraft(d)
      if (!d.content.trim()) setMode('edit') // a fresh note opens ready to type
    }).catch((e) => { if (!cancelled) { setMissing(true); setError(errMsg(e)) } })
    return () => { cancelled = true }
  }, [id])

  // Linked mentions: let the server narrow it to notes that contain this note's name, then check those few.
  const selfTitle = notes.find((n) => n.id === id)?.title as string | undefined
  const selfPath = notes.find((n) => n.id === id)?.path as string | undefined
  useEffect(() => {
    if (!selfTitle) return
    let cancelled = false
    const fileName = String(selfPath ?? '').replace(/\.md$/i, '').split('/').pop() ?? ''
    const terms = [...new Set([selfTitle, fileName].filter(Boolean))]
    const params: Record<string, string> = { id }
    terms.forEach((t, i) => { params[`t${i}`] = t })
    const filter = pb.filter(`id != {:id} && (${terms.map((_, i) => `content ~ {:t${i}}`).join(' || ')})`, params)
    const t = window.setTimeout(() => {
      pb.collection('notes').getFullList<Rec>({ filter, fields: 'id,title,content' }).then((cands) => {
        if (cancelled) return
        setBacklinks(cands
          .filter((c) => wikilinkTargets(String(c.content ?? '')).some((w) => resolveNote(notesRef.current, w)?.id === id))
          .map((c) => ({ id: c.id, title: String(c.title) })))
      }).catch(() => undefined)
    }, 300)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [id, selfTitle, selfPath])

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

  /* ---- images: upload, then drop the markdown at the cursor ---- */
  const addImages = useCallback(async (files: File[]) => {
    const startId = idRef.current
    setUploading(true)
    setError('')
    try {
      for (const file of files) {
        const md = await uploadImage(file)
        if (idRef.current !== startId) { setError('You switched notes while the image uploaded. Paste it again.'); return }
        const view = viewRef.current
        if (view) insertAtCursor(view, md + '\n')
        else if (draftRef.current) changeRef.current({ content: draftRef.current.content + '\n' + md + '\n' })
      }
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setUploading(false)
    }
  }, [])

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
  const categories = useMemo(() => [...new Set(notes.map((n) => String(n.category ?? '')).filter(Boolean))].sort(), [notes])
  const titles = useMemo(() => notes.filter((n) => n.id !== id).map((n) => String(n.title)), [notes, id])

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

      {conflict !== null && (
        <div className="card" role="alert" style={{ borderColor: 'var(--red)', marginBottom: 14 }}>
          <div style={{ fontWeight: 600 }}>This note was changed somewhere else (probably the Obsidian sync).</div>
          <div className="small muted">Autosave is paused so nothing gets overwritten. Pick the version to keep.</div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={keepMine}>Keep my version</button>
            <button className="btn" onClick={takeTheirs}>Use the other version</button>
          </div>
        </div>
      )}

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
          <EditorToolbar getView={() => viewRef.current} onPickImages={(f) => void addImages(f)} uploading={uploading} />
          <NoteEditor key={`${id}:${rev}`} value={draft.content} titles={titles} autoFocus
            onChange={(content) => change({ content })} onOpenLink={openByTarget}
            onImages={(f) => void addImages(f)} onReady={(v) => { viewRef.current = v }} />
        </Suspense>
      ) : draft.content.trim() ? (
        <MarkdownView content={draft.content} notes={notes}
          onToggleTask={(i) => change({ content: toggleTask(draft.content, i) })}
          onOpenNote={(nid) => void open(nid)} onCreateNote={(t) => void createLinked(t)} />
      ) : (
        <p className="muted">This note is empty. Press <span className="kbd">Ctrl E</span> or click Edit to start writing.</p>
      )}

      {mode === 'view' && props ? (
        <details className="note-props">
          <summary>Properties</summary>
          <pre>{props}</pre>
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
