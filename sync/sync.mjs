#!/usr/bin/env node
// Muninn <-> Obsidian vault: two-way sync agent.
//
//   node sync.mjs             run forever (every intervalSeconds)
//   node sync.mjs --once      one pass, then exit
//   node sync.mjs --dry-run   one pass, print what WOULD happen, change nothing
//
// How it decides what to do: for every note it remembers the file hash and the PocketBase
// `updated` stamp from the last successful sync (state-*.json). Each pass compares both sides to
// that memory: only the file changed -> update the note; only the note changed -> rewrite the file;
// both changed -> keep both (the Muninn version is saved as a "conflict" file next to the original).

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ARGS = new Set(process.argv.slice(2))
const DRY = ARGS.has('--dry-run')
const ONCE = ARGS.has('--once') || DRY
const SETTLE_MS = 2500 // ignore files touched this recently (Drive/Obsidian may still be writing)
const MAX_FILE_BYTES = 400_000 // PocketBase `content` field limit is 200k chars

const stamp = () => new Date().toLocaleTimeString('en-GB')
const log = (...a) => console.log(`[${stamp()}]`, ...a)
const warn = (...a) => console.warn(`[${stamp()}] WARN`, ...a)
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ config */
function loadConfig() {
  const file = path.join(HERE, 'config.json')
  let f = {}
  if (fs.existsSync(file)) f = JSON.parse(fs.readFileSync(file, 'utf8'))
  const e = process.env
  const cfg = {
    url: String(e.MUNINN_URL || f.pocketbaseUrl || 'http://127.0.0.1:8090').replace(/\/+$/, ''),
    email: e.MUNINN_EMAIL || f.email || '',
    password: e.MUNINN_PASSWORD || f.password || '',
    vault: e.MUNINN_VAULT || f.vaultPath || '',
    interval: Number(e.MUNINN_INTERVAL || f.intervalSeconds || 30),
    deleteLimit: f.deleteLimit,
  }
  const missing = ['email', 'password', 'vault'].filter((k) => !cfg[k])
  if (missing.length) {
    console.error(`Missing config: ${missing.join(', ')}. Copy .env.example to .env and fill it in (run with: node --env-file=.env sync.mjs).`)
    process.exit(2)
  }
  cfg.vault = path.resolve(cfg.vault)
  return cfg
}

/* ------------------------------------------------------------------- state */
function statePath(cfg) {
  // keyed by server + account + vault so switching PocketBase instances never reuses stale ids
  const key = sha(`${cfg.url}|${cfg.email.toLowerCase()}|${cfg.vault.toLowerCase()}`).slice(0, 10)
  return path.join(process.env.MUNINN_STATE_DIR || HERE, `state-${key}.json`)
}
function loadState(cfg) {
  try { return JSON.parse(fs.readFileSync(statePath(cfg), 'utf8')) } catch { return { notes: {} } }
}
function saveState(cfg, state) {
  if (DRY) return
  const p = statePath(cfg)
  fs.writeFileSync(p + '.tmp', JSON.stringify(state, null, 2))
  fs.renameSync(p + '.tmp', p)
}

/* --------------------------------------------------------------------- api */
class Api {
  constructor(cfg) { this.cfg = cfg; this.token = ''; this.userId = '' }

  async req(method, url, body, retry = true) {
    const isForm = body instanceof FormData // image uploads: fetch sets the multipart boundary itself
    const res = await fetch(this.cfg.url + url, {
      method,
      headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(this.token ? { Authorization: this.token } : {}) },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(isForm ? 120_000 : 30_000),
    })
    if (res.status === 401 && retry && !url.includes('auth-with-password')) {
      await this.login()
      return this.req(method, url, body, false)
    }
    if (res.status === 204) return null
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${data?.message ?? ''}`.trim())
    return data
  }

  async login() {
    const r = await this.req('POST', '/api/collections/users/auth-with-password', { identity: this.cfg.email, password: this.cfg.password }, false)
    this.token = r.token
    this.userId = r.record.id
  }

  async listNotes() {
    const out = []
    for (let page = 1; ; page++) {
      const r = await this.req('GET', `/api/collections/notes/records?page=${page}&perPage=200&sort=created`)
      out.push(...r.items)
      if (page >= r.totalPages) break
    }
    return out
  }
  async listAttachmentIds() {
    const out = new Set()
    for (let page = 1; ; page++) {
      const r = await this.req('GET', `/api/collections/attachments/records?page=${page}&perPage=200&fields=id`)
      r.items.forEach((x) => out.add(x.id))
      if (page >= r.totalPages) break
    }
    return out
  }
  imageForm(name, buf, mime) {
    const fd = new FormData()
    fd.append('user', this.userId)
    fd.append('name', name)
    fd.append('file', new Blob([buf], { type: mime }), name)
    return fd
  }
  createAttachment(name, buf, mime) { return this.req('POST', '/api/collections/attachments/records', this.imageForm(name, buf, mime)) }
  updateAttachment(id, name, buf, mime) { return this.req('PATCH', `/api/collections/attachments/records/${id}`, this.imageForm(name, buf, mime)) }
  create(data) { return this.req('POST', '/api/collections/notes/records', { ...data, user: this.userId }) }
  update(id, data) { return this.req('PATCH', `/api/collections/notes/records/${id}`, data) }
  remove(id) { return this.req('DELETE', `/api/collections/notes/records/${id}`) }
}

/* ------------------------------------------------- markdown / frontmatter */
const norm = (s) => String(s ?? '').replace(/\r\n/g, '\n')
const splitTags = (s) => String(s ?? '').split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean)
const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/)
  if (!m) return { fm: '', body: text }
  return { fm: m[1] ?? '', body: text.slice(m[0].length) }
}
const compose = (fm, body) => (fm ? `---\n${fm}\n---\n${body}` : body)

function parseTags(fm) {
  const lines = fm.split(/\r?\n/)
  const i = lines.findIndex((l) => /^tags?\s*:/i.test(l))
  if (i < 0) return []
  const rest = lines[i].replace(/^tags?\s*:\s*/i, '').trim()
  let raw = []
  if (rest) {
    raw = rest.replace(/^\[|\]$/g, '').split(/[,\s]+/)
  } else {
    for (let j = i + 1; j < lines.length; j++) {
      const m = lines[j].match(/^\s*-\s*(.+)$/)
      if (!m) break
      raw.push(m[1])
    }
  }
  return raw.map((t) => t.trim().replace(/^["']|["']$/g, '').replace(/^#/, '')).filter(Boolean)
}

function setTags(fm, tags) {
  const clean = tags.map((t) => t.replace(/\s+/g, '-'))
  if (sameArr(parseTags(fm), clean)) return fm
  const lines = fm ? fm.split(/\r?\n/) : []
  const kept = []
  for (let i = 0; i < lines.length; i++) {
    if (/^tags?\s*:/i.test(lines[i])) {
      if (!lines[i].replace(/^tags?\s*:\s*/i, '').trim()) while (i + 1 < lines.length && /^\s*-\s*/.test(lines[i + 1])) i++
      continue
    }
    kept.push(lines[i])
  }
  if (clean.length) kept.push('tags:', ...clean.map((t) => `  - ${t}`))
  return kept.join('\n')
}

/* -------------------------------------------------------------- file names */
// Obsidian forbids  * " \ / < > : | ? # ^ [ ]  in note names
function sanitizeName(s) {
  return String(s ?? '').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, 120)
}
const dirParts = (category) => String(category ?? '').split(/[\\/]+/).map(sanitizeName).filter(Boolean)
const desiredDir = (category) => dirParts(category).join('/')
const desiredPath = (rec) => [...dirParts(rec.category), (sanitizeName(rec.title) || 'Untitled') + '.md'].join('/')

function uniquePath(rel, taken) {
  if (!taken.has(rel.toLowerCase())) return rel
  const base = rel.replace(/\.md$/i, '')
  for (let n = 2; n < 1000; n++) {
    const cand = `${base} (${n}).md`
    if (!taken.has(cand.toLowerCase())) return cand
  }
  throw new Error(`Cannot find a free file name for ${rel}`)
}

/* ------------------------------------------------------------------- vault */
function absOf(cfg, rel) {
  const root = path.resolve(cfg.vault)
  const abs = path.resolve(root, ...rel.split('/'))
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`Path escapes the vault: ${rel}`)
  return abs
}

function scan(cfg) {
  const out = new Map() // lower-case rel path -> entry
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue // .obsidian, .trash, .git ...
      const r = rel ? `${rel}/${e.name}` : e.name
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) { walk(abs, r); continue }
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.md')) continue
      const entry = { rel: r, locked: false, text: '', hash: '' }
      try {
        const st = fs.statSync(abs)
        if (st.size > MAX_FILE_BYTES) { entry.locked = true; warn(`Skipping ${r}: file is too large`) }
        else if (Date.now() - st.mtimeMs < SETTLE_MS) entry.locked = true
        else { entry.text = fs.readFileSync(abs, 'utf8'); entry.hash = sha(entry.text) }
      } catch { entry.locked = true }
      out.set(r.toLowerCase(), entry)
    }
  }
  walk(cfg.vault, '')
  return out
}

/* ------------------------------------------------------------------ images */
// Obsidian embeds images as ![[Pasted image 123.png|300]] (the number is the width). The note text is
// left exactly as written; here we only make sure each image a note uses also exists in Muninn
// (the `attachments` collection, named after the file), so Muninn can draw it.
const IMAGE_TYPES = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.gif', 'image/gif'],
  ['.webp', 'image/webp'], ['.svg', 'image/svg+xml'], ['.bmp', 'image/bmp'], ['.avif', 'image/avif'],
])
const MAX_IMAGE_BYTES = 15_000_000 // the attachments collection refuses bigger files
const MAX_UPLOADS_PER_PASS = 25 // a big vault is brought over over a few passes instead of one long stall
const EMBED = /!\[\[([^\]\n|#^]+)(?:[#^][^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g
const warnedImages = new Set()

function referencedImages(files) {
  const refs = new Set()
  for (const f of files.values()) {
    if (f.locked || !f.text) continue
    for (const m of f.text.matchAll(EMBED)) {
      const target = m[1].trim()
      if (IMAGE_TYPES.has(path.extname(target).toLowerCase())) refs.add(target.replace(/\\/g, '/').toLowerCase())
    }
  }
  return refs
}

function scanImages(cfg) {
  const out = []
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) { walk(abs, r); continue }
      const mime = e.isFile() ? IMAGE_TYPES.get(path.extname(e.name).toLowerCase()) : undefined
      if (!mime) continue
      try {
        const st = fs.statSync(abs)
        out.push({ rel: r, abs, size: st.size, mtimeMs: st.mtimeMs, mime, busy: Date.now() - st.mtimeMs < SETTLE_MS })
      } catch { /* vanished while scanning */ }
    }
  }
  walk(cfg.vault, '')
  return out
}

async function syncImages(cfg, api, state, files) {
  state.images ??= {}
  const refs = referencedImages(files)
  if (refs.size === 0) return

  const images = scanImages(cfg)
  const byRel = new Map(images.map((i) => [i.rel.toLowerCase(), i]))
  const byName = new Map()
  for (const i of images) { const n = path.posix.basename(i.rel).toLowerCase(); if (!byName.has(n)) byName.set(n, i) }
  // Obsidian finds an embed by bare file name or by a path ending in the target
  const find = (t) => (t.includes('/')
    ? byRel.get(t) ?? images.find((i) => i.rel.toLowerCase().endsWith('/' + t))
    : byName.get(t))

  const wanted = new Map()
  for (const t of refs) {
    const img = find(t)
    if (img) wanted.set(img.rel.toLowerCase(), img)
    else if (!warnedImages.has(t)) { warnedImages.add(t); warn(`Image "${t}" is embedded in a note but is not in the vault`) }
  }
  if (wanted.size === 0) return

  const remote = await api.listAttachmentIds()
  let uploaded = 0, deferred = 0
  for (const [key, img] of wanted) {
    try {
      const known = state.images[key]
      const alive = known && remote.has(known.id)
      if (alive && known.size === img.size && known.mtime === img.mtimeMs) continue
      if (img.busy) continue
      if (img.size > MAX_IMAGE_BYTES) {
        if (!warnedImages.has(key)) { warnedImages.add(key); warn(`Skipping image ${img.rel}: bigger than ${MAX_IMAGE_BYTES / 1e6} MB`) }
        continue
      }
      if (uploaded >= MAX_UPLOADS_PER_PASS) { deferred++; continue }
      const name = path.posix.basename(img.rel)
      log(`  ${alive ? 'update' : 'upload'} image  ${img.rel}`)
      uploaded++
      if (DRY) continue
      const buf = fs.readFileSync(img.abs)
      const rec = alive
        ? await api.updateAttachment(known.id, name, buf, img.mime)
        : await api.createAttachment(name, buf, img.mime)
      state.images[key] = { id: rec.id, size: img.size, mtime: img.mtimeMs, name }
    } catch (e) {
      warn(`Failed on image ${img.rel}: ${e.message}`)
    }
  }
  if (uploaded || deferred) log(`${DRY ? '[dry-run] ' : ''}Images: ${uploaded} sent${deferred ? `, ${deferred} more on the next pass` : ''}.`)
}

/* ---------------------------------------------------------------- the pass */
let dryCounter = 0

async function cycle(cfg, api, state) {
  if (!fs.existsSync(cfg.vault)) throw new Error(`Vault folder not found: ${cfg.vault} (is Google Drive for desktop running?)`)
  if (!api.token) await api.login()

  const files = scan(cfg)
  const recs = await api.listNotes()
  const recById = new Map(recs.map((r) => [r.id, r]))
  const tracked = Object.keys(state.notes)

  // wrong server, wrong account or an unmounted drive must never look like "everything was deleted"
  if (tracked.length >= 5 && (files.size === 0 || recs.length === 0)) {
    throw new Error(`Refusing to sync: ${files.size} files / ${recs.length} notes found but ${tracked.length} are tracked. Wrong vault, wrong server, or drive not mounted?`)
  }

  const limit = cfg.deleteLimit ?? Math.max(3, Math.ceil(tracked.length * 0.3))
  let deletes = 0
  const canDelete = (what) => {
    if (deletes >= limit) { warn(`Deletion limit (${limit}) reached, leaving "${what}" alone this pass`); return false }
    deletes++
    return true
  }

  const taken = new Set(files.keys())
  tracked.forEach((id) => taken.add(state.notes[id].path.toLowerCase()))
  const claimed = new Set(tracked.map((id) => state.notes[id].path.toLowerCase()))
  const counts = { toNotes: 0, toFiles: 0, created: 0, removed: 0, conflicts: 0 }
  const deletedIds = new Set() // notes removed during this pass (the `recs` list is a snapshot from before)

  /* ---- mutating helpers (all side effects go through here so --dry-run is honest) ---- */
  const io = {
    write(rel, text) {
      log(`  write file   ${rel}`)
      if (DRY) return
      const abs = absOf(cfg, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, text)
    },
    rename(from, to) {
      log(`  rename file  ${from} -> ${to}`)
      files.delete(from.toLowerCase()) // the scan snapshot must not offer the old name as a "new" file
      if (DRY) return
      const a = absOf(cfg, from), b = absOf(cfg, to)
      fs.mkdirSync(path.dirname(b), { recursive: true })
      fs.renameSync(a, b)
    },
    trash(rel) {
      log(`  trash file   ${rel}  (-> .trash)`)
      files.delete(rel.toLowerCase())
      if (DRY) return
      const src = absOf(cfg, rel)
      let dest = absOf(cfg, `.trash/${rel}`)
      if (fs.existsSync(dest)) dest = dest.replace(/\.md$/i, ` ${Date.now()}.md`)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.renameSync(src, dest)
    },
    async create(data) {
      log(`  create note  "${data.title}"`)
      return DRY ? { id: `dry${++dryCounter}`, updated: 'dry', ...data } : api.create(data)
    },
    async update(id, patch, what) {
      log(`  update note  "${what}" [${Object.keys(patch).join(', ')}]`)
      return DRY ? { ...recById.get(id), ...patch } : api.update(id, patch)
    },
    async remove(id, what) {
      log(`  delete note  "${what}"`)
      if (!DRY) await api.remove(id)
    },
  }

  /* ---- translation between the two worlds ---- */
  const fromFile = (file, rec) => {
    const { fm, body } = splitFrontmatter(file.text)
    const parts = file.rel.split('/')
    const base = parts.pop().replace(/\.md$/i, '')
    const dir = parts.join('/')
    let title = base
    let category = dir
    // keep the user's own spelling when it only differs from the file name by sanitising
    // also tolerate the " (2)" suffix this agent adds when two notes share a title
    const baseNoSuffix = base.replace(/ \(\d+\)$/, '')
    if (rec && [base, baseNoSuffix].some((b) => sanitizeName(rec.title).toLowerCase() === b.toLowerCase())) title = rec.title
    if (rec && desiredDir(rec.category).toLowerCase() === dir.toLowerCase()) category = rec.category
    return { title, category, content: body, tags: parseTags(fm), fm, path: file.rel }
  }
  const diffRec = (rec, p) => {
    const d = {}
    if ((rec.title ?? '') !== p.title) d.title = p.title
    if ((rec.category ?? '') !== p.category) d.category = p.category
    if (norm(rec.content) !== norm(p.content)) d.content = p.content
    if (!sameArr(splitTags(rec.tags), p.tags)) d.tags = p.tags.join(', ')
    if ((rec.fm ?? '') !== p.fm) d.fm = p.fm
    if ((rec.path ?? '') !== p.path) d.path = p.path
    return d
  }
  // only real writing counts as a conflict; title/category/path are derived from the file name
  const hasContentDiff = (d) => 'content' in d || 'tags' in d
  const toFile = (rec) => {
    const fm = setTags(rec.fm ?? '', splitTags(rec.tags))
    return { fm, text: compose(fm, rec.content ?? '') }
  }

  const remember = (id, rel, hash, rec) => {
    state.notes[id] = { path: rel, hash, updated: rec.updated }
    recById.set(id, rec)
    claimed.add(rel.toLowerCase())
    taken.add(rel.toLowerCase())
  }

  // file -> note
  const pushFileToNote = async (id, file) => {
    const rec = recById.get(id)
    const patch = diffRec(rec, fromFile(file, rec))
    let next = rec
    if (Object.keys(patch).length) { next = await io.update(id, patch, rec.title); counts.toNotes++ }
    remember(id, file.rel, file.hash, next)
  }

  // note -> file (also handles renames caused by a new title/category)
  const pushNoteToFile = async (id, file) => {
    const rec = recById.get(id)
    const st = state.notes[id]
    const { fm, text } = toFile(rec)
    let rel = st.path
    const want = desiredPath(rec)
    if (want.toLowerCase() !== rel.toLowerCase()) {
      rel = uniquePath(want, taken)
      if (file) io.rename(st.path, rel)
    }
    if (!file || rel !== st.path || file.text !== text) { io.write(rel, text); counts.toFiles++ }
    const patch = {}
    if ((rec.path ?? '') !== rel) patch.path = rel
    if ((rec.fm ?? '') !== fm) patch.fm = fm
    const next = Object.keys(patch).length ? await io.update(id, patch, rec.title) : rec
    if (rel !== st.path) { claimed.delete(st.path.toLowerCase()); taken.delete(st.path.toLowerCase()) }
    remember(id, rel, sha(text), next)
  }

  const conflictCopy = (rec, rel) => {
    const d = new Date()
    const p2 = (n) => String(n).padStart(2, '0')
    const tag = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}${p2(d.getMinutes())}`
    const target = uniquePath(rel.replace(/\.md$/i, ` (Muninn conflict ${tag}).md`), taken)
    taken.add(target.toLowerCase())
    io.write(target, toFile(rec).text)
    counts.conflicts++
    warn(`Conflict on "${rec.title}": both sides changed. Muninn's version was saved as "${target}".`)
  }

  const createNoteFromFile = async (file) => {
    const p = fromFile(file, null)
    const rec = await io.create({ title: p.title, category: p.category, content: p.content, tags: p.tags.join(', '), fm: p.fm, path: file.rel })
    counts.created++
    remember(rec.id, file.rel, file.hash, rec)
  }

  const createFileFromNote = async (rec) => {
    recById.set(rec.id, rec)
    const rel = uniquePath(desiredPath(rec), taken)
    taken.add(rel.toLowerCase())
    const { fm, text } = toFile(rec)
    io.write(rel, text)
    counts.created++
    const patch = { path: rel }
    if ((rec.fm ?? '') !== fm) patch.fm = fm
    remember(rec.id, rel, sha(text), await io.update(rec.id, patch, rec.title))
  }

  /* ---- 0. renames inside the vault: a tracked file vanished but identical content appeared elsewhere ---- */
  for (const id of tracked) {
    const st = state.notes[id]
    if (files.has(st.path.toLowerCase()) || !recById.has(id)) continue
    const hit = [...files.values()].find((f) => !f.locked && f.hash === st.hash && !claimed.has(f.rel.toLowerCase()))
    if (!hit) continue
    log(`Renamed in vault: ${st.path} -> ${hit.rel}`)
    claimed.delete(st.path.toLowerCase())
    taken.delete(st.path.toLowerCase())
    st.path = hit.rel
    claimed.add(hit.rel.toLowerCase())
    await pushFileToNote(id, hit)
  }

  /* ---- 1. notes we already track ---- */
  for (const id of tracked) {
    try {
      const st = state.notes[id]
      const rec = recById.get(id)
      const file = files.get(st.path.toLowerCase())

      if (!rec && !file) { delete state.notes[id]; continue }
      if (file?.locked) continue

      if (!rec) {
        if (file.hash === st.hash) {
          if (canDelete(st.path)) { io.trash(st.path); counts.removed++; delete state.notes[id] }
        } else {
          log(`Note deleted in Muninn but edited in the vault, keeping it: ${st.path}`)
          delete state.notes[id]
          await createNoteFromFile(file)
        }
        continue
      }

      if (!file) {
        if (rec.updated === st.updated) {
          if (canDelete(rec.title)) {
            await io.remove(id, rec.title)
            counts.removed++
            deletedIds.add(id)
            claimed.delete(st.path.toLowerCase())
            delete state.notes[id]
          }
        } else {
          log(`File deleted in vault but note edited in Muninn, restoring file: ${rec.title}`)
          await pushNoteToFile(id, null)
        }
        continue
      }

      const fileChanged = file.hash !== st.hash
      const recChanged = rec.updated !== st.updated
      if (!fileChanged && !recChanged) continue

      if (fileChanged && !recChanged) {
        log(`Vault -> Muninn: ${st.path}`)
        await pushFileToNote(id, file)
      } else if (!fileChanged && recChanged) {
        log(`Muninn -> vault: ${rec.title}`)
        await pushNoteToFile(id, file)
      } else {
        const patch = diffRec(rec, fromFile(file, rec))
        if (hasContentDiff(patch)) conflictCopy(rec, st.path)
        log(`Both changed, vault version wins: ${st.path}`)
        await pushFileToNote(id, file)
      }
    } catch (e) {
      warn(`Failed on note ${id}: ${e.message}`)
    }
  }

  /* ---- 2. new files in the vault (maybe adopting a note that already points at them) ---- */
  const untrackedRecs = () => recs.filter((r) => !state.notes[r.id] && !deletedIds.has(r.id))
  for (const file of files.values()) {
    if (file.locked || claimed.has(file.rel.toLowerCase())) continue
    try {
      const match = untrackedRecs().find((r) => (r.path ?? '').toLowerCase() === file.rel.toLowerCase())
      if (match) {
        const patch = diffRec(match, fromFile(file, match))
        if (hasContentDiff(patch)) conflictCopy(match, file.rel)
        recById.set(match.id, match)
        await pushFileToNote(match.id, file)
      } else {
        log(`New file in vault: ${file.rel}`)
        await createNoteFromFile(file)
      }
    } catch (e) {
      warn(`Failed on file ${file.rel}: ${e.message}`)
    }
  }

  /* ---- 3. new notes created in Muninn ---- */
  for (const rec of untrackedRecs()) {
    try {
      log(`New note in Muninn: ${rec.title}`)
      await createFileFromNote(rec)
    } catch (e) {
      warn(`Failed on note ${rec.id}: ${e.message}`)
    }
  }

  // images last, and never fatal: a failed upload must not stop notes from syncing
  try { await syncImages(cfg, api, state, files) } catch (e) { warn(`Image sync failed: ${e.message}`) }

  const c = counts
  log(`${DRY ? '[dry-run] ' : ''}Pass done: ${c.toNotes} vault->Muninn, ${c.toFiles} Muninn->vault, ${c.created} new, ${c.removed} removed, ${c.conflicts} conflicts.`)
}

/* -------------------------------------------------------------------- main */
async function main() {
  const cfg = loadConfig()
  const api = new Api(cfg)
  const state = loadState(cfg)
  log(`Muninn vault sync${DRY ? ' (DRY RUN, nothing will be changed)' : ''}`)
  log(`  server: ${cfg.url}`)
  log(`  vault : ${cfg.vault}`)
  let failed = false
  for (;;) {
    try {
      await cycle(cfg, api, state)
      failed = false
    } catch (e) {
      failed = true
      console.error(`[${stamp()}] ERROR ${e.message}`)
    } finally {
      saveState(cfg, state)
    }
    if (ONCE) break
    await sleep(cfg.interval * 1000)
  }
  // set the code and let Node exit by itself; calling process.exit() with a request still closing
  // triggers a libuv "Assertion failed" message on Windows
  process.exitCode = failed ? 1 : 0
}

main()
