import { useRef, type ComponentType } from 'react'
import {
  Bold, Code, Code2, Heading1, Heading2, Heading3, Image as ImageIcon, Italic, Link2,
  List, ListChecks, ListOrdered, Minus, Quote, Strikethrough, Table, Link,
} from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import {
  insertCodeBlock, insertHr, insertLink, insertTable, setHeading, toggleBullet,
  toggleNumbered, toggleQuote, toggleTask, toggleWrap,
} from '../editor/commands'

type Item =
  | { type: 'sep' }
  | { type: 'btn'; icon: ComponentType<{ size?: number }>; title: string; run: (v: EditorView) => void }

const ITEMS: Item[] = [
  { type: 'btn', icon: Heading1, title: 'Heading 1', run: (v) => setHeading(v, 1) },
  { type: 'btn', icon: Heading2, title: 'Heading 2', run: (v) => setHeading(v, 2) },
  { type: 'btn', icon: Heading3, title: 'Heading 3', run: (v) => setHeading(v, 3) },
  { type: 'sep' },
  { type: 'btn', icon: Bold, title: 'Bold (Ctrl+B)', run: (v) => toggleWrap(v, '**') },
  { type: 'btn', icon: Italic, title: 'Italic (Ctrl+I)', run: (v) => toggleWrap(v, '*') },
  { type: 'btn', icon: Strikethrough, title: 'Strikethrough', run: (v) => toggleWrap(v, '~~') },
  { type: 'btn', icon: Code, title: 'Inline code', run: (v) => toggleWrap(v, '`') },
  { type: 'sep' },
  { type: 'btn', icon: List, title: 'Bullet list', run: toggleBullet },
  { type: 'btn', icon: ListOrdered, title: 'Numbered list', run: toggleNumbered },
  { type: 'btn', icon: ListChecks, title: 'Task list', run: toggleTask },
  { type: 'btn', icon: Quote, title: 'Quote', run: toggleQuote },
  { type: 'sep' },
  { type: 'btn', icon: Link, title: 'Wikilink [[ ]]', run: (v) => insertLink(v, true) },
  { type: 'btn', icon: Link2, title: 'Link', run: (v) => insertLink(v, false) },
  { type: 'btn', icon: Code2, title: 'Code block', run: insertCodeBlock },
  { type: 'btn', icon: Table, title: 'Table', run: insertTable },
  { type: 'btn', icon: Minus, title: 'Horizontal rule', run: insertHr },
]

export interface EditorToolbarProps {
  /** returns the live CodeMirror view (null until it mounts) */
  getView: () => EditorView | null
  /** called with the chosen image files (paste / drop share this path too) */
  onPickImages: (files: File[]) => void
  uploading?: boolean
}

export default function EditorToolbar({ getView, onPickImages, uploading }: EditorToolbarProps) {
  const fileInput = useRef<HTMLInputElement>(null)

  const run = (fn: (v: EditorView) => void) => () => {
    const v = getView()
    if (v) fn(v)
  }

  return (
    <div className="note-toolbar" role="toolbar" aria-label="Formatting">
      {ITEMS.map((it, i) =>
        it.type === 'sep'
          ? <span key={`s${i}`} className="tb-sep" aria-hidden="true" />
          : (
            <button key={it.title} type="button" className="tb-btn" title={it.title} aria-label={it.title}
              onMouseDown={(e) => e.preventDefault()} onClick={run(it.run)}>
              <it.icon size={17} />
            </button>
          ))}
      <span className="tb-sep" aria-hidden="true" />
      <button type="button" className="tb-btn" title="Insert image" aria-label="Insert image"
        disabled={uploading} onMouseDown={(e) => e.preventDefault()}
        onClick={() => fileInput.current?.click()}>
        <ImageIcon size={17} />
      </button>
      {uploading && <span className="tb-status small muted">Uploading…</span>}
      <input ref={fileInput} type="file" accept="image/*" multiple hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) onPickImages(files)
        }} />
    </div>
  )
}
