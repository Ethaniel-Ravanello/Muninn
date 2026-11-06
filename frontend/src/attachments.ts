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

/*
 * Attachment files are private (the collection's View rule is `user = @request.auth.id`),
 * so a plain <img src> gets a 403 — the browser can't send the Authorization header.
 * PocketBase's answer is a short-lived *file token* passed as a `?token=` query param.
 * We fetch one, cache it, and refresh it before it expires (~2 min). Callers should
 * `await ensureFileToken()` once before rendering/mounting so the first paint has a token.
 */
let fileToken = ''
let fileTokenAt = 0
let pending: Promise<string> | null = null
const TOKEN_TTL_MS = 90_000 // refresh a bit before PocketBase's ~2 min expiry

export async function ensureFileToken(): Promise<string> {
  if (!pb.authStore.isValid) return ''
  if (fileToken && Date.now() - fileTokenAt < TOKEN_TTL_MS) return fileToken
  if (pending) return pending
  pending = pb.files.getToken()
    .then((tok) => { fileToken = tok; fileTokenAt = Date.now(); return tok })
    .catch(() => fileToken) // keep the old token on a transient failure
    .finally(() => { pending = null })
  return pending
}

function buildUrl(id: string, filename: string): string {
  // pb.files.getURL is the stable SDK helper; feed it a minimal record-like object
  return pb.files.getURL(
    { id, collectionName: 'attachments' } as unknown as Rec,
    filename.trim(),
    fileToken ? { token: fileToken } : {},
  )
}

/** Turn a single `muninn-attachment:ID/FILE` reference into a servable file URL. */
export function attachmentUrl(ref: string): string {
  const body = ref.startsWith(ATTACHMENT_SCHEME) ? ref.slice(ATTACHMENT_SCHEME.length) : ref
  const slash = body.indexOf('/')
  if (slash < 0) return ref
  void ensureFileToken() // warm the cache for next time without blocking this call
  return buildUrl(body.slice(0, slash), body.slice(slash + 1))
}

/** Does this markdown contain any attachment references? */
export const hasAttachments = (src: string) => src.includes(ATTACHMENT_SCHEME)

/** Replace every attachment reference in markdown with a live URL (for rendering). */
export function resolveAttachmentUrls(src: string): string {
  if (!hasAttachments(src)) return src
  void ensureFileToken()
  // capture everything up to the closing ")" so filenames with spaces still resolve
  const re = new RegExp(`${ATTACHMENT_SCHEME}([a-z0-9]+)/([^)]+)`, 'gi')
  return src.replace(re, (_m, id: string, filename: string) => buildUrl(id, filename))
}
