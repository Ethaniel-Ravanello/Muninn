import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/** Wrap / unwrap the selection with an inline marker (** , * , ~~ , ` ). */
export function toggleWrap(view: EditorView, mark: string): boolean {
  view.dispatch(view.state.changeByRange((range) => {
    const before = view.state.sliceDoc(Math.max(0, range.from - mark.length), range.from)
    const after = view.state.sliceDoc(range.to, range.to + mark.length)
    if (before === mark && after === mark) {
      return {
        changes: [{ from: range.from - mark.length, to: range.from }, { from: range.to, to: range.to + mark.length }],
        range: EditorSelection.range(range.from - mark.length, range.to - mark.length),
      }
    }
    return {
      changes: [{ from: range.from, insert: mark }, { from: range.to, insert: mark }],
      range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
    }
  }))
  view.focus()
  return true
}

/** Apply (or toggle off) a line prefix like "# ", "> ", "- ", "- [ ] ". */
export function toggleLinePrefix(view: EditorView, prefix: string, re: RegExp): boolean {
  const { state } = view
  const changes: { from: number; to: number; insert: string }[] = []
  const seen = new Set<number>()
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number
    const last = state.doc.lineAt(r.to).number
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = state.doc.line(n)
      const m = line.text.match(re)
      if (m) changes.push({ from: line.from, to: line.from + m[0].length, insert: '' })
      else changes.push({ from: line.from, to: line.from, insert: prefix })
    }
  }
  view.dispatch({ changes })
  view.focus()
  return true
}

const HEADING = (level: number) => ({ prefix: '#'.repeat(level) + ' ', re: /^#{1,6}\s/ })

export function setHeading(view: EditorView, level: number): boolean {
  const { prefix, re } = HEADING(level)
  const { state } = view
  const changes: { from: number; to: number; insert: string }[] = []
  const seen = new Set<number>()
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = state.doc.line(n)
      const m = line.text.match(re)
      const already = m && m[0] === prefix
      changes.push({ from: line.from, to: line.from + (m ? m[0].length : 0), insert: already ? '' : prefix })
    }
  }
  view.dispatch({ changes })
  view.focus()
  return true
}

export const toggleBullet = (v: EditorView) => toggleLinePrefix(v, '- ', /^(\s*)[-*+]\s/)
export const toggleNumbered = (v: EditorView) => toggleLinePrefix(v, '1. ', /^(\s*)\d+[.)]\s/)
export const toggleTask = (v: EditorView) => toggleLinePrefix(v, '- [ ] ', /^(\s*)[-*+]\s\[[ xX]\]\s/)
export const toggleQuote = (v: EditorView) => toggleLinePrefix(v, '> ', /^>\s?/)

/** Insert a link / wikilink around the selection (or placeholder text). */
export function insertLink(view: EditorView, wiki: boolean): boolean {
  view.dispatch(view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to)
    if (wiki) {
      const inner = text || 'Note name'
      const insert = `[[${inner}]]`
      // put the caret inside the brackets so the [[ autocomplete can kick in
      const caret = range.from + 2 + inner.length
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(range.from + 2, caret) }
    }
    const label = text || 'text'
    const insert = `[${label}](url)`
    const urlFrom = range.from + label.length + 3
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(urlFrom, urlFrom + 3) }
  }))
  view.focus()
  return true
}

const CODE_BLOCK = '```\n\n```'

/** Fenced code block (or wrap the selection in one). */
export function insertCodeBlock(view: EditorView): boolean {
  view.dispatch(view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to)
    if (text) {
      const insert = '```\n' + text + '\n```'
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(range.from + 4, range.from + 4 + text.length) }
    }
    return { changes: { from: range.from, insert: CODE_BLOCK }, range: EditorSelection.cursor(range.from + 4) }
  }))
  view.focus()
  return true
}

const TABLE = '| Column | Column |\n| --- | --- |\n| Cell | Cell |\n'

/** Drop a starter Markdown table on its own line. */
export function insertTable(view: EditorView): boolean {
  const pos = view.state.selection.main.head
  const line = view.state.doc.lineAt(pos)
  const atLineStart = pos === line.from
  const prefix = atLineStart ? '' : '\n'
  const insert = prefix + TABLE
  view.dispatch({ changes: { from: pos, insert }, selection: EditorSelection.cursor(pos + prefix.length) })
  view.focus()
  return true
}

export function insertHr(view: EditorView): boolean {
  const pos = view.state.selection.main.head
  const line = view.state.doc.lineAt(pos)
  const insert = (pos === line.from ? '' : '\n') + '\n---\n'
  view.dispatch({ changes: { from: pos, insert }, selection: EditorSelection.cursor(pos + insert.length) })
  view.focus()
  return true
}

/** Insert arbitrary text at the cursor (used after an image upload resolves). */
export function insertAtCursor(view: EditorView, text: string): void {
  const pos = view.state.selection.main.to
  view.dispatch({ changes: { from: pos, insert: text }, selection: EditorSelection.cursor(pos + text.length) })
}
