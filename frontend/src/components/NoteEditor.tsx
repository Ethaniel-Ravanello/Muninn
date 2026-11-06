import { useEffect, useRef } from 'react'
import { EditorState, RangeSetBuilder } from '@codemirror/state'
import {
  Decoration, EditorView, MatchDecorator, ViewPlugin, drawSelection, keymap, placeholder,
  type DecorationSet, type ViewUpdate,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tags as t } from '@lezer/highlight'
import { toggleWrap } from '../editor/commands'
import { imagePreview, refreshImages } from '../editor/imageWidget'
import { isImageFile } from '../attachments'

/* ---------- look: headings, bold, links... styled right in the editor ---------- */
const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.8em', fontWeight: '700' },
  { tag: t.heading2, fontSize: '1.5em', fontWeight: '700' },
  { tag: t.heading3, fontSize: '1.3em', fontWeight: '650' },
  { tag: t.heading4, fontSize: '1.15em', fontWeight: '650' },
  { tag: [t.heading5, t.heading6], fontWeight: '650', color: 'var(--muted)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--muted)' },
  { tag: t.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--faint)' },
  { tag: t.monospace, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.92em', background: 'var(--surface-3)', borderRadius: '4px' },
  { tag: t.quote, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--faint)' },
])

const theme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'transparent', fontSize: '16px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif', lineHeight: '1.75', overflow: 'visible' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '4px 0 140px' },
  '.cm-line': { padding: '0 2px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground': { backgroundColor: 'rgba(124, 140, 255, 0.28) !important' },
  '.cm-placeholder': { color: 'var(--faint)' },
  '.cm-wikilink': { color: 'var(--accent-2)', cursor: 'pointer' },
  '.cm-hashtag': { color: 'var(--accent)' },
  '.cm-tooltip': { backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-2)', borderRadius: '8px', overflow: 'hidden' },
  '.cm-tooltip-autocomplete ul li': { padding: '3px 10px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--surface-3)', color: 'var(--text)' },
}, { dark: true })

/* ---------- live preview: hide markdown marks on every line except the ones being edited ---------- */
const hideMark = Decoration.replace({})
const WIKILINK = /\[\[[^\]\n]+\]\]/g

function inCode(state: EditorState, pos: number): boolean {
  let n = syntaxTree(state).resolveInner(pos, 1)
  for (;;) {
    if (/Code/.test(n.name)) return true
    const p = n.parent
    if (!p) return false
    n = p
  }
}

function buildLivePreview(view: EditorView): DecorationSet {
  const { state } = view
  const active = new Set<number>()
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number
    const z = state.doc.lineAt(r.to).number
    for (let n = a; n <= z; n++) active.add(n)
  }
  const spans: { from: number; to: number }[] = []
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter(node) {
        const parent = node.node.parent?.name
        let end = node.to
        let hide = false
        switch (node.name) {
          case 'HeaderMark':
            hide = true
            if (state.doc.sliceString(end, end + 1) === ' ') end++
            break
          case 'EmphasisMark':
          case 'StrikethroughMark':
            hide = true
            break
          case 'CodeMark': hide = parent === 'InlineCode'; break
          case 'LinkMark':
          case 'URL':
            // only real inline links "[text](url)"; "[[wikilinks]]" parse as reference links without a URL
            hide = parent === 'Link' && !!node.node.parent?.getChild('URL')
            break
        }
        if (hide && !active.has(state.doc.lineAt(node.from).number)) spans.push({ from: node.from, to: end })
      },
    })

    // [[wikilinks]]: show only the text (the alias when there is one) on lines you are not editing
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos)
      if (!active.has(line.number)) {
        for (const m of line.text.matchAll(WIKILINK)) {
          const start = line.from + (m.index ?? 0)
          if (inCode(state, start)) continue
          const bar = m[0].indexOf('|')
          spans.push({ from: start, to: start + (bar >= 0 ? bar + 1 : 2) })
          spans.push({ from: start + m[0].length - 2, to: start + m[0].length })
        }
      }
      pos = line.to + 1
    }
  }
  spans.sort((x, y) => x.from - y.from || x.to - y.to)
  const b = new RangeSetBuilder<Decoration>()
  let last = -1
  for (const s of spans) {
    if (s.from < last) continue // never overlap
    b.add(s.from, s.to, hideMark)
    last = s.to
  }
  return b.finish()
}

const livePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = buildLivePreview(view) }
  update(u: ViewUpdate) {
    if (u.docChanged || u.selectionSet || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
      this.decorations = buildLivePreview(u.view)
    }
  }
}, { decorations: (v) => v.decorations })

/* ---------- [[wikilinks]] and #tags ---------- */
const matchPlugin = (deco: MatchDecorator) => ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = deco.createDeco(view) }
  update(u: ViewUpdate) { this.decorations = deco.updateDeco(u, this.decorations) }
}, { decorations: (v) => v.decorations })

const wikilinks = matchPlugin(new MatchDecorator({ regexp: WIKILINK, decoration: Decoration.mark({ class: 'cm-wikilink' }) }))
const hashtags = matchPlugin(new MatchDecorator({
  regexp: /(?<=^|\s)#(?=[\p{L}\d_/-]*[\p{L}_/-])[\p{L}\d_/-]+/gu,
  decoration: Decoration.mark({ class: 'cm-hashtag' }),
}))

export interface NoteEditorProps {
  value: string
  onChange: (value: string) => void
  /** titles offered by the [[ autocomplete */
  titles: string[]
  /** Ctrl/Cmd + click on a [[wikilink]] */
  onOpenLink: (target: string) => void
  /** pasted / dropped image files, uploaded by the parent */
  onImages?: (files: File[]) => void
  /** hands the live CodeMirror view back to the parent (for the toolbar) */
  onReady?: (view: EditorView | null) => void
  /** bump this to re-render inline images (e.g. after a file-token refresh) */
  refreshKey?: number
  autoFocus?: boolean
}

export default function NoteEditor({ value, onChange, titles, onOpenLink, onImages, onReady, refreshKey, autoFocus }: NoteEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const live = useRef({ onChange, titles, onOpenLink, onImages, onReady })
  live.current = { onChange, titles, onOpenLink, onImages, onReady }

  useEffect(() => {
    const complete = (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/\[\[[^\]\n]*/)
      if (!m) return null
      return {
        from: m.from + 2,
        options: live.current.titles.map((title) => ({ label: title, apply: `${title}]]` })),
        validFor: /^[^\]\n]*$/,
      }
    }

    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(highlight),
          theme,
          livePreview,
          imagePreview,
          wikilinks,
          hashtags,
          placeholder('Start writing. Use [[ to link notes, #tags, Markdown, and paste images.'),
          autocompletion({ override: [complete], icons: false }),
          keymap.of([
            { key: 'Mod-b', run: (v) => toggleWrap(v, '**') },
            { key: 'Mod-i', run: (v) => toggleWrap(v, '*') },
            { key: 'Mod-Shift-x', run: (v) => toggleWrap(v, '~~') },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((u) => { if (u.docChanged) live.current.onChange(u.state.doc.toString()) }),
          EditorView.domEventHandlers({
            paste(e) {
              const items = e.clipboardData?.files
              if (!items || !items.length) return false
              const imgs = Array.from(items).filter(isImageFile)
              if (!imgs.length || !live.current.onImages) return false
              e.preventDefault()
              live.current.onImages(imgs)
              return true
            },
            drop(e, v) {
              const files = e.dataTransfer?.files
              if (!files || !files.length) return false
              const imgs = Array.from(files).filter(isImageFile)
              if (!imgs.length || !live.current.onImages) return false
              e.preventDefault()
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY })
              if (pos !== null) v.dispatch({ selection: { anchor: pos } })
              live.current.onImages(imgs)
              return true
            },
            mousedown(e, v) {
              if (!(e.ctrlKey || e.metaKey)) return false
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY })
              if (pos === null) return false
              const line = v.state.doc.lineAt(pos)
              for (const m of line.text.matchAll(WIKILINK)) {
                const from = line.from + (m.index ?? 0)
                if (pos >= from && pos <= from + m[0].length) {
                  e.preventDefault()
                  const inner = m[0].slice(2, -2)
                  live.current.onOpenLink(inner.split('|')[0].trim())
                  return true
                }
              }
              return false
            },
          }),
        ],
      }),
    })
    viewRef.current = view
    live.current.onReady?.(view)
    if (autoFocus) {
      view.focus()
      view.dispatch({ selection: { anchor: view.state.doc.length } })
    }
    return () => { live.current.onReady?.(null); viewRef.current = null; view.destroy() }
    // the editor owns its document after mount; the parent remounts it per note
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // a file token arrived/refreshed: rebuild the inline image widgets with the new URL
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshImages.of(null) })
  }, [refreshKey])

  return <div ref={host} className="cm-host" />
}
