import { useEffect, useMemo, useRef } from 'react'
import { Marked, type TokenizerAndRendererExtension } from 'marked'
import DOMPurify from 'dompurify'
import type { Rec } from '../pb'
import { resolveAttachmentUrls } from '../attachments'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/** Resolves a [[wikilink]] target ("Note", "Folder/Note", "Note#Heading", "Note|alias") to a note. */
export function resolveNote(notes: Rec[], target: string): Rec | undefined {
  const name = target.split('#')[0].split('^')[0].trim().replace(/\.md$/i, '').toLowerCase()
  if (!name) return undefined
  const byTitle = notes.find((n) => String(n.title ?? '').toLowerCase() === name)
  if (byTitle) return byTitle
  return notes.find((n) => {
    const p = String(n.path ?? '').replace(/\.md$/i, '').toLowerCase()
    return p === name || p.endsWith('/' + name)
  })
}

/** Targets of every [[wikilink]] in a piece of markdown. */
export function wikilinkTargets(content: string): string[] {
  const out: string[] = []
  for (const m of content.matchAll(/\[\[([^\]\n|]+?)(?:\|[^\]\n]+?)?\]\]/g)) out.push(m[1].trim())
  return out
}

function extensions(notes: Rec[]): TokenizerAndRendererExtension[] {
  return [
    {
      name: 'wikilink',
      level: 'inline',
      start: (src) => { const i = src.indexOf('[['); return i < 0 ? undefined : i },
      tokenizer(src) {
        const m = /^\[\[([^\]\n|]+?)(?:\|([^\]\n]+?))?\]\]/.exec(src)
        if (!m) return undefined
        return { type: 'wikilink', raw: m[0], target: m[1].trim(), alias: (m[2] ?? '').trim() }
      },
      renderer(token) {
        const target = String(token.target)
        const label = escapeHtml(String(token.alias || target))
        const hit = resolveNote(notes, target)
        return hit
          ? `<a class="wikilink" href="#/notes/${hit.id}" data-note="${hit.id}">${label}</a>`
          : `<a class="wikilink unresolved" href="#" data-create="${escapeHtml(target.split('#')[0].trim())}" title="Not created yet. Click to create.">${label}</a>`
      },
    },
    {
      name: 'hashtag',
      level: 'inline',
      start: (src) => { const m = /(^|\s)#[\p{L}\d_]/u.exec(src); return m ? m.index + m[1].length : undefined },
      tokenizer(src) {
        const m = /^#((?=[\p{L}\d_/-]*[\p{L}_/-])[\p{L}\d_/-]+)/u.exec(src)
        if (!m) return undefined
        return { type: 'hashtag', raw: m[0], tag: m[1] }
      },
      renderer(token) {
        const tag = String(token.tag)
        return `<a class="md-tag" href="#/notes?q=${encodeURIComponent('#' + tag)}">#${escapeHtml(tag)}</a>`
      },
    },
  ]
}

let hooked = false
function ensureHook() {
  if (hooked) return
  hooked = true
  // external links open in a new tab, never in the app window
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') ?? '')) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

export function renderMarkdown(src: string, notes: Rec[]): string {
  ensureHook()
  // rewrite muninn-attachment: references to real file URLs so <img> tags load
  const withImages = resolveAttachmentUrls(src)
  // breaks: true matches Obsidian's default, where a single newline is a line break
  const marked = new Marked({ gfm: true, breaks: true, extensions: extensions(notes) })
  const html = marked.parse(withImages, { async: false }) as string
  return DOMPurify.sanitize(html) // notes may come from a synced vault, so never trust raw HTML
}

/** Toggle the nth "- [ ]" task in the source, ignoring fenced code blocks. */
export function toggleTask(content: string, index: number): string {
  const lines = content.split('\n')
  let fence = ''
  let n = 0
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(/^\s*(```|~~~)/)
    if (f) { fence = fence ? (fence === f[1] ? '' : fence) : f[1]; continue }
    if (fence) continue
    const m = lines[i].match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/)
    if (!m) continue
    if (n === index) {
      lines[i] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3]
      return lines.join('\n')
    }
    n++
  }
  return content
}

interface Props {
  content: string
  notes: Rec[]
  onToggleTask: (index: number) => void
  onOpenNote: (id: string) => void
  onCreateNote: (title: string) => void
}

export function MarkdownView({ content, notes, onToggleTask, onOpenNote, onCreateNote }: Props) {
  const html = useMemo(() => renderMarkdown(content, notes), [content, notes])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((el, i) => {
      el.disabled = false
      el.dataset.idx = String(i)
    })
  }, [html])

  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement
    if (t instanceof HTMLInputElement && t.type === 'checkbox') {
      onToggleTask(Number(t.dataset.idx))
      return
    }
    const a = t.closest('a')
    if (!a) return
    if (a.dataset.note) { e.preventDefault(); onOpenNote(a.dataset.note) }
    else if (a.dataset.create !== undefined) { e.preventDefault(); onCreateNote(a.dataset.create) }
  }

  return <div ref={ref} className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
