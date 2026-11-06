import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { attachmentUrl, ATTACHMENT_SCHEME } from '../attachments'

/** Dispatch this to force the inline image previews to rebuild (e.g. after a token refresh). */
export const refreshImages = StateEffect.define<null>()

// Matches a whole-line Markdown image: ![alt](url)  (url may contain spaces)
const IMG_LINE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/

class ImageWidget extends WidgetType {
  constructor(readonly url: string, readonly alt: string) { super() }
  eq(o: ImageWidget) { return o.url === this.url && o.alt === this.alt }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-img-preview'
    const img = document.createElement('img')
    img.src = this.url
    img.alt = this.alt
    img.loading = 'lazy'
    wrap.appendChild(img)
    return wrap
  }
  ignoreEvent() { return false }
}

function build(state: EditorState): DecorationSet {
  const active = new Set<number>()
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number
    const z = state.doc.lineAt(r.to).number
    for (let n = a; n <= z; n++) active.add(n)
  }
  const b = new RangeSetBuilder<Decoration>()
  // iterate line by line across the whole doc (notes are small enough for this)
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    const m = line.text.match(IMG_LINE)
    if (!m || active.has(line.number)) continue
    // don't treat an image inside a code fence as an image
    const node = syntaxTree(state).resolveInner(line.from, 1)
    if (/Code|FencedCode/.test(node.name)) continue
    const raw = m[2].trim()
    const url = raw.startsWith(ATTACHMENT_SCHEME) ? attachmentUrl(raw) : raw
    b.add(line.from, line.to, Decoration.replace({ widget: new ImageWidget(url, m[1]), block: true }))
  }
  return b.finish()
}

/**
 * Inline image previews. This MUST be a StateField, not a ViewPlugin: CodeMirror forbids
 * block decorations (block: true) from being provided by a plugin, which otherwise throws
 * "Block decorations may not be specified via plugins" and crashes the editor.
 */
export const imagePreview: Extension = StateField.define<DecorationSet>({
  create: (state) => build(state),
  update(deco, tr) {
    const forced = tr.effects.some((e) => e.is(refreshImages))
    if (tr.docChanged || tr.selection || forced) return build(tr.state)
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})
