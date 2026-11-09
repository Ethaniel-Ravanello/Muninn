import { pb, uidOwner, type Rec } from './pb'

/**
 * How a pasted / dropped / uploaded image is referenced inside a note.
 *
 * The bytes live on one `attachments` record each; the note itself keeps a plain
 * Markdown image whose URL uses a stable custom scheme:
 *
 *     ![alt](muninn-attachment:RECORD_ID/FILENAME)
 *
 * Keeping a scheme instead of a hard-coded `http://127.0.0.1:8090/...` URL means the
 * note stays portable (works against a local or a remote PocketBase, and survives the
 * Obsidian sync as ordinary text). We rewrite it to a live URL only when rendering or
 * editing, via `resolveAttachmentUrls` / the CodeMirror image widget.
 *
 * The `file` field is not marked "protected", so PocketBase serves it from a plain URL
 * (record id + random file suffix) and <img> tags work without any token.
 */
export const ATTACHMENT_SCHEME = 'muninn-attachment:'

export const isImageFile = (f: { type: string }) => /^image\//.test(f.type)

/**
 * Friendly, collision-resistant name for a pasted blob that has none.
 * No spaces: a Markdown image URL `](...)` must not contain whitespace, otherwise the
 * link breaks in CodeMirror, in `marked`, and in the inline image widget.
 */
function nameFor(file: File): string {
  if (file.name && !/^(image|blob)(\.\w+)?$/i.test(file.name)) {
    return file.name.replace(/\s+/g, '-')
  }
  const ext = (file.type.split('/')[1] || 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg')
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `Pasted-image-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`
}

/**
 * Upload one image file as an `attachments` record and return the Markdown to insert.
 */
export async function uploadImage(file: File): Promise<string> {
  if (!isImageFile(file)) throw new Error('Only image files can be attached')
  const name = nameFor(file)
  const rec = await pb.collection('attachments').create<Rec>({
    user: uidOwner(),
    name,
    file: new File([file], name, { type: file.type }),
  })
  // PocketBase appends a random suffix, so the real stored filename is on the record.
  const stored = typeof rec.file === 'string' ? rec.file : Array.isArray(rec.file) ? rec.file[0] : ''
  if (!stored) throw new Error('Upload succeeded but no file name was returned')
  const alt = name.replace(/\.[a-z0-9]+$/i, '')
  return `![${alt}](${ATTACHMENT_SCHEME}${rec.id}/${stored})`
}

function buildUrl(id: string, filename: string): string {
  // pb.files.getURL is the stable SDK helper; feed it a minimal record-like object
  return pb.files.getURL({ id, collectionName: 'attachments' } as unknown as Rec, filename.trim())
}

/** Turn a single `muninn-attachment:ID/FILE` reference into a servable file URL. */
export function attachmentUrl(ref: string): string {
  const body = ref.startsWith(ATTACHMENT_SCHEME) ? ref.slice(ATTACHMENT_SCHEME.length) : ref
  const slash = body.indexOf('/')
  if (slash < 0) return ref
  return buildUrl(body.slice(0, slash), body.slice(slash + 1))
}

/* ---------- Obsidian embeds: ![[Pasted image 123.png|300]] ---------- */
const IMAGE_NAME = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
export const isImageName = (s: string) => IMAGE_NAME.test(s.trim())

/**
 * Images the vault sync agent uploaded, by lower-case file name. The embed keeps the plain file name
 * (exactly as Obsidian writes it), so this index is how Muninn finds the picture again.
 */
let vaultImages = new Map<string, { id: string; file: string }>()

export async function loadImageIndex(): Promise<void> {
  try {
    const list = await pb.collection('attachments').getFullList<Rec>({ fields: 'id,name,file' })
    const next = new Map<string, { id: string; file: string }>()
    list.forEach((r) => { if (r.name && r.file) next.set(String(r.name).toLowerCase(), { id: r.id, file: String(r.file) }) })
    vaultImages = next
  } catch { /* offline: keep the previous index */ }
}

/** URL for an embed target such as "Images/photo.png" or "photo.png#anchor"; '' when it was never synced. */
export function embedImageUrl(target: string): string {
  const name = target.split('#')[0].trim().split(/[\\/]/).pop() ?? ''
  const hit = vaultImages.get(name.toLowerCase())
  return hit ? buildUrl(hit.id, hit.file) : ''
}

/** Splits the inside of ![[...]]: target, plus the optional "|300", "|300x200" or "|alt text" parts. */
export function parseEmbed(inner: string): { target: string; width: string; height: string; alt: string } {
  const [target, ...opts] = inner.split('|')
  let width = '', height = '', alt = ''
  for (const o of opts) {
    const s = o.trim()
    const size = /^(\d+)(?:x(\d+))?$/.exec(s)
    if (size) { width = size[1]; height = size[2] ?? '' } else if (s) alt = s
  }
  return { target: target.trim(), width, height, alt }
}

/** Does this markdown contain any attachment references? */
export const hasAttachments = (src: string) => src.includes(ATTACHMENT_SCHEME)

/** Replace every attachment reference in markdown with a live URL (for rendering). */
export function resolveAttachmentUrls(src: string): string {
  if (!hasAttachments(src)) return src
  // capture everything up to the closing ")" so filenames with spaces still resolve
  const re = new RegExp(`${ATTACHMENT_SCHEME}([a-z0-9]+)/([^)]+)`, 'gi')
  return src.replace(re, (_m, id: string, filename: string) => buildUrl(id, filename))
}
