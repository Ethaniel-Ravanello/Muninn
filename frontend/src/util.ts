const pad = (n: number) => String(n).padStart(2, '0')

export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const today = () => ymd(new Date())

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s)
  d.setDate(d.getDate() + n)
  return ymd(d)
}

export function addMonths(s: string, n: number): string {
  const d = parseYmd(s)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return ymd(d)
}

/** Whole days from b to a (a - b). */
export function diffDays(a: string, b: string): number {
  return Math.round((parseYmd(a).getTime() - parseYmd(b).getTime()) / 86400000)
}

export function fmtDate(s?: string): string {
  if (!s) return ''
  return parseYmd(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function relDay(s: string): string {
  const n = diffDays(s, today())
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n === -1) return 'Yesterday'
  return n > 0 ? `in ${n} days` : `${-n} days ago`
}

export const monthKey = (s: string) => s.slice(0, 7)

export function monthLabel(key: string): string {
  return parseYmd(`${key}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

/** Monday of the week containing s. */
export function weekStart(s: string): string {
  const d = parseYmd(s)
  const dow = (d.getDay() + 6) % 7
  return addDays(s, -dow)
}

/** ISO week key such as 2026-W45. */
export function weekKey(s: string): string {
  const d = parseYmd(weekStart(s))
  d.setDate(d.getDate() + 3) // Thursday decides the ISO year
  const year = d.getFullYear()
  const jan4 = new Date(year, 0, 4)
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7)
  return `${year}-W${pad(week)}`
}

const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
export const money = (n: number | undefined) => rupiah.format(n || 0)

export const uid = () => Math.random().toString(36).slice(2, 10)

export const splitTags = (s?: string): string[] =>
  (s || '').split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean)

export const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim())

export function advance(date: string, cycle: string): string {
  switch (cycle) {
    case 'weekly': return addDays(date, 7)
    case 'yearly': return addMonths(date, 12)
    case 'daily': return addDays(date, 1)
    default: return addMonths(date, 1)
  }
}

export function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}
