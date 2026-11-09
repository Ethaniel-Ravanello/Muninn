import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { attachmentUrl, ATTACHMENT_SCHEME, embedImageUrl, isImageName, parseEmbed } from '../attachments'

// Matches a whole-line Markdown image: ![alt](url)  (url may contain spaces)
const IMG_LINE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/
// Matches a whole-line Obsidian embed: ![[file.png|300]]
const EMBED_LINE = /^!\[\[([^\]\n]+?)\]\]\s*$/

class ImageWidget extends WidgetType {
  constructor(readonly url: string, readonly alt: string, readonly width = '') { super() }
  eq(o: ImageWidget) { return o.url === this.url && o.alt === this.alt && o.width === this.width }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-img-preview'
    const img = document.createElement('img')
    img.src = this.url
    img.alt = this.alt
    if (this.width) img.style.width = `${this.width}px`
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
    if (active.has(line.number) || !line.text.startsWith('!')) continue
    const m = line.text.match(IMG_LINE)
    const e = m ? null : line.text.match(EMBED_LINE)
    if (!m && !e) continue
    // don't treat an image inside a code fence as an image
    const node = syntaxTree(state).resolveInner(line.from, 1)
    if (/Code|FencedCode/.test(node.name)) continue
    let widget: ImageWidget
    if (m) {
      const raw = m[2].trim()
      widget = new ImageWidget(raw.startsWith(ATTACHMENT_SCHEME) ? attachmentUrl(raw) : raw, m[1])
    } else {
      const { target, width, alt } = parseEmbed(e![1])
      if (!isImageName(target.split('#')[0])) continue
      const url = embedImageUrl(target)
      if (!url) continue // not synced yet: keep the plain text visible instead of an empty box
      widget = new ImageWidget(url, alt || target, width)
    }
    b.add(line.from, line.to, Decoration.replace({ widget, block: true }))
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
    if (tr.docChanged || tr.selection) return build(tr.state)
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})
