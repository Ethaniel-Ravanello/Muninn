import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { pb, type Rec } from '../pb'
import { SEARCH_TARGETS } from '../modules'

interface Hit { route: string; group: string; title: string; q: string }

/** Global search across every module. Type "#tag" to find everything with that tag. */
export function SearchPalette({ initial, onClose }: { initial: string; onClose: () => void }) {
  const [q, setQ] = useState(initial)
  const [hits, setHits] = useState<Hit[]>([])
  const [sel, setSel] = useState(0)
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { ref.current?.focus() }, [])

  useEffect(() => {
    const needle = q.trim()
    if (needle.length < 2) { setHits([]); return }
    let cancelled = false
    setBusy(true)
    const timer = setTimeout(async () => {
      const isTag = needle.startsWith('#')
      const term = isTag ? needle.slice(1) : needle
      const results = await Promise.all(SEARCH_TARGETS.map(async (t) => {
        const fields = isTag ? t.fields.filter((f) => f === 'tags') : t.fields
        if (!fields.length || !term) return [] as Hit[]
        const filter = pb.filter(fields.map((f) => `${f} ~ {:q}`).join(' || '), { q: term })
        try {
          const res = await pb.collection(t.collection).getList<Rec>(1, 5, { filter })
          return res.items.map((r) => ({ route: t.route, group: t.label, title: t.titleOf(r), q: needle }))
        } catch {
          return [] as Hit[]
        }
      }))
      if (!cancelled) { setHits(results.flat()); setSel(0); setBusy(false) }
    }, 200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [q])

  const go = (h: Hit) => { onClose(); nav(`${h.route}?q=${encodeURIComponent(h.q)}`) }

  const groups = useMemo(() => {
    const m = new Map<string, { hit: Hit; index: number }[]>()
    hits.forEach((h, index) => { const l = m.get(h.group) ?? []; l.push({ hit: h, index }); m.set(h.group, l) })
    return [...m.entries()]
  }, [hits])

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label="Search">
        <input ref={ref} type="text" value={q} placeholder="Search everything... or #tag" aria-label="Search everything"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
            else if (e.key === 'Enter' && hits[sel]) go(hits[sel])
          }} />
        <div className="results">
          {q.trim().length < 2 ? (
            <div className="muted small" style={{ padding: 14 }}><Search size={14} style={{ verticalAlign: -2 }} /> Type at least 2 characters. Use <b>#tag</b> to browse by tag across notes, tasks, bookmarks and more.</div>
          ) : hits.length === 0 ? (
            <div className="muted small" style={{ padding: 14 }}>{busy ? 'Searching...' : 'No results.'}</div>
          ) : groups.map(([g, list]) => (
            <div key={g}>
              <div className="res-group">{g}</div>
              {list.map(({ hit, index }) => (
                <div key={index} className={`res${index === sel ? ' sel' : ''}`} onMouseEnter={() => setSel(index)} onClick={() => go(hit)}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.title}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
